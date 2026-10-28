// Package singbox manages the sing-box sidecar core. Xray has no inbound
// implementation for anytls, shadowtls or naive, so inbounds using those
// protocols are rendered into a separate sing-box configuration and served by
// a second process that this package starts, stops and restarts alongside the
// panel's Xray core.
package singbox

import (
	"fmt"
	"os"
	"runtime"

	"github.com/jaseyou/xs-ui/v3/internal/config"
)

// GetBinaryName returns the sing-box binary filename for the current OS and
// architecture, mirroring the xray-<os>-<arch> naming convention.
func GetBinaryName() string {
	arch := runtime.GOARCH
	if arch == "arm" {
		arch = "arm32"
	}
	return fmt.Sprintf("sing-box-%s-%s", runtime.GOOS, arch)
}

// GetBinaryPath returns the full path to the sing-box binary. The
// XUI_SINGBOX_BIN environment variable overrides the default location next to
// the Xray binary, which is useful for distro-packaged sing-box builds.
func GetBinaryPath() string {
	if p := os.Getenv("XUI_SINGBOX_BIN"); p != "" {
		return p
	}
	return config.GetBinFolderPath() + "/" + GetBinaryName()
}

// GetConfigPath returns the path to the sing-box configuration file written
// next to the Xray config.
func GetConfigPath() string {
	return config.GetBinFolderPath() + "/sing-box.json"
}

// Available reports whether a sing-box binary is present and executable.
// When it is false the panel keeps serving every Xray-hosted inbound and only
// singbox-hosted ones report an error, so a missing binary never breaks the
// rest of the panel.
func Available() bool {
	info, err := os.Stat(GetBinaryPath())
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}
