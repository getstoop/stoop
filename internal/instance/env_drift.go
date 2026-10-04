package instance

import (
	"context"
	"slices"

	"github.com/getstoop/stoop/internal/trustedproxy"
)

// UseEnvSet supplies how to tell a variable set in .env from one left at
// its default, which EnvDrift needs for switches and defaulted values.
func (s *Service) UseEnvSet(isSet func(name string) bool) { s.envSet = isSet }

// EnvDrift names each environment variable that is set to a value
// different from the saved setting it seeded. The saved value is the one
// in force, so the caller warns: an operator who edits .env after the
// first start otherwise gets no sign it was ignored. Secrets are compared,
// never returned. Called after SeedFromEnv, so a freshly seeded setting
// never drifts.
func (s *Service) EnvDrift(ctx context.Context) ([]string, error) {
	if s.envSet == nil {
		return nil, nil
	}
	env := s.env.Reachability
	var drifted []string
	// differs records name when .env sets it and a saved row says
	// otherwise; a group with no row is the environment's.
	differs := func(name string, saved, same bool) {
		if s.envSet(name) && saved && !same {
			drifted = append(drifted, name)
		}
	}

	var publicURL string
	saved, err := s.readJSON(ctx, keyPublicURL, &publicURL)
	if err != nil {
		return nil, err
	}
	differs("STOOP_PUBLIC_URL", saved, publicURL == env.PublicURL)

	var proxies []string
	if saved, err = s.readJSON(ctx, keyTrustedProxies, &proxies); err != nil {
		return nil, err
	}
	differs("STOOP_TRUSTED_PROXIES", saved, sameAddresses(proxies, env.TrustedProxies))

	var relay TURNRelay
	if saved, err = s.readJSON(ctx, keyTURN, &relay); err != nil {
		return nil, err
	}
	differs("STOOP_TURN_URLS", saved, slices.Equal(relay.URLs, env.TURN.URLs))
	differs("STOOP_TURN_USERNAME", saved, relay.Username == env.TURN.Username)
	differs("STOOP_TURN_CREDENTIAL", saved, relay.Credential == env.TURN.Credential)
	differs("STOOP_STUN_URLS", saved, slices.Equal(relay.STUNURLs, env.TURN.STUNURLs))

	var cloudflare CloudflareTURN
	if saved, err = s.readJSON(ctx, keyCloudflareTURN, &cloudflare); err != nil {
		return nil, err
	}
	differs("STOOP_CLOUDFLARE_TURN_KEY_ID", saved, cloudflare.KeyID == env.Cloudflare.KeyID)
	differs("STOOP_CLOUDFLARE_TURN_API_TOKEN", saved, cloudflare.APIToken == env.Cloudflare.APIToken)

	var tailscale TailscaleSettings
	if saved, err = s.readJSON(ctx, keyTailscale, &tailscale); err != nil {
		return nil, err
	}
	differs("STOOP_TAILSCALE", saved, tailscale.Enabled == env.Tailscale.Enabled)
	differs("STOOP_TAILSCALE_HOSTNAME", saved, tailscale.Hostname == env.Tailscale.Hostname)
	differs("STOOP_TAILSCALE_FUNNEL", saved, tailscale.Funnel == env.Tailscale.Funnel)
	differs("STOOP_TAILSCALE_AUTHKEY", saved, tailscale.AuthKey == env.Tailscale.AuthKey)
	differs("STOOP_TAILSCALE_CONTROL_URL", saved, tailscale.ControlURL == env.Tailscale.ControlURL)

	var tunnel CloudflareTunnelSettings
	if saved, err = s.readJSON(ctx, keyCloudflareTunnel, &tunnel); err != nil {
		return nil, err
	}
	differs("STOOP_CLOUDFLARE_TUNNEL", saved, tunnel.Enabled == env.CloudflareTunnel.Enabled)
	differs("STOOP_CLOUDFLARE_TUNNEL_TOKEN", saved, tunnel.Token == env.CloudflareTunnel.Token)

	var providers []LoginProvider
	if saved, err = s.readJSON(ctx, keyLoginProviders, &providers); err != nil {
		return nil, err
	}
	for _, envProvider := range s.loginEnv {
		index := slices.IndexFunc(providers, func(provider LoginProvider) bool { return provider.ID == envProvider.ID })
		if index < 0 {
			differs("STOOP_OIDC_ISSUER", saved, false)
			continue
		}
		savedProvider := providers[index]
		differs("STOOP_OIDC_ISSUER", saved, savedProvider.Issuer == envProvider.Issuer)
		differs("STOOP_OIDC_CLIENT_ID", saved, savedProvider.ClientID == envProvider.ClientID)
		differs("STOOP_OIDC_CLIENT_SECRET", saved, savedProvider.ClientSecret == envProvider.ClientSecret)
		differs("STOOP_OIDC_NAME", saved, savedProvider.DisplayName == envProvider.DisplayName)
	}

	var password string
	if saved, err = s.readJSON(ctx, keyPasswordSignIn, &password); err != nil {
		return nil, err
	}
	differs("STOOP_PASSWORD_SIGN_IN", saved, password == s.passwordEnv)

	var name string
	if saved, err = s.readJSON(ctx, keyInstanceName, &name); err != nil {
		return nil, err
	}
	differs("STOOP_INSTANCE_NAME", saved, name == s.instanceNameEnv)
	return drifted, nil
}

// sameAddresses compares a saved list with the environment's as sets of
// addresses, ignoring order and how each one is written.
func sameAddresses(saved []string, env trustedproxy.Set) bool {
	parsed, err := trustedproxy.Parse(saved)
	if err != nil {
		return false
	}
	left, right := parsed.Strings(), env.Strings()
	slices.Sort(left)
	slices.Sort(right)
	return slices.Equal(left, right)
}
