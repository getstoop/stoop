package instance

import (
	"context"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
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
	inForce := s.env.Reachability
	ctx, err := s.withSettings(ctx)
	if err != nil {
		return inForce, err
	}
	if inForce.PublicURL, err = readSettingOr(ctx, s, keyPublicURL, inForce.PublicURL); err != nil {
		return inForce, err
	}
	if inForce.TURN, err = readSettingOr(ctx, s, keyTURN, inForce.TURN); err != nil {
		return inForce, err
	}
	if inForce.Cloudflare, err = readSettingOr(ctx, s, keyCloudflareTURN, inForce.Cloudflare); err != nil {
		return inForce, err
	}
	if inForce.Tailscale, err = readSettingOr(ctx, s, keyTailscale, inForce.Tailscale); err != nil {
		return inForce, err
	}
	if inForce.CloudflareTunnel, err = readSettingOr(ctx, s, keyCloudflareTunnel, inForce.CloudflareTunnel); err != nil {
		return inForce, err
	}
	if inForce.TrustedProxies, err = s.trustedProxies(ctx); err != nil {
		return inForce, err
	}
	return inForce, nil
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
	save := &settingSave{}
	for _, stage := range []func(*instancev1.UpdateReachabilityRequest, Reachability, *settingSave) error{
		stagePublicURL, stageTURN, stageCloudflareTURN, s.stageTailscale, s.stageCloudflareTunnel, stageTrustedProxies,
	} {
		if err := stage(msg, current, save); err != nil {
			return err
		}
	}
	if err := s.commit(ctx, save); err != nil {
		return err
	}
	// Applied without a restart: every request reads the cache, so
	// refreshing it here is all a change needs.
	return s.LoadTrustedProxies(ctx)
}

func (s *Service) reachabilityResponse(ctx context.Context) (*instancev1.GetReachabilityResponse, error) {
	inForce, err := s.Reachability(ctx)
	if err != nil {
		return nil, err
	}
	resp := &instancev1.GetReachabilityResponse{
		Reachability: &instancev1.Reachability{
			PublicUrl:        inForce.PublicURL,
			Turn:             inForce.TURN.toProto(),
			Cloudflare:       inForce.Cloudflare.toProto(),
			Tailscale:        inForce.Tailscale.toProto(),
			TrustedProxies:   &instancev1.TrustedProxies{Cidrs: inForce.TrustedProxies.Strings()},
			CloudflareTunnel: inForce.CloudflareTunnel.toProto(),
		},
		Tailscale:        &instancev1.TailscaleStatus{},
		VoiceConfigured:  s.env.VoiceConfigured,
		VoiceOff:         s.env.VoiceOff,
		HostTailscale:    hostHasTailscale(),
		Livekit:          &instancev1.LiveKitStatus{},
		CloudflareTunnel: &instancev1.CloudflareTunnelStatus{},
	}
	if s.tunnel != nil {
		resp.CloudflareTunnel = s.tunnel.Status().toProto()
	}
	if s.livekit != nil {
		resp.Livekit = s.livekit.LiveKitStatus(ctx).toProto()
	}
	if s.tailscale != nil {
		resp.Tailscale = s.tailscale.Status(ctx).toProto()
	}
	return resp, nil
}
