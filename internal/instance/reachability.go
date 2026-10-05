package instance

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/trustedproxy"
)

// Reachability — how people reach this server — is pre-configured from
// the environment and then owned by the database: SeedFromEnv copies each
// group into a missing row at start, and a saved row, empty included, is
// the setting from then on. The environment is read directly only for a
// group with no row (a database wiped under a running server).

// Reachability is the effective set.
type Reachability struct {
	PublicURL  string
	TURN       TURNRelay
	Cloudflare CloudflareTURN
	Tailscale  TailscaleSettings
	// CloudflareTunnel is the connector; Cloudflare above is the TURN relay.
	CloudflareTunnel CloudflareTunnelSettings
	// TrustedProxies is deliberately not tied to any of the above: an
	// internal proxy can sit in front of a tunnel, a tailnet, or nothing.
	TrustedProxies trustedproxy.Set
}

// ReachabilityEnv is what the environment provides: the seed for a group
// with no row.
type ReachabilityEnv struct {
	Reachability
	VoiceConfigured bool
	// VoiceOff: the operator turned voice off (STOOP_VOICE=false).
	VoiceOff bool
}

// VoiceAvailable reports whether voice channels work on this server.
// Also chat's port.
func (s *Service) VoiceAvailable() bool { return s.env.VoiceConfigured }

// UseReachabilityEnv supplies the environment values.
func (s *Service) UseReachabilityEnv(env ReachabilityEnv) { s.env = env }

// UseVoiceConfigured records whether voice works here, which is known only
// once the voice module is built. Call it after UseReachabilityEnv.
func (s *Service) UseVoiceConfigured(configured bool) { s.env.VoiceConfigured = configured }

// Reachability is the configuration in force: each group's saved row,
// or the environment for a group with none.
func (s *Service) Reachability(ctx context.Context) (Reachability, error) {
	r := s.env.Reachability
	ctx, err := s.withSettings(ctx)
	if err != nil {
		return r, err
	}
	var pu string
	if ok, err := s.readJSON(ctx, keyPublicURL, &pu); err != nil {
		return r, err
	} else if ok {
		r.PublicURL = pu
	}
	var t TURNRelay
	if ok, err := s.readJSON(ctx, keyTURN, &t); err != nil {
		return r, err
	} else if ok {
		r.TURN = t
	}
	var cf CloudflareTURN
	if ok, err := s.readJSON(ctx, keyCloudflareTURN, &cf); err != nil {
		return r, err
	} else if ok {
		r.Cloudflare = cf
	}
	var ts TailscaleSettings
	if ok, err := s.readJSON(ctx, keyTailscale, &ts); err != nil {
		return r, err
	} else if ok {
		r.Tailscale = ts
	}
	var ct CloudflareTunnelSettings
	if ok, err := s.readJSON(ctx, keyCloudflareTunnel, &ct); err != nil {
		return r, err
	} else if ok {
		r.CloudflareTunnel = ct
	}
	tp, err := s.trustedProxies(ctx)
	if err != nil {
		return r, err
	}
	r.TrustedProxies = tp
	return r, nil
}

func (s *Service) GetReachability(ctx context.Context, _ *connect.Request[instancev1.GetReachabilityRequest]) (*connect.Response[instancev1.GetReachabilityResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	resp, err := s.reachabilityResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) UpdateReachability(ctx context.Context, req *connect.Request[instancev1.UpdateReachabilityRequest]) (*connect.Response[instancev1.UpdateReachabilityResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceSettingsManage); err != nil {
		return nil, err
	}
	if err := s.SaveReachability(ctx, req.Msg); err != nil {
		return nil, err
	}
	resp, err := s.reachabilityResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateReachabilityResponse{Reachability: resp}), nil
}

