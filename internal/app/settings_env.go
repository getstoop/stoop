package app

import (
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/instance"
)

// UseSettingsEnv hands the instance module what the environment sets for
// the settings it seeds (SeedFromEnv): reachability, the login provider and
// password sign-in. The tailnet address is the last-resort public URL,
// supplied separately. Shared with stoop admin, so it sees .env as the
// server does.
func UseSettingsEnv(inst *instance.Service, cfg config.Config) {
	inst.UseReachabilityEnv(instance.ReachabilityEnv{Reachability: instance.Reachability{
		PublicURL: cfg.PublicURL,
		TURN: instance.TURNRelay{
			URLs: cfg.TURNURLs, Username: cfg.TURNUsername, Credential: cfg.TURNCredential,
			STUNURLs: cfg.STUNURLs,
		},
		Cloudflare: instance.CloudflareTURN{KeyID: cfg.CloudflareTURNKeyID, APIToken: cfg.CloudflareTURNAPIToken},
		Tailscale: instance.TailscaleSettings{
			Enabled: cfg.Tailscale, Hostname: cfg.TailscaleHostname, Funnel: cfg.TailscaleFunnel,
			AuthKey: cfg.TailscaleAuthKey, ControlURL: cfg.TailscaleControlURL,
		},
		CloudflareTunnel: instance.CloudflareTunnelSettings{
			Enabled: cfg.CloudflareTunnel, Token: cfg.CloudflareTunnelToken,
		},
		TrustedProxies: cfg.TrustedProxies,
	}, VoiceOff: !cfg.Voice})
	if cfg.OIDCIssuer != "" {
		inst.UseLoginProvidersEnv([]instance.LoginProvider{{
			ID: cfg.OIDCID, Kind: instance.KindOIDC, DisplayName: cfg.OIDCName,
			Icon: "key", Issuer: cfg.OIDCIssuer,
			ClientID: cfg.OIDCClientID, ClientSecret: cfg.OIDCClientSecret,
		}})
	}
	inst.UsePasswordSignInEnv(cfg.PasswordSignIn)
	inst.UseInstanceNameEnv(cfg.InstanceName)
}
