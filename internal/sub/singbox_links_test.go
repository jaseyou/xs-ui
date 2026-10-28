package sub

import (
	"net/url"
	"strings"
	"testing"

	"github.com/jaseyou/xs-ui/v3/internal/database/model"
)

func singboxTestInbound(protocol model.Protocol, settings, stream string) *model.Inbound {
	return &model.Inbound{
		Enable:         true,
		Protocol:       protocol,
		Port:           23456,
		Listen:         "203.0.113.10",
		Remark:         "tpl-test",
		Tag:            "tpl-test",
		Settings:       settings,
		StreamSettings: stream,
	}
}

func TestGenAnytlsLinkTLS(t *testing.T) {
	ib := singboxTestInbound(model.Anytls,
		`{"clients":[{"email":"a@xui.local","password":"pw1"}]}`,
		`{"security":"tls","tlsSettings":{"serverName":"d.example.com"}}`)
	link := (&SubService{}).GetLink(ib, "a@xui.local")
	if !strings.HasPrefix(link, "anytls://pw1@203.0.113.10:23456?") {
		t.Fatalf("bad anytls link: %s", link)
	}
	if !strings.Contains(link, "sni=d.example.com") || !strings.Contains(link, "insecure=0") {
		t.Fatalf("anytls link missing sni/insecure: %s", link)
	}
}

func TestGenAnytlsLinkReality(t *testing.T) {
	ib := singboxTestInbound(model.Anytls,
		`{"clients":[{"email":"a@xui.local","password":"pw1"}]}`,
		`{"security":"reality","realitySettings":{"target":"127.0.0.1:7443","serverNames":["d.example.com"],
		  "privateKey":"priv","shortIds":["ab12"],"settings":{"publicKey":"pub1","fingerprint":"chrome"}}}`)
	link := (&SubService{}).GetLink(ib, "a@xui.local")
	for _, want := range []string{"pbk=pub1", "sid=ab12", "fp=chrome", "sni=d.example.com"} {
		if !strings.Contains(link, want) {
			t.Fatalf("anytls reality link missing %s: %s", want, link)
		}
	}
}

func TestGenNaiveLinkSchemeByALPN(t *testing.T) {
	base := `{"clients":[{"email":"a@xui.local","password":"pw1"}]}`
	h3 := singboxTestInbound(model.Naive, base,
		`{"security":"tls","tlsSettings":{"alpn":["h3"],"serverName":"d.example.com"}}`)
	if link := (&SubService{}).GetLink(h3, "a@xui.local"); !strings.HasPrefix(link, "naive+quic://a%40xui.local:pw1@203.0.113.10:23456") {
		t.Fatalf("bad naive quic link: %s", link)
	}
	h2 := singboxTestInbound(model.Naive, base,
		`{"security":"tls","tlsSettings":{"alpn":["h2"],"serverName":"d.example.com"}}`)
	if link := (&SubService{}).GetLink(h2, "a@xui.local"); !strings.HasPrefix(link, "naive+https://") {
		t.Fatalf("bad naive h2 link: %s", link)
	}
}

func TestGenShadowtlsLink(t *testing.T) {
	ib := singboxTestInbound(model.Shadowtls,
		`{"version":3,"ssMethod":"2022-blake3-aes-128-gcm","ssPassword":"sspw",
		  "clients":[{"email":"a@xui.local","password":"stlspw"}]}`,
		`{"security":"reality","realitySettings":{"target":"127.0.0.1:7443","serverNames":["d.example.com"]}}`)
	link := (&SubService{}).GetLink(ib, "a@xui.local")
	if !strings.HasPrefix(link, "ss://") {
		t.Fatalf("expected ss:// link, got %s", link)
	}
	decoded, err := url.QueryUnescape(link)
	if err != nil {
		t.Fatalf("unescape: %v", err)
	}
	for _, want := range []string{"plugin=shadowtls", "version=3", "password=stlspw", "sni=d.example.com"} {
		if !strings.Contains(decoded, want) {
			t.Fatalf("shadowtls link missing %q: %s", want, decoded)
		}
	}
}

func TestGenLinksEmptyWithoutClient(t *testing.T) {
	ib := singboxTestInbound(model.Anytls, `{"clients":[]}`, `{}`)
	if link := (&SubService{}).GetLink(ib, "missing@x"); link != "" {
		t.Fatalf("expected empty link for missing client, got %s", link)
	}
}
