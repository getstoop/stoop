package voice

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// LiveKit access tokens are plain HS256 JWTs carrying a "video" grant
// (https://docs.livekit.io/home/get-started/authentication/). Minting one
// needs only the standard library, so we don't pull in livekit/protocol
// (and its dependency tree) for a single claim struct. rooms.go signs
// LiveKit's room API with the same tokens.

// videoGrant is the subset of LiveKit's VideoGrant that Stoop issues.
type videoGrant struct {
	Room           string `json:"room"`
	RoomJoin       bool   `json:"roomJoin,omitempty"`
	CanPublish     bool   `json:"canPublish,omitempty"`
	CanSubscribe   bool   `json:"canSubscribe,omitempty"`
	CanPublishData bool   `json:"canPublishData,omitempty"`
	RoomAdmin      bool   `json:"roomAdmin,omitempty"`
	RoomCreate     bool   `json:"roomCreate,omitempty"`
}

// joinGrant lets one participant into one room, publishing any source.
func joinGrant(room string) videoGrant {
	return videoGrant{
		Room: room, RoomJoin: true,
		CanPublish: true, CanSubscribe: true, CanPublishData: true,
	}
}

// tokenClaims is the JWT body LiveKit expects.
type tokenClaims struct {
	Issuer    string     `json:"iss"`
	Subject   string     `json:"sub"`
	NotBefore int64      `json:"nbf"`
	ExpiresAt int64      `json:"exp"`
	Name      string     `json:"name,omitempty"`
	Video     videoGrant `json:"video"`
}

type tokenParams struct {
	apiKey, apiSecret string
	identity, name    string
	grant             videoGrant
	ttl               time.Duration
	now               time.Time
}

// mintToken builds a token carrying one video grant.
func mintToken(p tokenParams) (string, error) {
	if p.apiKey == "" || p.apiSecret == "" {
		return "", errors.New("livekit api key and secret are required")
	}
	claims := tokenClaims{
		Issuer:    p.apiKey,
		Subject:   p.identity,
		NotBefore: p.now.Unix(),
		ExpiresAt: p.now.Add(p.ttl).Unix(),
		Name:      p.name,
		Video:     p.grant,
	}
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding
	signingInput := enc.EncodeToString(header) + "." + enc.EncodeToString(body)
	return signingInput + "." + enc.EncodeToString(sign(p.apiSecret, signingInput)), nil
}

func sign(secret, input string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input))
	return mac.Sum(nil)
}

// parseToken verifies a token's signature and decodes its claims. Stoop
// never receives these tokens back — this exists for tests and the CLI.
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
