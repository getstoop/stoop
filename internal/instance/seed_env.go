package instance

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/getstoop/stoop/internal/dbgen"
)

// SeedFromEnv copies each environment-backed setting into the database
// when the environment sets it and nothing is saved for it yet. From then
// on the saved row is the setting: editing .env no longer changes it, and
// a row cleared from the admin page stays cleared. Runs at every start, so
// a group added to .env later is still picked up while it has no row.
// Called once every Use*Env has been supplied.
func (s *Service) SeedFromEnv(ctx context.Context) error {
	env := s.env.Reachability
	seeds := []struct {
		key   string
		set   bool
		value any
	}{
		{keyPublicURL, env.PublicURL != "", env.PublicURL},
		{keyTURN, len(env.TURN.URLs) > 0 || len(env.TURN.STUNURLs) > 0, env.TURN},
		{keyCloudflareTURN, env.Cloudflare.KeyID != "", env.Cloudflare},
		// STOOP_TAILSCALE_HOSTNAME has a default, so the hostname alone
		// doesn't count as the environment setting the group.
		{keyTailscale, env.Tailscale.Enabled || env.Tailscale.AuthKey != "" || env.Tailscale.ControlURL != "", env.Tailscale},
		{keyCloudflareTunnel, env.CloudflareTunnel.Enabled || env.CloudflareTunnel.Token != "", env.CloudflareTunnel},
		{keyTrustedProxies, !env.TrustedProxies.Empty(), env.TrustedProxies.Strings()},
		{keyLoginProviders, len(s.loginEnv) > 0, s.loginEnv},
		{keyPasswordSignIn, s.passwordEnv != "", s.passwordEnv},
	}
	for _, seed := range seeds {
		if !seed.set {
			continue
		}
		raw, err := json.Marshal(seed.value)
		if err != nil {
			return fmt.Errorf("encode %s: %w", seed.key, err)
		}
		if err := s.q.SeedSetting(ctx, dbgen.SeedSettingParams{Key: seed.key, Value: raw}); err != nil {
			return fmt.Errorf("seed %s: %w", seed.key, err)
		}
	}
	if err := s.fillTunnelToken(ctx); err != nil {
		return err
	}
	return s.fillLoginProviders(ctx)
}

// fillLoginProviders repairs an empty provider list saved before seeding
// existed, when clearing the list fell back to STOOP_OIDC_*. With password
// sign-in restricted, the empty list would leave members no way to sign
// in, a state the page now refuses to save, so such a row is always the
// old kind and takes the environment's provider.
func (s *Service) fillLoginProviders(ctx context.Context) error {
	if len(s.loginEnv) == 0 {
		return nil
	}
	var saved []LoginProvider
	ok, err := s.readJSON(ctx, keyLoginProviders, &saved)
	if err != nil || !ok || len(saved) > 0 {
		return err
	}
	password, err := s.PasswordSignIn(ctx)
	if err != nil || password == string(PasswordEveryone) {
		return err
	}
	return s.writeJSON(ctx, keyLoginProviders, s.loginEnv)
}

// fillTunnelToken repairs a tunnel row saved before seeding existed: the
// page saved the switch with a blank token and the environment's token
// was read at runtime. A blank token never meant "no token", so it takes
// the environment's.
func (s *Service) fillTunnelToken(ctx context.Context) error {
	var saved CloudflareTunnelSettings
	ok, err := s.readJSON(ctx, keyCloudflareTunnel, &saved)
	if err != nil || !ok || saved.Token != "" || s.env.CloudflareTunnel.Token == "" {
		return err
	}
	saved.Token = s.env.CloudflareTunnel.Token
	return s.writeJSON(ctx, keyCloudflareTunnel, saved)
}
