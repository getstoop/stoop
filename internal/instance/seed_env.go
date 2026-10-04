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
	return s.repairPreSeedRows(ctx)
}

// keyPreSeedRepaired marks that repairPreSeedRows has run, so it runs on
// the first start with seeding and never again.
const keyPreSeedRepaired = "pre_seed_rows_repaired"

// repairPreSeedRows fixes rows saved when an empty value meant "use
// .env". Only rows from before seeding mean that, so it runs once: after
// that, an empty row is a deliberate clear however it was saved.
func (s *Service) repairPreSeedRows(ctx context.Context) error {
	var done bool
	if ok, err := s.readJSON(ctx, keyPreSeedRepaired, &done); err != nil || ok {
		return err
	}
	if err := s.fillTunnelToken(ctx); err != nil {
		return err
	}
	if err := s.fillLoginProviders(ctx); err != nil {
		return err
	}
	return s.writeJSON(ctx, keyPreSeedRepaired, true)
}

// fillLoginProviders repairs an empty provider list saved when clearing
// the list fell back to STOOP_OIDC_*. With password sign-in restricted,
// read as empty it would leave members no way to sign in, so it takes the
// environment's provider.
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

// fillTunnelToken repairs a tunnel row whose switch was saved with a
// blank token while the environment's token was read at runtime: the
// blank meant "use .env", so it takes the environment's.
func (s *Service) fillTunnelToken(ctx context.Context) error {
	var saved CloudflareTunnelSettings
	ok, err := s.readJSON(ctx, keyCloudflareTunnel, &saved)
	if err != nil || !ok || saved.Token != "" || s.env.CloudflareTunnel.Token == "" {
		return err
	}
	saved.Token = s.env.CloudflareTunnel.Token
	return s.writeJSON(ctx, keyCloudflareTunnel, saved)
}
