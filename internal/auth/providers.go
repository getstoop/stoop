package auth

import (
	"context"
	"fmt"
)

// Login providers: sign-in with an identity from an OIDC issuer. Auth
// owns the flow and the identities; the provider *configuration* lives in
// the instance module and reaches auth through the ProviderSource port
// (wired in internal/app), like RegistrationPolicy.

// Provider kinds. Only OIDC exists today; plain-OAuth2 presets (GitHub,
// Discord) would add kinds with their own claim mapping.
const KindOIDC = "oidc"

// ProviderConfig is one effective provider, secret included (in-process
// only; the admin API never returns secrets).
type ProviderConfig struct {
	ID           string
	Kind         string
	DisplayName  string
	Issuer       string
	ClientID     string
	ClientSecret string
}

// Claims is what a provider asserts about the person after the exchange.
// Only Subject is guaranteed; everything else is best-effort.
type Claims struct {
	Subject           string
	Email             string
	EmailVerified     bool
	PreferredUsername string
	Name              string
	Picture           string
}

// ProviderSource is auth's port for provider configuration; backed by the
// instance module, wired in internal/app.
type ProviderSource interface {
	// LoginProvider resolves one effective provider by id.
	LoginProvider(ctx context.Context, id string) (ProviderConfig, error)
	// CallbackURL is the exact redirect URI registered with the provider,
	// built from the effective public URL; empty when none is configured.
	CallbackURL(ctx context.Context, id string) (string, error)
}

// UseProviders wires the provider-configuration port. Set once at
// startup; without it the login flow reports every provider unknown.
func (s *Service) UseProviders(src ProviderSource) { s.providers = src }

// provider is one ready-to-use client for a configured provider.
type provider interface {
	// authURL is where the browser is sent to sign in.
	authURL(state, nonce, verifier, redirectURI string) string
	// exchange redeems the authorization code and verifies what came
	// back. Provider tokens live and die inside this call.
	exchange(ctx context.Context, code, verifier, nonce, redirectURI string) (Claims, error)
}

func (s *Service) providerFor(ctx context.Context, cfg ProviderConfig) (provider, error) {
	switch cfg.Kind {
	case KindOIDC, "":
		return s.oidcFor(ctx, cfg)
	default:
		return nil, fmt.Errorf("unknown provider kind %q", cfg.Kind)
	}
}
