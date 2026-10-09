package app

import (
	"context"
	"fmt"
	"net/http"
	"time"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/cftunnel"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/tailnet"
	"github.com/getstoop/stoop/internal/unfurl"
	"github.com/getstoop/stoop/internal/voice"
)

// Port adapters. Each maps a provider module's exported API onto a consumer
// module's port interface. Extracting a module into its own service later
// means swapping these for Connect clients — nothing else changes.

// userDirectory adapts auth's public user lookup to chat's and voice's
// user ports.
type userDirectory struct{ auth *auth.Service }

func (d userDirectory) GetUsers(ctx context.Context, ids []string) ([]chat.UserRecord, error) {
	users, err := d.auth.GetPublicUsers(ctx, ids)
	if err != nil {
		return nil, err
	}
	records := make([]chat.UserRecord, len(users))
	for index, user := range users {
		records[index] = chat.UserRecord{
			ID: user.ID, Username: user.Username, DisplayName: user.DisplayName,
			InstanceAdmin: user.Role == authctx.RoleAdmin, Kind: user.Kind, AvatarFileID: user.AvatarFileID,
			Deleted: user.Deleted,
		}
	}
	return records, nil
}

func (d userDirectory) DisplayName(ctx context.Context, userID string) (string, error) {
	users, err := d.auth.GetPublicUsers(ctx, []string{userID})
	if err != nil {
		return "", err
	}
	if len(users) == 0 {
		return "", fmt.Errorf("user %s not found", userID)
	}
	return users[0].DisplayName, nil
}

// userAdmin adapts auth's account administration onto instance's port.
type userAdmin struct{ auth *auth.Service }

func (a userAdmin) CountUsers(ctx context.Context) (int64, error) { return a.auth.CountUsers(ctx) }
func (a userAdmin) ListUsers(ctx context.Context) ([]instance.UserSummary, error) {
	accounts, err := a.auth.ListAccounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]instance.UserSummary, len(accounts))
	for i, u := range accounts {
		out[i] = toUserSummary(u)
	}
	return out, nil
}
func (a userAdmin) SetUserRole(ctx context.Context, userID string, role authctx.Role) (instance.UserSummary, error) {
	u, err := a.auth.SetAccountRole(ctx, userID, role)
	return toUserSummary(u), err
}
func (a userAdmin) RenameUser(ctx context.Context, userID string, username, displayName *string) (instance.UserSummary, error) {
	u, err := a.auth.RenameAccount(ctx, userID, username, displayName)
	return toUserSummary(u), err
}
func (a userAdmin) SetUsernameFrozen(ctx context.Context, userID string, frozen bool) (instance.UserSummary, error) {
	u, err := a.auth.SetAccountUsernameFrozen(ctx, userID, frozen)
	return toUserSummary(u), err
}
func (a userAdmin) ClearUserProfile(ctx context.Context, userID string, pronouns, bio bool) (instance.UserSummary, error) {
	u, err := a.auth.ClearAccountProfile(ctx, userID, pronouns, bio)
	return toUserSummary(u), err
}
func (a userAdmin) SetUserActive(ctx context.Context, userID string, active bool) (instance.UserSummary, error) {
	u, err := a.auth.SetAccountActive(ctx, userID, active)
	return toUserSummary(u), err
}
func (a userAdmin) ResetUserPassword(ctx context.Context, userID string) (string, instance.UserSummary, error) {
	temp, u, err := a.auth.ResetPassword(ctx, userID)
	return temp, toUserSummary(u), err
}
func (a userAdmin) TransferOwnership(ctx context.Context, fromID, toID string) (instance.UserSummary, error) {
	u, err := a.auth.TransferOwnership(ctx, fromID, toID)
	return toUserSummary(u), err
}
func (a userAdmin) ListUserTokens(ctx context.Context, userID string) ([]*authv1.PersonalToken, error) {
	return a.auth.ListTokensOf(ctx, userID)
}
func (a userAdmin) RevokeUserToken(ctx context.Context, userID, tokenID string) error {
	return a.auth.RevokeTokenOf(ctx, userID, tokenID)
}

func toUserSummary(u auth.AccountSummary) instance.UserSummary {
	return instance.UserSummary{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName,
		Role: u.Role, Kind: u.Kind, CreatedAt: u.CreatedAt, DeactivatedAt: u.DeactivatedAt,
		DeletedAt: u.DeletedAt, IsOwner: u.IsOwner,
		UsernameFrozen: u.UsernameFrozen, HasPassword: u.HasPassword,
		Pronouns: u.Pronouns, Bio: u.Bio, PersonalTokens: u.PersonalTokens,
		Email: u.Email,
	}
}

// retentionCounter answers instance's PreviewRetention from the two
// modules that own what retention deletes.
type retentionCounter struct {
	chat  *chat.Service
	files *files.Service
}

