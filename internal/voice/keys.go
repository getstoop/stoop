package voice

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LiveKit API credentials. Stoop and the LiveKit server must hold the
// same pair: Stoop signs room tokens with it, LiveKit verifies them.
// Historically the operator generated a pair and copied it into two files
// by hand, which is a fine way to end up with working chat and voice that
// dies at join. Instead the server mints one on first boot, keeps it with
// the rest of its settings, and writes the file LiveKit reads.

// Keys is a LiveKit API key and its secret.
type Keys struct {
	APIKey    string `json:"api_key"`
	APISecret string `json:"api_secret"`
}

// Valid reports whether both halves are present. LiveKit requires the
// secret to be at least 32 characters.
func (k Keys) Valid() bool {
	return k.APIKey != "" && len(k.APISecret) >= 32
}

// GenerateKeys mints a pair in LiveKit's own shape: an "API"-prefixed id
// and a 256-bit secret.
func GenerateKeys() (Keys, error) {
	id, err := randomString(12)
	if err != nil {
		return Keys{}, err
	}
	secret, err := randomString(32)
	if err != nil {
		return Keys{}, err
	}
	return Keys{APIKey: "API" + id, APISecret: secret}, nil
}

func randomString(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("voice: read random bytes: %w", err)
	}
	// Unpadded base64url: no "/" or "=" to trip up YAML or a shell.
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// WriteKeyFile writes the pair where a LiveKit server can read it with
// --key-file. LiveKit refuses a key file that anyone else can read
// ("key file others permissions must be set to 0"), so the file is 0600
// and its directory 0700 — a sidecar running as root reads it regardless
// of owner, which is how the container case works.
//
// The write is atomic: a temp file in the same directory, renamed into
// place, so LiveKit never reads a half-written pair.
func WriteKeyFile(path string, k Keys) (err error) {
	if !k.Valid() {
		return fmt.Errorf("voice: refusing to write an incomplete key file")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("voice: create %q: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, ".keys-*")
	if err != nil {
		return fmt.Errorf("voice: create temp key file: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	// CreateTemp is already 0600; say so anyway, since LiveKit checks.
	if err := tmp.Chmod(0o600); err != nil {
		return fmt.Errorf("voice: chmod key file: %w", err)
	}
	if _, err := fmt.Fprintf(tmp, "%s: %s\n", k.APIKey, k.APISecret); err != nil {
		return fmt.Errorf("voice: write key file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("voice: sync key file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("voice: close key file: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("voice: rename key file into place: %w", err)
	}
	return nil
}

// ReadKeyFile reads a pair back, for tests and for anyone reconciling
// what the sidecar is actually using.
func ReadKeyFile(path string) (Keys, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Keys{}, err
	}
	id, secret, ok := strings.Cut(strings.TrimSpace(string(raw)), ":")
	if !ok {
		return Keys{}, fmt.Errorf("voice: %q is not a LiveKit key file", path)
	}
	return Keys{APIKey: strings.TrimSpace(id), APISecret: strings.TrimSpace(secret)}, nil
}
