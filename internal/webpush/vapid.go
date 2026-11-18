package webpush

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

const (
	// tokenLifetime is how far out a token's exp is set (RFC 8292 allows
	// at most 24 hours).
	tokenLifetime = 12 * time.Hour
	// tokenReuse is how long a signed token is handed out again.
	tokenReuse = 11 * time.Hour
	// maxCachedTokens bounds the cache; past it the cache starts over.
	maxCachedTokens = 64
)

// GenerateKey makes a P-256 signing key for VAPID.
func GenerateKey() (*ecdsa.PrivateKey, error) {
	return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
}

// EncodePrivateKey is the key's 32-byte scalar in unpadded base64url, the
// form ParsePrivateKey reads.
func EncodePrivateKey(key *ecdsa.PrivateKey) (string, error) {
	scalar, err := key.Bytes()
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(scalar), nil
}

// ParsePrivateKey reads what EncodePrivateKey wrote.
func ParsePrivateKey(encoded string) (*ecdsa.PrivateKey, error) {
	scalar, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("webpush: signing key: %w", err)
	}
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), scalar)
	if err != nil {
		return nil, fmt.Errorf("webpush: signing key: %w", err)
	}
	return key, nil
}

// EncodePublicKey is the key's uncompressed point in unpadded base64url:
// the applicationServerKey a client subscribes with, and the k of the
// Authorization header.
func EncodePublicKey(key *ecdsa.PrivateKey) (string, error) {
	point, err := key.PublicKey.Bytes()
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(point), nil
}

// signToken is an ES256 JWT for one push service origin (RFC 8292 §2).
func signToken(key *ecdsa.PrivateKey, audience, subject string, expires time.Time) (string, error) {
	claims := map[string]any{"aud": audience, "exp": expires.Unix()}
	if subject != "" {
		claims["sub"] = subject
	}
	body, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signed := base64.RawURLEncoding.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`)) +
		"." + base64.RawURLEncoding.EncodeToString(body)
	digest := sha256.Sum256([]byte(signed))
	sigR, sigS, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	// JWS wants the two integers fixed-width and concatenated, not ASN.1.
	signature := make([]byte, 64)
	sigR.FillBytes(signature[:32])
	sigS.FillBytes(signature[32:])
	return signed + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

// tokenCache keeps the signed token of each origin for tokenReuse.
type tokenCache struct {
	mu     sync.Mutex
	tokens map[string]cachedToken
}

type cachedToken struct {
	token      string
	reuseUntil time.Time
}

func (c *tokenCache) get(key *ecdsa.PrivateKey, audience, subject string, now time.Time) (string, error) {
	// Wall-clock time only: exp is wall-clock, and the monotonic reading
	// stops while the host sleeps.
	now = now.Round(0)
	c.mu.Lock()
	defer c.mu.Unlock()
	if cached, ok := c.tokens[audience]; ok && now.Before(cached.reuseUntil) {
		return cached.token, nil
	}
	token, err := signToken(key, audience, subject, now.Add(tokenLifetime))
	if err != nil {
		return "", err
	}
	if c.tokens == nil || len(c.tokens) >= maxCachedTokens {
		c.tokens = make(map[string]cachedToken)
	}
	c.tokens[audience] = cachedToken{token: token, reuseUntil: now.Add(tokenReuse)}
	return token, nil
}