func (c retentionCounter) CountExpiredMessages(ctx context.Context, now time.Time, days int) (int64, error) {
	return c.chat.CountExpiredMessages(ctx, now, days)
}

func (c retentionCounter) CountExpiringAttachments(ctx context.Context, now time.Time, days int) (int64, int64, error) {
	return c.files.CountExpiringAttachments(ctx, now, days)
}

// fileDirectory adapts the files module onto chat's attachment port.
type fileDirectory struct{ files *files.Service }

func (d fileDirectory) GetFiles(ctx context.Context, ids []string) ([]chat.FileRecord, error) {
	infos, err := d.files.GetFiles(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]chat.FileRecord, len(infos))
	for i, f := range infos {
		out[i] = chat.FileRecord{
			ID: f.ID, Kind: string(f.Kind), OwnerID: f.OwnerID, SpaceID: f.SpaceID,
			Name: f.Name, ContentType: f.ContentType, Size: f.Size, Expired: f.Expired,
		}
	}
	return out, nil
}

func (d fileDirectory) DeleteFiles(ctx context.Context, ids []string) error {
	return d.files.DeleteFiles(ctx, ids)
}

// identityVerifier adapts auth's token check onto the plain-HTTP handlers
// (/ws, downloads) that don't pass through the Connect interceptor. They
// get the whole identity, credential included, and filter by it.
type identityVerifier struct{ auth *auth.Service }

func (v identityVerifier) VerifyRequest(ctx context.Context, h http.Header) (authctx.Identity, error) {
	return v.auth.VerifyToken(ctx, auth.TokenFromHeader(h))
}

// unfurler adapts internal/unfurl to chat's port.
type unfurler struct{ f *unfurl.Fetcher }

func (u unfurler) Fetch(ctx context.Context, url string) (chat.LinkMeta, error) {
	p, err := u.f.Fetch(ctx, url)
	if err != nil {
		return chat.LinkMeta{}, err
	}
	return chat.LinkMeta{Title: p.Title, Description: p.Description, SiteName: p.SiteName, Image: p.Image}, nil
}

// providerSource adapts instance's login-provider settings to auth's
// ProviderSource port (auth cannot import instance).
type providerSource struct{ instance *instance.Service }

func (p providerSource) LoginProvider(ctx context.Context, id string) (auth.ProviderConfig, error) {
	lp, err := p.instance.LoginProvider(ctx, id)
	if err != nil {
		return auth.ProviderConfig{}, err
	}
	return auth.ProviderConfig{
		Kind:   lp.Kind,
		Issuer: lp.Issuer, ClientID: lp.ClientID, ClientSecret: lp.ClientSecret,
	}, nil
}

func (p providerSource) CallbackURL(ctx context.Context, id string) (string, error) {
	return p.instance.CallbackURL(ctx, id)
}

// tailscaleController adapts tailnet.Manager to the instance module's port.
type tailscaleController struct{ m *tailnet.Manager }

func (c tailscaleController) Apply(s instance.TailscaleSettings) {
	c.m.Apply(tailnet.Settings{
		Enabled: s.Enabled, Hostname: s.Hostname, AuthKey: s.AuthKey,
		ControlURL: s.ControlURL, Funnel: s.Funnel,
	})
}

func (c tailscaleController) Status(ctx context.Context) instance.TailscaleStatus {
	st, on := c.m.Status(ctx)
	return instance.TailscaleStatus{
		Enabled: on, State: st.State, LoginURL: st.LoginURL,
		URL: st.URL, Funnel: st.Funnel, Error: st.Error,
		TailnetIP: st.TailnetIP, CarriesVoice: st.Media,
	}
}

// tunnelController adapts cftunnel.Manager to the instance module's port.
type tunnelController struct{ m *cftunnel.Manager }

func (c tunnelController) Apply(s instance.CloudflareTunnelSettings) {
	c.m.Apply(cftunnel.Settings{Enabled: s.Enabled, Token: s.Token})
}

func (c tunnelController) Status() instance.CloudflareTunnelStatus {
	st, on := c.m.Status()
	return instance.CloudflareTunnelStatus{Enabled: on, State: st.State, Error: st.Error}
}

// relayProvider adapts the instance module's reachability settings to
// voice's port.
type relayProvider struct{ instance *instance.Service }

func (p relayProvider) RelaySettings(ctx context.Context) (voice.RelaySettings, error) {
	r, err := p.instance.Reachability(ctx)
	if err != nil {
		return voice.RelaySettings{}, err
	}
	return voice.RelaySettings{
		TURN: voice.StaticTURN{
			URLs: r.TURN.URLs, Username: r.TURN.Username, Credential: r.TURN.Credential,
			STUNURLs: r.TURN.STUNURLs,
		},
		Cloudflare: voice.CloudflareTURN{KeyID: r.Cloudflare.KeyID, APIToken: r.Cloudflare.APIToken},
	}, nil
}
