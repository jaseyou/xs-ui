//go:build !windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// restartRunningPanel nudges a live panel to re-read settings written by the
// CLI: the running process keeps its in-memory copy until SIGHUP triggers a
// full web-server restart. Best effort — a stopped panel picks the settings up
// on its next start.
func restartRunningPanel() {
	// Programmatic drivers (the node-e2e harness) set this while they orchestrate
	// restarts themselves.
	if os.Getenv("XUI_CLI_NO_RELOAD") != "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "pgrep", "-x", filepath.Base(os.Args[0])).Output()
	if err != nil {
		return
	}
	for _, pidStr := range strings.Fields(string(out)) {
		pid, err := strconv.Atoi(pidStr)
		if err != nil || pid == os.Getpid() {
			continue
		}
		if err := syscall.Kill(pid, syscall.SIGHUP); err == nil {
			fmt.Println("Running panel reloaded to apply the new settings.")
		}
	}
}
