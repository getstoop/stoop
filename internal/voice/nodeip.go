package voice

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
)

// The tailnet address LiveKit advertises for media

// Because LiveKit cannot see the Stoop node's address it cannot offer it for negotiation.
// This is resolved by tracking the address in a shared volume that restarts the LiveKit sidecar
// when updated.
func WriteNodeIPFile(path, ip string) (changed bool, err error) {
	if ip != "" {
		addr, perr := netip.ParseAddr(ip)
		if perr != nil || !addr.Is4() {
			return false, fmt.Errorf("voice: %q is not an IPv4 address", ip)
		}
	}
	current, err := ReadNodeIPFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if current == ip {
		return false, nil
	}
	if ip == "" {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("voice: remove %q: %w", path, err)
		}
		return true, nil
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, fmt.Errorf("voice: create %q: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, ".node-ip-*")
	if err != nil {
		return false, fmt.Errorf("voice: create temp node ip file: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	if err = tmp.Chmod(0o644); err != nil {
		return false, fmt.Errorf("voice: chmod node ip file: %w", err)
	}
	if _, err = fmt.Fprintln(tmp, ip); err != nil {
		return false, fmt.Errorf("voice: write node ip file: %w", err)
	}
	if err = tmp.Sync(); err != nil {
		return false, fmt.Errorf("voice: sync node ip file: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return false, fmt.Errorf("voice: close node ip file: %w", err)
	}
	if err = os.Rename(tmp.Name(), path); err != nil {
		return false, fmt.Errorf("voice: rename node ip file into place: %w", err)
	}
	return true, nil
}

// ReadNodeIPFile returns the address recorded for LiveKit, or "" when the
// file is absent.
func ReadNodeIPFile(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}
