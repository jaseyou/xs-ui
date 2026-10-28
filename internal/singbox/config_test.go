package singbox

import (
	"encoding/json"
	"testing"

	"github.com/jaseyou/xs-ui/v3/internal/database/model"
)

func inbound(protocol model.Protocol, settings, stream string) *model.Inbound {
	return &model.Inbound{
		Enable:         true,
		Protocol:       protocol,
		Port:           23456,
		Tag:            "tpl-test",
		Settings:       settings,
		StreamSettings: stream,
	}
}

func mustParse(t *testing.T, raw string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("fixture JSON: %v", err)
	}
	return m
}

func renderOne(t *testing.T, ib *model.Inbound) []map[string]any {
	t.Helper()
	cfg, err := BuildConfig([]*model.Inbound{ib})
	if err != nil {
		t.Fatalf("BuildConfig: %v", err)
	}
	list, ok := cfg["inbounds"].([]any)
	if !ok || len(list) == 0 {
		t.Fatalf("expected rendered inbounds, got %#v", cfg["inbounds"])
	}
	out := make([]map[string]any, 0, len(list))
	for _, raw := range list {
		// Round-trip through JSON so assertions see the same shapes a real
		// consumer (sing-box) would parse: numbers as float64, lists as []any.
		blob, err := json.Marshal(raw)
		if err != nil {
			t.Fatalf("marshal fragment: %v", err)
		}
		m := map[string]any{}
		if err := json.Unmarshal(blob, &m); err != nil {
			t.Fatalf("unmarshal fragment: %v", err)
		}
		out = append(out, m)
	}
	return out
}

func TestBuildConfigAnytlsTLS(t *testing.T) {
	ib := inbound(model.Anytls,
		`{"clients":[{"email":"a@xui.local","password":"pw"}]}`,
		`{"security":"tls","tlsSettings":{"serverName":"d.example.com","alpn":["h2","http/1.1"],
		  "certificates":[{"certificateFile":"/c.pem","keyFile":"/k.pem"}]}}`)
	fragments := renderOne(t, ib)
	if len(fragments) != 1 {
		t.Fatalf("anytls renders one inbound, got %d", len(fragments))
	}
	ib2 := fragments[0]
	if ib2["type"] != "anytls" || ib2["listen_port"] != float64(23456) {
		t.Fatalf("bad anytls fragment: %#v", ib2)
	}
	users, _ := ib2["users"].([]any)
	if len(users) != 1 {
		t.Fatalf("expected one user, got %#v", users)
	}
	user := users[0].(map[string]any)
	if user["name"] != "a@xui.local" || user["password"] != "pw" {
		t.Fatalf("bad user: %#v", user)
	}
	tlsMap := ib2["tls"].(map[string]any)
	if tlsMap["certificate_path"] != "/c.pem" || tlsMap["key_path"] != "/k.pem" {
		t.Fatalf("bad tls: %#v", tlsMap)
	}
}

func TestBuildConfigNaiveRequiresTLS(t *testing.T) {
	ib := inbound(model.Naive,
		`{"clients":[{"email":"a@xui.local","password":"pw"}]}`, `{"security":"none"}`)
	if _, err := BuildConfig([]*model.Inbound{ib}); err == nil {
		t.Fatal("naive without TLS must fail")
	}
}

func TestBuildConfigShadowtlsChainsSS2022(t *testing.T) {
	ib := inbound(model.Shadowtls,
		`{"version":3,"ssMethod":"2022-blake3-aes-128-gcm","ssPassword":"ss-pw",
		  "clients":[{"email":"a@xui.local","password":"stls-pw"}]}`,
		`{"security":"reality","realitySettings":{"target":"127.0.0.1:7443","serverNames":["d.example.com"]}}`)
	fragments := renderOne(t, ib)
	if len(fragments) != 2 {
		t.Fatalf("shadowtls renders the chained pair, got %d fragments", len(fragments))
	}
	stls := fragments[0]
	if stls["type"] != "shadowtls" || stls["version"] != float64(3) {
		t.Fatalf("bad shadowtls fragment: %#v", stls)
	}
	if stls["detour"] != "tpl-test-ss" {
		t.Fatalf("bad detour: %#v", stls["detour"])
	}
	hs := stls["handshake"].(map[string]any)
	if hs["server"] != "127.0.0.1" || hs["server_port"] != float64(7443) {
		t.Fatalf("bad handshake: %#v", hs)
	}
	ss := fragments[1]
	if ss["type"] != "shadowsocks" || ss["tag"] != "tpl-test-ss" {
		t.Fatalf("bad chained ss fragment: %#v", ss)
	}
	if ss["method"] != "2022-blake3-aes-128-gcm" || ss["password"] != "ss-pw" {
		t.Fatalf("bad ss method/password: %#v", ss)
	}
}

