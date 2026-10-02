package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestNewToken(t *testing.T) {
	secret, hash := newToken("stp_test_")
	if !strings.HasPrefix(secret, "stp_test_") {
		t.Fatalf("secret %q lacks the prefix", secret)
	}
	if got := len(strings.TrimPrefix(secret, "stp_test_")); got != 43 {
		t.Fatalf("random part is %d characters, want 43", got)
	}
	// Computed here, not through hashToken, so the test cannot agree with
	// a wrong helper.
	if want := sha256.Sum256([]byte(secret)); !bytes.Equal(hash, want[:]) {
		t.Fatal("hash is not the SHA-256 of the whole secret, prefix included")
	}
	if len(hash) != 32 {
		t.Fatalf("hash is %d bytes, want 32", len(hash))
	}
	other, _ := newToken("stp_test_")
	if other == secret {
		t.Fatal("two tokens are the same")
	}
}

func TestNewTokenWithoutPrefix(t *testing.T) {
	secret, _ := newToken("")
	if len(secret) != 43 {
		t.Fatalf("secret is %d characters, want 43", len(secret))
	}
}

// A known answer, so a stored hash from before this helper still matches.
func TestHashTokenKnownAnswer(t *testing.T) {
	got := hex.EncodeToString(hashToken("abc"))
	want := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got != want {
		t.Fatalf("hashToken(%q) = %s, want %s", "abc", got, want)
	}
}
