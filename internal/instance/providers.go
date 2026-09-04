package instance

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// Login providers: external identities people can sign in with (OIDC).
// Saved from the admin page with env fallback, same rule as reachability:
// a saved list overrides STOOP_OIDC_*; clearing it falls back. The auth
// module consumes the effective list through its ProviderSource port.

const keyLoginProviders = "login_providers"

// maxLoginProviders bounds the saved list; a homelab has one or two.
const maxLoginProviders = 16

// KindOIDC is the only provider kind today; GitHub/Discord-style plain
// OAuth2 presets would add kinds.
const KindOIDC = "oidc"

var providerIDRE = regexp.MustCompile(`^[a-z0-9_-]{2,32}$`)

// providerIcons is the set the web client can draw.
var providerIcons = map[string]bool{"google": true, "microsoft": true, "key": true, "none": true}

// LoginProvider is one configured provider as stored (JSON, secret
// included; the secret never crosses the API outward).
type LoginProvider struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	DisplayName  string `json:"display_name"`
	Icon         string `json:"icon"`
	Issuer       string `json:"issuer"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// UseLoginProvidersEnv supplies the environment fallback (STOOP_OIDC_*).
func (s *Service) UseLoginProvidersEnv(ps []LoginProvider) { s.loginEnv = ps }

// LoginProviders is the effective list: the saved one when present and
// non-empty, the environment otherwise.
func (s *Service) LoginProviders(ctx context.Context) ([]LoginProvider, error) {
	saved, ok, err := s.savedLoginProviders(ctx)
	if err != nil {
		return nil, err
	}
	if ok && len(saved) > 0 {
		return saved, nil
	}
	return s.loginEnv, nil
}

func (s *Service) savedLoginProviders(ctx context.Context) ([]LoginProvider, bool, error) {
	var saved []LoginProvider
	ok, err := s.readJSON(ctx, keyLoginProviders, &saved)
	return saved, ok, err
}

// LoginProvider returns one effective provider with its secret, for the
// auth module's ProviderSource port. In-process only.
func (s *Service) LoginProvider(ctx context.Context, id string) (LoginProvider, error) {
	ps, err := s.LoginProviders(ctx)
	if err != nil {
		return LoginProvider{}, err
	}
	for _, p := range ps {
		if p.ID == id {
			return p, nil
		}
	}
	return LoginProvider{}, connect.NewError(connect.CodeNotFound,
		fmt.Errorf("login provider %q not found", id))
}

// CallbackURL is the redirect URI for one provider, built from the
// effective public URL; empty when no public URL is configured.
func (s *Service) CallbackURL(ctx context.Context, id string) (string, error) {
	pu, err := s.PublicURL(ctx)
	if err != nil || pu == "" {
		return "", err
	}
	return pu + "/auth/callback/" + id, nil
}

func (s *Service) GetLoginProviders(ctx context.Context, _ *connect.Request[instancev1.GetLoginProvidersRequest]) (*connect.Response[instancev1.GetLoginProvidersResponse], error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	resp, err := s.loginProvidersResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) loginProvidersResponse(ctx context.Context) (*instancev1.GetLoginProvidersResponse, error) {
	saved, ok, err := s.savedLoginProviders(ctx)
	if err != nil {
		return nil, err
	}
	ps, fromEnv := saved, false
	if !ok || len(saved) == 0 {
		ps, fromEnv = s.loginEnv, true
	}
	out := make([]*instancev1.LoginProvider, len(ps))
	for i, p := range ps {
		cb, err := s.CallbackURL(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		out[i] = &instancev1.LoginProvider{
			Id:              p.ID,
			Kind:            instancev1.LoginProviderKind_LOGIN_PROVIDER_KIND_OIDC,
			DisplayName:     p.DisplayName,
			Icon:            p.Icon,
			Issuer:          p.Issuer,
			HasClientSecret: p.ClientSecret != "",
			ClientId:        p.ClientID,
			CallbackUrl:     cb,
			FromEnv:         fromEnv,
		}
	}
	return &instancev1.GetLoginProvidersResponse{Providers: out}, nil
}

func (s *Service) UpdateLoginProviders(ctx context.Context, req *connect.Request[instancev1.UpdateLoginProvidersRequest]) (*connect.Response[instancev1.UpdateLoginProvidersResponse], error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	if len(req.Msg.Providers) > maxLoginProviders {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("at most %d login providers", maxLoginProviders))
	}
	saved, _, err := s.savedLoginProviders(ctx)
	if err != nil {
		return nil, err
	}
	prior := make(map[string]LoginProvider, len(saved))
	for _, p := range saved {
		prior[p.ID] = p
	}

	next := make([]LoginProvider, 0, len(req.Msg.Providers))
	seen := make(map[string]bool)
	for _, in := range req.Msg.Providers {
		p, err := validateLoginProvider(in)
		if err != nil {
			return nil, err
		}
		if seen[p.ID] {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("duplicate provider id %q", p.ID))
		}
		seen[p.ID] = true
		// A blank secret keeps the saved one, as long as the client id it
		// belongs to is unchanged (same rule as the Cloudflare TURN token).
		if p.ClientSecret == "" {
			if prev, ok := prior[p.ID]; ok && prev.ClientID == p.ClientID {
				p.ClientSecret = prev.ClientSecret
			}
			if p.ClientSecret == "" {
				return nil, connect.NewError(connect.CodeInvalidArgument,
					fmt.Errorf("provider %q needs a client secret", p.ID))
			}
		}
		next = append(next, p)
	}
	if err := s.writeJSON(ctx, keyLoginProviders, next); err != nil {
		return nil, err
	}
	resp, err := s.loginProvidersResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateLoginProvidersResponse{Providers: resp}), nil
}

func validateLoginProvider(in *instancev1.LoginProvider) (LoginProvider, error) {
	p := LoginProvider{
		ID:          strings.TrimSpace(in.Id),
		Kind:        KindOIDC,
		DisplayName: strings.TrimSpace(in.DisplayName),
		Icon:        strings.TrimSpace(in.Icon),
		// The issuer is kept exactly as pasted: OIDC discovery requires a
		// byte-identical match, and some issuers (Authentik) end in "/".
		Issuer:       strings.TrimSpace(in.Issuer),
		ClientID:     strings.TrimSpace(in.ClientId),
		ClientSecret: strings.TrimSpace(in.ClientSecret),
	}
	if in.Kind != instancev1.LoginProviderKind_LOGIN_PROVIDER_KIND_OIDC &&
		in.Kind != instancev1.LoginProviderKind_LOGIN_PROVIDER_KIND_UNSPECIFIED {
		return p, connect.NewError(connect.CodeInvalidArgument,
			errors.New("kind must be oidc"))
	}
	if !providerIDRE.MatchString(p.ID) {
		return p, connect.NewError(connect.CodeInvalidArgument,
			errors.New("provider id must be 2-32 of a-z, 0-9, -, _"))
	}
	if p.DisplayName == "" {
		p.DisplayName = p.ID
	}
	if p.Icon == "" {
		p.Icon = "key"
	}
	if !providerIcons[p.Icon] {
		return p, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("icon %q is not one the client can draw", p.Icon))
	}
	if err := validateIssuer(p.Issuer); err != nil {
		return p, err
	}
	if p.ClientID == "" {
		return p, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("provider %q needs a client id", p.ID))
	}
	return p, nil
}

// validateIssuer accepts what go-oidc discovery will: an http(s) URL with
// no query or fragment. HTTPS is what any real provider uses; plain HTTP
// is allowed for IdPs on a LAN and for tests.
func validateIssuer(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("issuer must look like https://auth.example.com"))
	}
	return nil
}
