package instance

import (
	"context"
	"slices"

	"github.com/getstoop/stoop/internal/config"
)

// EnvDrift names each environment variable that sets a value different
// from the saved setting it seeded. The saved value is the one in force,
// so the caller warns: an operator who edits .env after the first start
// otherwise gets no sign it was ignored. Secrets are compared, never
// returned. Called after SeedFromEnv, so a freshly seeded setting never
// drifts.
func (s *Service) EnvDrift(ctx context.Context) ([]string, error) {
	env := s.env.Reachability
	var drifted []string
	// differs records name when the environment sets a value and a saved
	// row says otherwise; a group with no row is the environment's.
	differs := func(name string, envSets, saved, same bool) {
		if envSets && saved && !same {
			drifted = append(drifted, name)
		}
	}

	var publicURL string
	saved, err := s.readJSON(ctx, keyPublicURL, &publicURL)
	if err != nil {
		return nil, err
	}
	differs("STOOP_PUBLIC_URL", env.PublicURL != "", saved, publicURL == env.PublicURL)

	var proxies []string
	if saved, err = s.readJSON(ctx, keyTrustedProxies, &proxies); err != nil {
		return nil, err
	}
	differs("STOOP_TRUSTED_PROXIES", !env.TrustedProxies.Empty(), saved, slices.Equal(proxies, env.TrustedProxies.Strings()))

	var relay TURNRelay
	if saved, err = s.readJSON(ctx, keyTURN, &relay); err != nil {
		return nil, err
	}
	differs("STOOP_TURN_URLS", len(env.TURN.URLs) > 0, saved, slices.Equal(relay.URLs, env.TURN.URLs))
	differs("STOOP_TURN_USERNAME", env.TURN.Username != "", saved, relay.Username == env.TURN.Username)
	differs("STOOP_TURN_CREDENTIAL", env.TURN.Credential != "", saved, relay.Credential == env.TURN.Credential)
	differs("STOOP_STUN_URLS", len(env.TURN.STUNURLs) > 0, saved, slices.Equal(relay.STUNURLs, env.TURN.STUNURLs))

	var cloudflare CloudflareTURN
	if saved, err = s.readJSON(ctx, keyCloudflareTURN, &cloudflare); err != nil {
		return nil, err
	}
	differs("STOOP_CLOUDFLARE_TURN_KEY_ID", env.Cloudflare.KeyID != "", saved, cloudflare.KeyID == env.Cloudflare.KeyID)
	differs("STOOP_CLOUDFLARE_TURN_API_TOKEN", env.Cloudflare.APIToken != "", saved, cloudflare.APIToken == env.Cloudflare.APIToken)

	var tailscale TailscaleSettings
	if saved, err = s.readJSON(ctx, keyTailscale, &tailscale); err != nil {
		return nil, err
	}
	differs("STOOP_TAILSCALE", env.Tailscale.Enabled, saved, tailscale.Enabled)
	differs("STOOP_TAILSCALE_HOSTNAME", env.Tailscale.Hostname != config.DefaultTailscaleHostname, saved, tailscale.Hostname == env.Tailscale.Hostname)
	differs("STOOP_TAILSCALE_FUNNEL", env.Tailscale.Funnel, saved, tailscale.Funnel)
	differs("STOOP_TAILSCALE_AUTHKEY", env.Tailscale.AuthKey != "", saved, tailscale.AuthKey == env.Tailscale.AuthKey)
	differs("STOOP_TAILSCALE_CONTROL_URL", env.Tailscale.ControlURL != "", saved, tailscale.ControlURL == env.Tailscale.ControlURL)

	var tunnel CloudflareTunnelSettings
	if saved, err = s.readJSON(ctx, keyCloudflareTunnel, &tunnel); err != nil {
		return nil, err
	}
	differs("STOOP_CLOUDFLARE_TUNNEL", env.CloudflareTunnel.Enabled, saved, tunnel.Enabled)
	differs("STOOP_CLOUDFLARE_TUNNEL_TOKEN", env.CloudflareTunnel.Token != "", saved, tunnel.Token == env.CloudflareTunnel.Token)

	var providers []LoginProvider
	if saved, err = s.readJSON(ctx, keyLoginProviders, &providers); err != nil {
		return nil, err
	}
	for _, envProvider := range s.loginEnv {
		differs("STOOP_OIDC_*", true, saved, slices.Contains(providers, envProvider))
	}

	var password string
	if saved, err = s.readJSON(ctx, keyPasswordSignIn, &password); err != nil {
		return nil, err
	}
	differs("STOOP_PASSWORD_SIGN_IN", s.passwordEnv != "", saved, password == s.passwordEnv)

	var name string
	if saved, err = s.readJSON(ctx, keyInstanceName, &name); err != nil {
		return nil, err
	}
	differs("STOOP_INSTANCE_NAME", s.instanceNameEnv != "", saved, name == s.instanceNameEnv)
	return drifted, nil
}