// SaveReachability saves the groups set in msg. Shared by the admin page
// and stoop admin, which checks no permission.
func (s *Service) SaveReachability(ctx context.Context, msg *instancev1.UpdateReachabilityRequest) error {
	current, err := s.Reachability(ctx)
	if err != nil {
		return err
	}
	// Every group is validated before anything is written, and the
	// controllers are told only once the writes have committed.
	var writes []settingWrite
	if msg.PublicUrl != nil {
		pu := strings.TrimSpace(*msg.PublicUrl)
		if pu != "" {
			if pu, err = validatePublicURL(pu); err != nil {
				return err
			}
		}
		writes = append(writes, settingWrite{keyPublicURL, pu})
	}
	if in := msg.Turn; in != nil {
		relay := TURNRelay{
			URLs: trimAll(in.Urls), Username: strings.TrimSpace(in.Username),
			Credential: keepSecret(in.Credential, current.TURN.Credential), STUNURLs: trimAll(in.StunUrls),
		}
		if len(relay.URLs) == 0 && len(relay.STUNURLs) == 0 {
			relay = TURNRelay{}
		} else if err := validateTURN(relay); err != nil {
			return err
		}
		writes = append(writes, settingWrite{keyTURN, relay})
	}
	if in := msg.Cloudflare; in != nil {
		cf := CloudflareTURN{KeyID: strings.TrimSpace(in.KeyId), APIToken: strings.TrimSpace(in.ApiToken)}
		if cf.KeyID == "" {
			cf = CloudflareTURN{}
		} else {
			// The token in force belongs to its key; a new key needs its own.
			if current.Cloudflare.KeyID == cf.KeyID {
				cf.APIToken = keepSecret(cf.APIToken, current.Cloudflare.APIToken)
			}
			if cf.APIToken == "" {
				return apierr.Field(connect.CodeInvalidArgument, "cloudflare.api_token",
					errors.New("cloudflare TURN needs the key's API token"))
			}
		}
		writes = append(writes, settingWrite{keyCloudflareTURN, cf})
	}
	var tailscale *TailscaleSettings
	if in := msg.Tailscale; in != nil {
		ts := TailscaleSettings{
			Enabled: in.Enabled, Hostname: strings.TrimSpace(in.Hostname), Funnel: in.Funnel,
			AuthKey:    keepSecret(strings.TrimSpace(in.AuthKey), current.Tailscale.AuthKey),
			ControlURL: strings.TrimSpace(in.ControlUrl),
		}
		if ts.Hostname != "" && !validHostname(ts.Hostname) {
			return apierr.Field(connect.CodeInvalidArgument, "tailscale.hostname",
				errors.New("the node name must be letters, digits, and hyphens"))
		}
		if ts.ControlURL != "" {
			if _, ok := config.HTTPURL(ts.ControlURL); !ok {
				return apierr.Field(connect.CodeInvalidArgument, "tailscale.control_url",
					errors.New("the control URL must be an http(s) URL"))
			}
		}
		tailscale = &ts
		writes = append(writes, settingWrite{keyTailscale, ts})
	}
	var tunnel *CloudflareTunnelSettings
	if in := msg.CloudflareTunnel; in != nil {
		ct, err := cloudflareTunnelSetting(in.Enabled, in.Token, current.CloudflareTunnel)
		if err != nil {
			return err
		}
		tunnel = &ct
		writes = append(writes, settingWrite{keyCloudflareTunnel, ct})
	}
	if msg.TrustedProxies != nil {
		cidrs := trimAll(msg.TrustedProxies.Cidrs)
		if len(cidrs) > maxTrustedProxies {
			return apierr.Field(connect.CodeInvalidArgument, "trusted_proxies.cidrs",
				fmt.Errorf("at most %d trusted proxy addresses", maxTrustedProxies))
		}
		if _, err := trustedproxy.Parse(cidrs); err != nil {
			return apierr.Field(connect.CodeInvalidArgument, "trusted_proxies.cidrs", err)
		}
		if cidrs == nil {
			cidrs = []string{}
		}
		writes = append(writes, settingWrite{keyTrustedProxies, cidrs})
	}
	if err := s.writeSettings(ctx, writes); err != nil {
		return err
	}
	if tailscale != nil && s.tailscale != nil {
		s.tailscale.Apply(*tailscale)
	}
	if tunnel != nil && s.tunnel != nil {
		s.tunnel.Apply(*tunnel)
	}
	// Applied without a restart: every request reads the cache, so
	// refreshing it here is all a change needs.
	return s.LoadTrustedProxies(ctx)
}

func (s *Service) reachabilityResponse(ctx context.Context) (*instancev1.GetReachabilityResponse, error) {
	r, err := s.Reachability(ctx)
	if err != nil {
		return nil, err
	}
	resp := &instancev1.GetReachabilityResponse{
		Reachability: &instancev1.Reachability{
			PublicUrl: r.PublicURL,
			Turn: &instancev1.TurnRelay{
				Urls: r.TURN.URLs, Username: r.TURN.Username,
				HasCredential: r.TURN.Credential != "", StunUrls: r.TURN.STUNURLs,
			},
			Cloudflare: &instancev1.CloudflareTurn{
				KeyId: r.Cloudflare.KeyID, HasApiToken: r.Cloudflare.APIToken != "",
			},
			Tailscale: &instancev1.TailscaleSettings{
				Enabled: r.Tailscale.Enabled, Hostname: r.Tailscale.Hostname, Funnel: r.Tailscale.Funnel,
				HasAuthKey: r.Tailscale.AuthKey != "", ControlUrl: r.Tailscale.ControlURL,
			},
			TrustedProxies: &instancev1.TrustedProxies{
				Cidrs: r.TrustedProxies.Strings(),
			},
			CloudflareTunnel: &instancev1.CloudflareTunnelSettings{
				Enabled: r.CloudflareTunnel.Enabled, HasToken: r.CloudflareTunnel.Token != "",
			},
		},
		Tailscale:        &instancev1.TailscaleStatus{},
		VoiceConfigured:  s.env.VoiceConfigured,
		VoiceOff:         s.env.VoiceOff,
		HostTailscale:    hostHasTailscale(),
		Livekit:          &instancev1.LiveKitStatus{},
		CloudflareTunnel: &instancev1.CloudflareTunnelStatus{},
	}
	if s.tunnel != nil {
		ct := s.tunnel.Status()
		resp.CloudflareTunnel = &instancev1.CloudflareTunnelStatus{
			Enabled: ct.Enabled, State: ct.State, Error: ct.Error,
		}
	}
	if s.livekit != nil {
		lk := s.livekit.LiveKitStatus(ctx)
		resp.Livekit = &instancev1.LiveKitStatus{Running: lk.Running, Url: lk.URL}
	}
	if s.tailscale != nil {
		ts := s.tailscale.Status(ctx)
		resp.Tailscale = &instancev1.TailscaleStatus{
			Enabled: ts.Enabled, State: ts.State, LoginUrl: ts.LoginURL,
			Url: ts.URL, Funnel: ts.Funnel, Error: ts.Error,
			TailnetIp: ts.TailnetIP, CarriesVoice: ts.CarriesVoice,
		}
	}
	return resp, nil
}
