package singbox

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/jaseyou/xs-ui/v3/internal/database/model"
	"github.com/jaseyou/xs-ui/v3/internal/logger"
)

// The sidecar is reconciled, not individually commanded: Reconcile renders the
// desired configuration from the DB inbounds, compares it against what the
// running process was started with, and starts/stops/restarts accordingly.
// Reconcile is called from XrayService.RestartXray, the same funnel every
// inbound change already goes through, so no extra hooks are needed.

var (
	mu           sync.Mutex
	cmd          *exec.Cmd
	done         chan struct{}
	startedAt    time.Time
	configHash   string
	intentional  bool
	warnedAbsent bool
)

// ErrBinaryMissing reports that no sing-box binary is available.
var ErrBinaryMissing = errors.New("sing-box binary not found; install it next to the xray binary or set XUI_SINGBOX_BIN")

// HostedInbounds filters the inbound list down to the ones the sing-box
// sidecar serves: anytls/shadowtls/naive plus hysteria rows marked for it.
func HostedInbounds(inbounds []*model.Inbound) []*model.Inbound {
	out := make([]*model.Inbound, 0, len(inbounds))
	for _, inbound := range inbounds {
		if !inbound.Enable || inbound.NodeID != nil {
			continue
		}
		switch inbound.Protocol {
		case model.Anytls, model.Shadowtls, model.Naive:
			out = append(out, inbound)
		case model.Hysteria:
			var settings map[string]any
			if inbound.Settings != "" && json.Unmarshal([]byte(inbound.Settings), &settings) == nil {
				if settings["core"] == "singbox" {
					out = append(out, inbound)
				}
			}
		}
	}
	return out
}

// Reconcile aligns the running sidecar with the desired configuration.
// A missing binary is reported once and never touches Xray.
func Reconcile(inbounds []*model.Inbound) error {
	hosted := HostedInbounds(inbounds)

	mu.Lock()
	defer mu.Unlock()

	if len(hosted) == 0 {
		configHash = ""
		stopLocked()
		return nil
	}

	jsonBytes, err := BuildConfigJSON(hosted)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(jsonBytes)
	hash := hex.EncodeToString(sum[:])

	if !Available() {
		if !warnedAbsent {
			warnedAbsent = true
			logger.Warning(ErrBinaryMissing.Error(), " (path: ", GetBinaryPath(), ")")
		}
		return ErrBinaryMissing
	}
	warnedAbsent = false

	if cmd != nil && hash == configHash {
		return nil
	}

	if err := os.WriteFile(GetConfigPath(), jsonBytes, 0o644); err != nil {
		return err
	}
	stopLocked()
	return startLocked(hash)
}

// IsRunning reports whether the sidecar process is currently up.
func IsRunning() bool {
	mu.Lock()
	defer mu.Unlock()
	return cmd != nil
}

// Stop terminates the sidecar. It is not started again until the next
// Reconcile with a non-empty configuration.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	intentional = true
	configHash = ""
	stopLocked()
}

func startLocked(hash string) error {
	intentional = false
	configHash = hash
	c := exec.Command(GetBinaryPath(), "run", "-c", GetConfigPath())
	if err := c.Start(); err != nil {
		return err
	}
	cmd = c
	startedAt = time.Now()
	finished := make(chan struct{})
	done = finished
	go func() {
		// Close the channel before taking the lock: stopLocked waits on the
		// channel while holding mu, so locking first would deadlock it.
		err := c.Wait()
		close(finished)
		mu.Lock()
		if cmd == c {
			cmd = nil
			startedAt = time.Time{}
		}
		wasIntentional := intentional
		mu.Unlock()
		if err != nil && !wasIntentional {
			logger.Warning("sing-box exited:", err)
			maybeAutoRestart(c)
		} else if err == nil {
			logger.Info("sing-box stopped")
		}
	}()
	logger.Info("sing-box started")
	return nil
}

// maybeAutoRestart restarts a sidecar that died unexpectedly, but only after a
// stable run: a binary that cannot parse its config would otherwise crash-loop.
func maybeAutoRestart(dead *exec.Cmd) {
	mu.Lock()
	if intentional || configHash == "" || cmd != nil {
		mu.Unlock()
		return
	}
	if startedAt.IsZero() || time.Since(startedAt) < 30*time.Second {
		mu.Unlock()
		return
	}
	hash := configHash
	mu.Unlock()
	time.AfterFunc(5*time.Second, func() {
		mu.Lock()
		defer mu.Unlock()
		if intentional || configHash == "" || configHash != hash || cmd != nil {
			return
		}
		if err := startLocked(hash); err != nil {
			logger.Warning("sing-box auto-restart failed:", err)
		}
	})
}

// stopLocked terminates the running process. Called with mu held; the process
// is considered stopped the moment its Wait goroutine closed the channel.
func stopLocked() {
	if cmd == nil {
		return
	}
	current := cmd
	finished := done
	cmd = nil
	done = nil
	intentional = true
	if current.Process == nil {
		return
	}
	_ = current.Process.Signal(syscall.SIGTERM)
	if finished == nil {
		return
	}
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		_ = current.Process.Kill()
		<-finished
	}
}
