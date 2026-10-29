//go:build windows

package main

// restartRunningPanel is a no-op on Windows: POSIX signals don't exist there,
// and the CLI runs alongside a service-managed panel. Windows operators apply
// new settings via the service restart (`xs-ui restart`).
func restartRunningPanel() {}
