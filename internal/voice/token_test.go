package voice

import (
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// parseToken verifies a token's signature and decodes its claims. Stoop
// never receives these tokens back, so only tests read one.
func parseToken(token, secret string) (tokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return tokenClaims{}, errors.New("malformed token")
	}
	enc := base64.RawURLEncoding
	sig, err := enc.DecodeString(parts[2])
	if err != nil {
		return tokenClaims{}, fmt.Errorf("decode signature: %w", err)
	}
	if !hmac.Equal(sig, sign(secret, parts[0]+"."+parts[1])) {
		return tokenClaims{}, errors.New("bad signature")
	}
	body, err := enc.DecodeString(parts[1])
	if err != nil {
		return tokenClaims{}, fmt.Errorf("decode claims: %w", err)
	}
	var claims tokenClaims
	if err := json.Unmarshal(body, &claims); err != nil {
		return tokenClaims{}, fmt.Errorf("parse claims: %w", err)
	}
	return claims, nil
}
