package singbox

import (
	"os"
	"testing"

	"github.com/jaseyou/xs-ui/v3/internal/database/model"
)

// TestExportConfigForManualCheck renders the full template matrix to
// /tmp/sing-box-check.json. Run with:
//
//	go test ./internal/singbox/ -run TestExportConfigForManualCheck
//
// then validate the result with a real sing-box binary:
//	sing-box check -c /tmp/sing-box-check.json
func TestExportConfigForManualCheck(t *testing.T) {
	if os.Getenv("SINGBOX_EXPORT") == "" {
		t.Skip("set SINGBOX_EXPORT=1 to write /tmp/sing-box-check.json")
	}
	certs := `{"certificateFile":"/tmp/c.pem","keyFile":"/tmp/k.pem"}`
	tls := `{"security":"tls","tlsSettings":{"serverName":"d.example.com","alpn":["h3"],"certificates":[` + certs + `]}}`
	tlsH2 := `{"security":"tls","tlsSettings":{"serverName":"d.example.com","alpn":["h2","http/1.1"],"certificates":[` + certs + `]}}`
	reality := `{"security":"reality","realitySettings":{"target":"127.0.0.1:7443","serverNames":["d.example.com"],"privateKey":"wM-2_oQRWXyLcXhV5q1ifTBcS3K8mYR3wQI3PqGFK1k","shortIds":["a3f1"]}}`
	ibs := []*model.Inbound{
		{Enable: true, Protocol: model.Anytls, Port: 10001, Tag: "tpl-anytls-tls", Settings: `{"clients":[{"email":"a@x","password":"pw1"}]}`, StreamSettings: tlsH2},
		{Enable: true, Protocol: model.Anytls, Port: 10002, Tag: "tpl-anytls-reality", Settings: `{"clients":[{"email":"b@x","password":"pw2"}]}`, StreamSettings: reality},
		{Enable: true, Protocol: model.Shadowtls, Port: 10003, Tag: "tpl-shadowtls", Settings: `{"version":3,"ssMethod":"2022-blake3-aes-128-gcm","ssPassword":"8JCsPssfgS8tiRwiMlhARg==","clients":[{"email":"c@x","password":"pw3"}]}`, StreamSettings: reality},
		{Enable: true, Protocol: model.Naive, Port: 10004, Tag: "tpl-naive-quic", Settings: `{"clients":[{"email":"d@x","password":"pw4"}]}`, StreamSettings: tls},
		{Enable: true, Protocol: model.Naive, Port: 10005, Tag: "tpl-naive-tcp", Settings: `{"clients":[{"email":"e@x","password":"pw5"}]}`, StreamSettings: tlsH2},
		{Enable: true, Protocol: model.Hysteria, Port: 10006, Tag: "tpl-hy2", Settings: `{"version":2,"core":"singbox","portHopping":100,"obfs":{"type":"salamander","password":"obfspw"},"clients":[{"email":"f@x","password":"pw6"}]}`, StreamSettings: tls},
	}
	raw, err := BuildConfigJSON(ibs)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("/tmp/sing-box-check.json", raw, 0o644); err != nil {
		t.Fatal(err)
	}
}
