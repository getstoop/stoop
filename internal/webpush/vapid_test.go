package webpush

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/json"
	"math/big"
	"strings"
	"testing"
	"time"
)

// verifyToken checks a token's signature against the encoded public key
// and returns its header and claims.
func verifyToken(t *testing.T, token, publicKey string) (header, claims map[string]any) {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d parts", len(parts))
	}
	public, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), b64(t, publicKey))
	if err != nil {
		t.Fatalf("public key: %v", err)
	}
	signature := b64(t, parts[2])
	if len(signature) != 64 {
		t.Fatalf("signature is %d bytes, want 64", len(signature))
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	sigR, sigS := new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])
	if !ecdsa.Verify(public, digest[:], sigR, sigS) {
		t.Fatal("signature does not verify")
	}
	if err := json.Unmarshal(b64(t, parts[0]), &header); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b64(t, parts[1]), &claims); err != nil {
		t.Fatal(err)
	}
	return header, claims
}

func TestSignTokenVerifies(t *testing.T) {
	key, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	public, err := EncodePublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Unix(1_800_000_000, 0)
	token, err := signToken(key, "https://push.example.net", "mailto:admin@example.com", expires)
	if err != nil {
		t.Fatal(err)
	}
	header, claims := verifyToken(t, token, public)
	if header["alg"] != "ES256" || header["typ"] != "JWT" {
		t.Errorf("header = %v", header)
	}
	if claims["aud"] != "https://push.example.net" || claims["sub"] != "mailto:admin@example.com" {
		t.Errorf("claims = %v", claims)
	}
	if claims["exp"] != float64(expires.Unix()) {
		t.Errorf("exp = %v, want %d", claims["exp"], expires.Unix())
	}

	// A token signed by another key does not pass for this one.
	other, _ := GenerateKey()
	forged, _ := signToken(other, "https://push.example.net", "", expires)
	parts := strings.Split(forged, ".")
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	signature := b64(t, parts[2])
	if ecdsa.Verify(&key.PublicKey, digest[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		t.Fatal("another key's token verified")
	}
	if _, claims := verifyToken(t, forged, mustPublic(t, other)); claims["sub"] != nil {
		t.Errorf("an empty subject was written: %v", claims)
	}
}

func mustPublic(t *testing.T, key *ecdsa.PrivateKey) string {
	t.Helper()
	public, err := EncodePublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return public
}

func TestKeyRoundTrip(t *testing.T) {
	key, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := EncodePrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if raw := b64(t, encoded); len(raw) != 32 {
		t.Fatalf("private key is %d bytes, want 32", len(raw))
	}
	parsed, err := ParsePrivateKey(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !parsed.Equal(key) {
		t.Fatal("parsed key differs")
	}
	if raw := b64(t, mustPublic(t, parsed)); len(raw) != pointBytes || raw[0] != 4 {
		t.Fatalf("public key is not an uncompressed point: %d bytes", len(raw))
	}
	for _, bad := range []string{"", "not base64!", "AAAA", strings.Repeat("A", 43)} {
		if _, err := ParsePrivateKey(bad); err == nil {
			t.Errorf("ParsePrivateKey(%q) passed", bad)
		}
	}
}

func TestTokenCache(t *testing.T) {
	key, _ := GenerateKey()
	var cache tokenCache
	now := time.Unix(1_800_000_000, 0)
	first, err := cache.get(key, "https://one.example", "", now)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := cache.get(key, "https://one.example", "", now.Add(tokenReuse-time.Second)); again != first {
		t.Error("a fresh token was not reused")
	}
	if other, _ := cache.get(key, "https://two.example", "", now); other == first {
		t.Error("two origins share a token")
	}
	// The cache keeps wall-clock time, which a sleeping host cannot stall.
	if _, err := cache.get(key, "https://three.example", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if kept := cache.tokens["https://three.example"].reuseUntil; kept != kept.Round(0) {
		t.Error("the cache kept a monotonic clock reading")
	}
	later := now.Add(tokenReuse)
	renewed, _ := cache.get(key, "https://one.example", "", later)
	if renewed == first {
		t.Fatal("an old token was handed out")
	}
	_, claims := verifyToken(t, renewed, mustPublic(t, key))
	if claims["exp"] != float64(later.Add(tokenLifetime).Unix()) {
		t.Errorf("exp = %v, want 12 hours after signing", claims["exp"])
	}
}
