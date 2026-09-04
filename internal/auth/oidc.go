package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// The OIDC client: discovery, the auth-code + PKCE exchange, and ID-token
// verification, all through go-oidc. Discovery results are cached so the
// start route doesn't pay a network round trip per click.

// oidcHTTPClient bounds every outbound call (discovery, JWKS, token,
// userinfo) so a dead issuer fails fast instead of holding the handler.
var oidcHTTPClient = &http.Client{Timeout: 10 * time.Second}

const oidcCacheTTL = time.Hour

type oidcCacheEntry struct {
	provider *oidc.Provider
	fetched  time.Time
}

// oidcFor returns a ready client for cfg, running discovery at most once
// per issuer+client per hour.
func (s *Service) oidcFor(ctx context.Context, cfg ProviderConfig) (*oidcProvider, error) {
	key := cfg.Issuer + "\x00" + cfg.ClientID
	if v, ok := s.oidcCache.Load(key); ok {
		e := v.(oidcCacheEntry)
		if time.Since(e.fetched) < oidcCacheTTL {
			return &oidcProvider{p: e.provider, cfg: cfg}, nil
		}
		s.oidcCache.Delete(key)
	}
	p, err := oidc.NewProvider(oidc.ClientContext(ctx, oidcHTTPClient), cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("discover %s: %w", cfg.Issuer, err)
	}
	s.oidcCache.Store(key, oidcCacheEntry{provider: p, fetched: time.Now()})
	return &oidcProvider{p: p, cfg: cfg}, nil
}

type oidcProvider struct {
	p   *oidc.Provider
	cfg ProviderConfig
}

func (o *oidcProvider) oauthConfig(redirectURI string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     o.cfg.ClientID,
		ClientSecret: o.cfg.ClientSecret,
		Endpoint:     o.p.Endpoint(),
		RedirectURL:  redirectURI,
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
}

func (o *oidcProvider) authURL(state, nonce, verifier, redirectURI string) string {
	return o.oauthConfig(redirectURI).AuthCodeURL(state,
		oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier))
}

func (o *oidcProvider) exchange(ctx context.Context, code, verifier, nonce, redirectURI string) (Claims, error) {
	ctx = oidc.ClientContext(ctx, oidcHTTPClient)
	tok, err := o.oauthConfig(redirectURI).Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return Claims{}, fmt.Errorf("token exchange: %w", err)
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		return Claims{}, errors.New("token response carried no id_token")
	}
	idToken, err := o.p.Verifier(&oidc.Config{ClientID: o.cfg.ClientID}).Verify(ctx, rawID)
	if err != nil {
		return Claims{}, fmt.Errorf("verify id_token: %w", err)
	}
	if idToken.Nonce != nonce {
		return Claims{}, errors.New("id_token nonce mismatch")
	}

	var c struct {
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		PreferredUsername string `json:"preferred_username"`
		Name              string `json:"name"`
		Picture           string `json:"picture"`
	}
	if err := idToken.Claims(&c); err != nil {
		return Claims{}, fmt.Errorf("decode claims: %w", err)
	}
	// Some issuers put profile claims only behind the userinfo endpoint;
	// one extra call fills the gaps when the ID token was sparse.
	if c.PreferredUsername == "" && c.Email == "" {
		if info, err := o.p.UserInfo(ctx, oauth2.StaticTokenSource(tok)); err == nil {
			var u struct {
				Email             string `json:"email"`
				EmailVerified     bool   `json:"email_verified"`
				PreferredUsername string `json:"preferred_username"`
				Name              string `json:"name"`
				Picture           string `json:"picture"`
			}
			if err := info.Claims(&u); err == nil {
				if c.Email == "" {
					c.Email, c.EmailVerified = u.Email, u.EmailVerified
				}
				if c.PreferredUsername == "" {
					c.PreferredUsername = u.PreferredUsername
				}
				if c.Name == "" {
					c.Name = u.Name
				}
				if c.Picture == "" {
					c.Picture = u.Picture
				}
			}
		}
	}
	return Claims{
		Subject:           idToken.Subject,
		Email:             c.Email,
		EmailVerified:     c.EmailVerified,
		PreferredUsername: c.PreferredUsername,
		Name:              c.Name,
		Picture:           c.Picture,
	}, nil
}

// oidcCache lives on the Service so tests get a fresh one per instance.
type oidcCache = sync.Map