func TestBuildConfigHysteria2Salamander(t *testing.T) {
	stream := `{"security":"tls","tlsSettings":{"alpn":["h3"],
	  "certificates":[{"certificateFile":"/c.pem","keyFile":"/k.pem"}]}}`
	marked := inbound(model.Hysteria,
		`{"version":2,"core":"singbox","portHopping":100,
		  "obfs":{"type":"salamander","password":"ob"},
		  "clients":[{"email":"a@xui.local","password":"pw"}]}`, stream)
	fragments := renderOne(t, marked)
	hy := fragments[0]
	if hy["type"] != "hysteria2" {
		t.Fatalf("expected hysteria2, got %#v", hy["type"])
	}
	if _, has := hy["listen_port_range"]; has {
		t.Fatalf("sing-box has no server-side port hopping; got %#v", hy["listen_port_range"])
	}
	obfs := hy["obfs"].(map[string]any)
	if obfs["type"] != "salamander" {
		t.Fatalf("bad obfs: %#v", obfs)
	}

	plain := inbound(model.Hysteria,
		`{"version":2,"clients":[{"email":"a@xui.local","auth":"pw"}]}`, stream)
	if _, err := BuildConfig([]*model.Inbound{plain}); err == nil {
		t.Fatal("unmarked hysteria must stay on xray")
	}
}

func TestBuildConfigAnytlsReality(t *testing.T) {
	ib := inbound(model.Anytls,
		`{"clients":[{"email":"a@xui.local","password":"pw"}]}`,
		`{"security":"reality","realitySettings":{"target":"127.0.0.1:7443",
		  "serverNames":["d.example.com"],"privateKey":"priv","shortIds":["ab12"]}}`)
	reality := renderOne(t, ib)[0]["tls"].(map[string]any)["reality"].(map[string]any)
	if reality["private_key"] != "priv" {
		t.Fatalf("bad private key: %#v", reality)
	}
	hs := reality["handshake"].(map[string]any)
	if hs["server"] != "127.0.0.1" || hs["server_port"] != float64(7443) {
		t.Fatalf("bad handshake: %#v", hs)
	}
	ids := reality["short_id"].([]any)
	if len(ids) != 1 || ids[0] != "ab12" {
		t.Fatalf("bad short ids: %#v", ids)
	}
}

func TestBuildConfigSkipsDisabledAndNodes(t *testing.T) {
	disabled := inbound(model.Anytls, `{"clients":[{"email":"a@b","password":"p"}]}`, `{}`)
	disabled.Enable = false
	nodeID := 3
	node := inbound(model.Anytls, `{"clients":[{"email":"a@b","password":"p"}]}`, `{}`)
	node.NodeID = &nodeID
	cfg, err := BuildConfig([]*model.Inbound{disabled, node})
	if err != nil {
		t.Fatalf("BuildConfig: %v", err)
	}
	if list := cfg["inbounds"].([]any); len(list) != 0 {
		t.Fatalf("expected no inbounds, got %#v", list)
	}
}

func TestHostedInboundsFilters(t *testing.T) {
	anytls := inbound(model.Anytls, `{"clients":[]}`, `{}`)
	vless := inbound(model.VLESS, `{}`, `{}`)
	unmarked := inbound(model.Hysteria, `{"version":2}`, `{}`)
	marked := inbound(model.Hysteria, `{"version":2,"core":"singbox"}`, `{}`)
	hosted := HostedInbounds([]*model.Inbound{anytls, vless, unmarked, marked})
	if len(hosted) != 2 || hosted[0].Protocol != model.Anytls || hosted[1].Protocol != model.Hysteria {
		t.Fatalf("bad filter result: %#v", hosted)
	}
}

func TestBuildConfigNaiveALPNQuic(t *testing.T) {
	ib := inbound(model.Naive,
		`{"clients":[{"email":"a@xui.local","password":"pw","username":"u"}]}`,
		`{"security":"tls","tlsSettings":{"serverName":"d.example.com","alpn":["h3"],
		  "certificates":[{"certificateFile":"/c.pem","keyFile":"/k.pem"}]}}`)
	naive := renderOne(t, ib)[0]
	if alpn := naive["tls"].(map[string]any)["alpn"].([]any); len(alpn) != 1 || alpn[0] != "h3" {
		t.Fatalf("bad alpn: %#v", naive["tls"])
	}
	users := naive["users"].([]any)
	if users[0].(map[string]any)["username"] != "u" {
		t.Fatalf("bad username: %#v", users)
	}
}

func TestBuildConfigJSONIsValid(t *testing.T) {
	ib := inbound(model.Anytls,
		`{"clients":[{"email":"a@xui.local","password":"pw"}]}`,
		`{"security":"tls","tlsSettings":{"certificates":[{"certificateFile":"/c.pem","keyFile":"/k.pem"}]}}`)
	raw, err := BuildConfigJSON([]*model.Inbound{ib})
	if err != nil {
		t.Fatalf("BuildConfigJSON: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("rendered config is not valid JSON: %v", err)
	}
	mustParse(t, string(raw))
}
