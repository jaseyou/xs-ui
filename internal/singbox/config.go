package singbox

import (
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/jaseyou/xs-ui/v3/internal/database/model"
)

// The DB shapes this renderer consumes are the panel's own conventions, not
// sing-box's:
//
//	settings:      {"clients":[{"email","password"(,"username")}]} plus the
//	               protocol-specific server fields listed per case below.
//	streamSettings: {"security":"tls","tlsSettings":{...}} or
//	                {"security":"reality","realitySettings":{...}} — the same
//	                field names the panel's inbound form already produces for
//	                Xray, translated to sing-box's TLS block at render time.
//
// A hysteria inbound whose settings carry "core":"singbox" is served by the
// sidecar too: Xray's hysteria has no salamander obfs or port hopping, which
// is exactly what that template needs.

// BuildConfig renders the sing-box configuration (as a generic JSON map) for
// the given inbounds. Only singbox-hosted protocols are considered; callers
// filter the rest. An empty inbound list yields a config with no inbounds —
// the reconciler treats that as "sidecar not needed".
func BuildConfig(inbounds []*model.Inbound) (map[string]any, error) {
	list := make([]any, 0, len(inbounds))
	for _, inbound := range inbounds {
		if !inbound.Enable || inbound.NodeID != nil {
			continue
		}
		fragments, err := buildInbound(inbound)
		if err != nil {
			return nil, fmt.Errorf("%s (%s): %w", inbound.Tag, inbound.Protocol, err)
		}
		list = append(list, fragments...)
	}
	return map[string]any{
		"log":       map[string]any{"level": "warning", "timestamp": true},
		"inbounds":  list,
		"outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}},
	}, nil
}

// BuildConfigJSON renders the sing-box configuration as formatted JSON.
func BuildConfigJSON(inbounds []*model.Inbound) ([]byte, error) {
	cfg, err := BuildConfig(inbounds)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(cfg, "", "  ")
}

func buildInbound(inbound *model.Inbound) ([]any, error) {
	settings := map[string]any{}
	if strings.TrimSpace(inbound.Settings) != "" {
		if err := json.Unmarshal([]byte(inbound.Settings), &settings); err != nil {
			return nil, fmt.Errorf("bad settings: %w", err)
		}
	}
	stream := map[string]any{}
	if strings.TrimSpace(inbound.StreamSettings) != "" {
		if err := json.Unmarshal([]byte(inbound.StreamSettings), &stream); err != nil {
			return nil, fmt.Errorf("bad streamSettings: %w", err)
		}
	}
	clients, _ := settings["clients"].([]any)
	base := map[string]any{
		"tag":         inbound.Tag,
		"listen":      listenAddress(inbound.Listen),
		"listen_port": inbound.Port,
	}

	switch inbound.Protocol {
	case model.Anytls:
		users, err := passwordUsers(clients)
		if err != nil {
			return nil, err
		}
		if len(users) == 0 {
			return nil, fmt.Errorf("no clients configured")
		}
		base["type"] = "anytls"
		base["users"] = users
		tls, err := buildTLS(stream)
		if err != nil {
			return nil, err
		}
		if tls != nil {
			base["tls"] = tls
		}
		return []any{base}, nil

	case model.Naive:
		users, err := naiveUsers(clients)
		if err != nil {
			return nil, err
		}
		if len(users) == 0 {
			return nil, fmt.Errorf("no clients configured")
		}
		base["type"] = "naive"
		base["users"] = users
		tls, err := buildTLS(stream)
		if err != nil {
			return nil, err
		}
		if tls == nil {
			return nil, fmt.Errorf("naive requires TLS")
		}
		base["tls"] = tls
		return []any{base}, nil

	case model.Shadowtls:
		users, err := passwordUsers(clients)
		if err != nil {
			return nil, err
		}
		if len(users) == 0 {
			return nil, fmt.Errorf("no clients configured")
		}
		ssMethod, _ := settings["ssMethod"].(string)
		ssPassword, _ := settings["ssPassword"].(string)
		if ssMethod == "" || ssPassword == "" {
			return nil, fmt.Errorf("shadowtls needs ssMethod and ssPassword")
		}
		handshake, err := handshakeFromStream(stream)
		if err != nil {
			return nil, err
		}
		version := 3
		if v, ok := settings["version"].(float64); ok && int(v) > 0 {
			version = int(v)
		}
		ssTag := inbound.Tag + "-ss"
		base["type"] = "shadowtls"
		base["version"] = version
		base["users"] = users
		base["handshake"] = handshake
		base["detour"] = ssTag
		chained := map[string]any{
			"type":        "shadowsocks",
			"tag":         ssTag,
			"listen":      "127.0.0.1",
			"listen_port": 0,
			"method":      ssMethod,
			"password":    ssPassword,
		}
		return []any{base, chained}, nil

	case model.Hysteria:
		if settings["core"] != "singbox" {
			return nil, fmt.Errorf("hysteria inbound is not marked for the sing-box core")
		}
		users, err := passwordUsers(clients)
		if err != nil {
			return nil, err
		}
		if len(users) == 0 {
			return nil, fmt.Errorf("no clients configured")
		}
		base["type"] = "hysteria2"
		base["users"] = users
		// Port hopping is a sing-box client-side feature; the server listens
		// on one port. settings.portHopping is accepted but not rendered.
		if obfs, ok := settings["obfs"].(map[string]any); ok && obfs["type"] == "salamander" {
			base["obfs"] = obfs
		}
		tls, err := buildTLS(stream)
		if err != nil {
			return nil, err
		}
		if tls == nil {
			return nil, fmt.Errorf("hysteria2 requires TLS")
		}
		base["tls"] = tls
		return []any{base}, nil

	default:
		return nil, fmt.Errorf("protocol %s is not served by the sing-box core", inbound.Protocol)
	}
}

