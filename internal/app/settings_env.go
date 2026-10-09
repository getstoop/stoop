package app

import (
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/mail"
)

// UseSettingsEnv hands the instance module what the environment sets for
// the settings it seeds (SeedFromEnv): reachability, the login provider,
// password sign-in and the mail server. The tailnet address is the
// last-resort public URL, supplied separately. Shared with stoop admin, so
// it sees .env as the server does.
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
	inst.UseSMTPEnv(instance.SMTP{
		Host: cfg.SMTPHost, Port: cfg.SMTPPort, Security: mail.Security(cfg.SMTPSecurity),
		Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
		FromAddress: cfg.SMTPFrom, FromName: cfg.SMTPFromName, HourlyLimit: cfg.SMTPHourlyLimit,
	})
}
