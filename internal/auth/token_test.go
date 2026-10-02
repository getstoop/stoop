package auth

import (
	"bytes"
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
	if !bytes.Equal(hash, hashToken(secret)) {
		t.Fatal("hash is not the hash of the secret")
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