// buildTLS translates the panel's streamSettings security block into a
// sing-box TLS object. nil means the inbound runs without TLS.
func buildTLS(stream map[string]any) (map[string]any, error) {
	security, _ := stream["security"].(string)
	switch security {
	case "", "none":
		return nil, nil
	case "tls":
		tlsSettings, _ := stream["tlsSettings"].(map[string]any)
		out := map[string]any{"enabled": true}
		if sni := stringSetting(tlsSettings, "serverName"); sni != "" {
			out["server_name"] = sni
		}
		if alpn := stringList(tlsSettings, "alpn"); len(alpn) > 0 {
			out["alpn"] = alpn
		}
		certs, _ := tlsSettings["certificates"].([]any)
		for _, c := range certs {
			cert, ok := c.(map[string]any)
			if !ok {
				continue
			}
			if f := stringSetting(cert, "certificateFile"); f != "" {
				out["certificate_path"] = f
			}
			if f := stringSetting(cert, "keyFile"); f != "" {
				out["key_path"] = f
			}
		}
		return out, nil
	case "reality":
		rs, _ := stream["realitySettings"].(map[string]any)
		target, _ := rs["target"].(string)
		if target == "" {
			return nil, fmt.Errorf("reality settings need a target")
		}
		privateKey, _ := rs["privateKey"].(string)
		if privateKey == "" {
			return nil, fmt.Errorf("reality settings need a privateKey")
		}
		host, port := splitHostPort(target, 443)
		out := map[string]any{"enabled": true}
		if names := stringList(rs, "serverNames"); len(names) > 0 {
			out["server_name"] = names[0]
		}
		shortIds := stringList(rs, "shortIds")
		out["reality"] = map[string]any{
			"enabled":     true,
			"handshake":   map[string]any{"server": host, "server_port": port},
			"private_key": privateKey,
			"short_id":    shortIds,
		}
		return out, nil
	default:
		return nil, fmt.Errorf("stream security %q is not supported by the sing-box core", security)
	}
}

// handshakeFromStream picks the ShadowTLS camouflage target: the reality
// target when present, otherwise the TLS serverName resolved on 443.
func handshakeFromStream(stream map[string]any) (map[string]any, error) {
	security, _ := stream["security"].(string)
	if security == "reality" {
		rs, _ := stream["realitySettings"].(map[string]any)
		if target, _ := rs["target"].(string); target != "" {
			host, port := splitHostPort(target, 443)
			return map[string]any{"server": host, "server_port": port}, nil
		}
	}
	if security == "tls" {
		tlsSettings, _ := stream["tlsSettings"].(map[string]any)
		if sni := stringSetting(tlsSettings, "serverName"); sni != "" {
			return map[string]any{"server": sni, "server_port": 443}, nil
		}
	}
	return nil, fmt.Errorf("shadowtls needs a handshake target (reality target or TLS serverName)")
}

func passwordUsers(clients []any) ([]any, error) {
	users := make([]any, 0, len(clients))
	for _, c := range clients {
		client, ok := c.(map[string]any)
		if !ok {
			continue
		}
		email, _ := client["email"].(string)
		// Panel hysteria clients carry their secret in "auth"; every other
		// protocol uses "password". Accept both so clients added through the
		// regular UI work alongside template-created ones.
		password, _ := client["password"].(string)
		if password == "" {
			password, _ = client["auth"].(string)
		}
		if email == "" || password == "" {
			return nil, fmt.Errorf("client %q needs an email and a password", email)
		}
		users = append(users, map[string]any{"name": email, "password": password})
	}
	return users, nil
}

func naiveUsers(clients []any) ([]any, error) {
	users := make([]any, 0, len(clients))
	for _, c := range clients {
		client, ok := c.(map[string]any)
		if !ok {
			continue
		}
		email, _ := client["email"].(string)
		password, _ := client["password"].(string)
		if email == "" || password == "" {
			return nil, fmt.Errorf("client %q needs an email and a password", email)
		}
		username := email
		if u := stringSetting(client, "username"); u != "" {
			username = u
		}
		// naive users take username/password only — no "name" field.
		users = append(users, map[string]any{"username": username, "password": password})
	}
	return users, nil
}

func listenAddress(listen string) string {
	listen = strings.TrimSpace(listen)
	if listen == "" {
		return "::"
	}
	return listen
}

func splitHostPort(target string, defaultPort int) (string, int) {
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		// A bare host name: use the default port.
		return target, defaultPort
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		return host, defaultPort
	}
	return host, port
}

func stringSetting(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

func stringList(m map[string]any, key string) []string {
	if m == nil {
		return nil
	}
	raw, ok := m[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}
