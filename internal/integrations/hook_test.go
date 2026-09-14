package integrations

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/ratelimit"
)

// The ports, faked: auth and chat are other modules. Rows the hook
// tables reference are inserted directly.

type fakeBots struct {
	pool    *pgxpool.Pool
	tokens  map[string]authctx.Identity
	creds   map[string]Credential
	bots    map[string]Bot
	revoked []string
}

func newFakeBots(pool *pgxpool.Pool) *fakeBots {
	return &fakeBots{pool: pool, tokens: map[string]authctx.Identity{}, creds: map[string]Credential{}, bots: map[string]Bot{}}
}

func (f *fakeBots) CreateBot(ctx context.Context, username, displayName string) (Bot, error) {
	for _, b := range f.bots {
		if b.Username == username {
			return Bot{}, connect.NewError(connect.CodeAlreadyExists, errors.New("username is taken"))
		}
	}
	id := uuid.NewString()
	if _, err := f.pool.Exec(ctx, `INSERT INTO users (id, username, display_name, role, kind) VALUES ($1, $2, $3, 'member', 'bot')`, id, username, displayName); err != nil {
		return Bot{}, err
	}
	b := Bot{ID: id, Username: username, DisplayName: displayName}
	f.bots[id] = b
	return b, nil
}

func (f *fakeBots) GetBot(_ context.Context, id string) (Bot, error) {
	b, ok := f.bots[id]
	if !ok {
		return Bot{}, connect.NewError(connect.CodeNotFound, errors.New("bot not found"))
	}
	return b, nil
}

func (f *fakeBots) ListBots(context.Context) ([]Bot, error) {
	var out []Bot
	for _, b := range f.bots {
		out = append(out, b)
	}
	return out, nil
}

func (f *fakeBots) UpdateBot(_ context.Context, id string, username, displayName, bio *string) (Bot, error) {
	b := f.bots[id]
	if username != nil {
		b.Username = *username
	}
	if displayName != nil {
		b.DisplayName = *displayName
	}
	if bio != nil {
		b.Bio = *bio
	}
	f.bots[id] = b
	return b, nil
}

// DeactivateBot revokes everything the bot holds, as auth does.
func (f *fakeBots) DeactivateBot(ctx context.Context, id string) error {
	b := f.bots[id]
	now := b.CreatedAt
	b.DeactivatedAt = &now
	f.bots[id] = b
	for _, c := range f.creds {
		if c.HolderID == id {
			if err := f.RevokeCredential(ctx, c.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

// MintCredential applies auth's grant rules: at least one, each grantable.
func (f *fakeBots) MintCredential(ctx context.Context, req MintRequest) (Credential, string, error) {
	if len(req.Grants) == 0 {
		return Credential{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("choose at least one permission"))
	}
	for _, a := range req.Grants {
		if !a.Grantable() {
			return Credential{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("not grantable"))
		}
	}
	if b := f.bots[req.HolderID]; b.DeactivatedAt != nil {
		return Credential{}, "", connect.NewError(connect.CodeNotFound, errors.New("bot not found"))
	}
	id := uuid.NewString()
	if _, err := f.pool.Exec(ctx, `INSERT INTO credentials (id, holder_id, kind, token_hash, name, grants, bounded) VALUES ($1, $2, $3, $4, $5, '{}', true)`,
		id, req.HolderID, string(req.Kind), []byte(id), req.Name); err != nil {
		return Credential{}, "", err
	}
	bounded := req.Limited || req.ChannelID != ""
	c := Credential{ID: id, HolderID: req.HolderID, Kind: req.Kind, Name: req.Name, Grants: req.Grants, Bounded: bounded, SpaceIDs: req.SpaceIDs, Hint: id[len(id)-4:]}
	if req.ChannelID != "" {
		c.ChannelIDs = []string{req.ChannelID}
	}
	f.creds[id] = c
	secret := "stp_" + string(req.Kind) + "_" + id
	f.tokens[secret] = authctx.Identity{
		UserID: req.HolderID, Role: authctx.RoleMember, Kind: authctx.KindBot,
		Credential: authctx.Credential{ID: id, Kind: req.Kind, Grants: req.Grants, Bounded: bounded, Spaces: req.SpaceIDs, Channels: c.ChannelIDs},
	}
	return c, secret, nil
}

func (f *fakeBots) SetCredentialGrants(_ context.Context, id string, grants []authctx.Action) error {
	c := f.creds[id]
	c.Grants = grants
	f.creds[id] = c
	return nil
}

func (f *fakeBots) RevokeCredential(ctx context.Context, id string) error {
	if _, ok := f.creds[id]; !ok {
		return connect.NewError(connect.CodeNotFound, errors.New("credential not found"))
	}
	delete(f.creds, id)
	for tok, ident := range f.tokens {
		if ident.Credential.ID == id {
			delete(f.tokens, tok)
		}
	}
	f.revoked = append(f.revoked, id)
	_, err := f.pool.Exec(ctx, `DELETE FROM credentials WHERE id = $1`, id)
	return err
}

func (f *fakeBots) Credentials(_ context.Context, holderIDs, ids []string) ([]Credential, error) {
	var out []Credential
	for _, c := range f.creds {
		if len(ids) > 0 && !contains(ids, c.ID) {
			continue
		}
		if len(ids) == 0 && len(holderIDs) > 0 && !contains(holderIDs, c.HolderID) {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

func (f *fakeBots) CountCredentials(_ context.Context, holderID string) (int64, error) {
	var n int64
	for _, c := range f.creds {
		if c.HolderID == holderID {
			n++
		}
	}
	return n, nil
}

func (f *fakeBots) VerifyHookToken(_ context.Context, token string) (authctx.Identity, error) {
	id, ok := f.tokens[token]
	if !ok || id.Credential.Kind != authctx.CredentialIncomingHook {
		return authctx.Identity{}, errors.New("unknown")
	}
	return id, nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

type fakeSpaces struct {
	pool    *pgxpool.Pool
	channel map[string]string
	admin   map[string]bool
}

func (f *fakeSpaces) ChannelSpace(_ context.Context, channelID string) (string, error) {
	sp, ok := f.channel[channelID]
	if !ok {
		return "", connect.NewError(connect.CodeNotFound, errors.New("channel not found"))
	}
	return sp, nil
}
func (f *fakeSpaces) SpaceName(context.Context, string) (string, error) { return "Porch", nil }
func (f *fakeSpaces) AddBotMember(ctx context.Context, spaceID, userID string) error {
	_, err := f.pool.Exec(ctx, `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, spaceID, userID)
	return err
}
func (f *fakeSpaces) RemoveBotMember(ctx context.Context, spaceID, userID string) error {
	tag, err := f.pool.Exec(ctx, `DELETE FROM space_members WHERE space_id = $1 AND user_id = $2`, spaceID, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return connect.NewError(connect.CodeNotFound, errors.New("the bot is not a member of that space"))
	}
	return err
}
func (f *fakeSpaces) ListSpaceIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := f.pool.Query(ctx, `SELECT space_id FROM space_members WHERE user_id = $1 ORDER BY space_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
func (f *fakeSpaces) SetBotAdmin(_ context.Context, spaceID, userID string, admin bool) error {
	f.admin[spaceID+"/"+userID] = admin
	return nil
}
func (f *fakeSpaces) Member(_ context.Context, spaceID, userID string) (*chatv1.Member, error) {
	return &chatv1.Member{UserId: userID, Username: "member-" + userID[:4], Role: chatv1.SpaceRole_SPACE_ROLE_MEMBER}, nil
}
func (f *fakeSpaces) IsSpaceMember(ctx context.Context, userID, spaceID string) (bool, error) {
	var ok bool
	err := f.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2)`, spaceID, userID).Scan(&ok)
	return ok, err
}

type posted struct {
	identity authctx.Identity
	req      PostRequest
}

type fakePoster struct {
	posts []posted
	fail  error
}

func (p *fakePoster) Post(ctx context.Context, req PostRequest) (string, error) {
	if p.fail != nil {
		return "", p.fail
	}
	id, _ := authctx.From(ctx)
	p.posts = append(p.posts, posted{id, req})
	return uuid.NewString(), nil
}

type fakePolicy struct{ incoming, outgoing, private bool }

func (p *fakePolicy) WebhooksIncoming(context.Context) (bool, error) { return p.incoming, nil }
func (p *fakePolicy) WebhooksOutgoing(context.Context) (bool, error) { return p.outgoing, nil }
func (p *fakePolicy) WebhooksAllowPrivateTargets(context.Context) (bool, error) {
	return p.private, nil
}
func (p *fakePolicy) PublicURL(context.Context) (string, error) {
	return "https://stoop.example.com", nil
}

type fixture struct {
	pool    *pgxpool.Pool
	svc     *Service
	bots    *fakeBots
	spaces  *fakeSpaces
	poster  *fakePoster
	policy  *fakePolicy
	admin   context.Context
	member  context.Context
	space   string
	channel string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := dbtest.New(t)
	ctx := context.Background()
	adminID, memberID, spaceID, channelID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, q := range []string{
		`INSERT INTO users (id, username, display_name, role) VALUES ('` + adminID + `', 'casey', 'Casey', 'admin')`,
		`INSERT INTO users (id, username, display_name, role) VALUES ('` + memberID + `', 'ada', 'Ada', 'member')`,
		`INSERT INTO spaces (id, name, owner_id) VALUES ('` + spaceID + `', 'Porch', '` + adminID + `')`,
		`INSERT INTO space_members (space_id, user_id, role) VALUES ('` + spaceID + `', '` + memberID + `', 'member')`,
		`INSERT INTO channels (id, space_id, name, position) VALUES ('` + channelID + `', '` + spaceID + `', 'general', 0)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	f := &fixture{
		svc: New(pool, events.NewInProcBus(), slog.Default()), bots: newFakeBots(pool),
		pool:   pool,
		spaces: &fakeSpaces{pool: pool, channel: map[string]string{channelID: spaceID}, admin: map[string]bool{}},
		poster: &fakePoster{}, policy: &fakePolicy{incoming: true, outgoing: true},
		space: spaceID, channel: channelID,
	}
	f.svc.UseBotIdentities(f.bots)
	f.svc.UseSpaceAccess(f.spaces)
	f.svc.UsePoster(f.poster)
	f.svc.UsePolicy(f.policy)
	f.admin = authctx.WithIdentity(ctx, authctx.Identity{UserID: adminID, Role: authctx.RoleAdmin, Kind: authctx.KindPerson,
		Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialSession}})
	f.member = authctx.WithIdentity(ctx, authctx.Identity{UserID: memberID, Role: authctx.RoleMember, Kind: authctx.KindPerson,
		Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialSession}})
	return f
}

func (f *fixture) post(t *testing.T, url, contentType, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.Handle("POST /hooks/{token}", f.svc.HookHandler())
	mux.ServeHTTP(rec, req)
	b, _ := io.ReadAll(rec.Result().Body)
	return rec.Code, strings.TrimSpace(string(b))
}

func (f *fixture) create(t *testing.T, name string, notify bool) *integrationsv1.CreateIncomingResponse {
	t.Helper()
	res, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{
		ChannelId: f.channel, Name: name, NotifyEveryone: notify,
	}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg
}

func path(url string) string { return url[strings.Index(url, "/hooks/"):] }

func TestIncomingHookPosts(t *testing.T) {
	f := setup(t)
	made := f.create(t, "Uptime Kuma", false)
	if !strings.HasPrefix(made.Url, "https://stoop.example.com/hooks/stp_incoming_hook_") || made.Webhook.Hint == "" || !made.Webhook.Enabled {
		t.Fatalf("created %+v url %q", made.Webhook, made.Url)
	}
	bot := f.bots.bots[made.Webhook.BotUserId]
	if bot.Username != "uptime_kuma" || bot.DisplayName != "Uptime Kuma" {
		t.Errorf("bot = %+v", bot)
	}

	status, body := f.post(t, path(made.Url), "text/plain", "disk is full")
	if status != http.StatusOK || body != "ok" {
		t.Fatalf("post: %d %q", status, body)
	}
	if len(f.poster.posts) != 1 {
		t.Fatalf("posts = %d", len(f.poster.posts))
	}
	p := f.poster.posts[0]
	if p.req.ChannelID != f.channel || p.req.Content != "disk is full" || p.identity.UserID != made.Webhook.BotUserId ||
		p.identity.Credential.Kind != authctx.CredentialIncomingHook || !p.identity.Credential.Reaches("", f.channel) {
		t.Errorf("posted %+v as %+v", p.req, p.identity)
	}

	// Vendor shapes, and the truncation.
	f.post(t, path(made.Url), "application/json", `{"content": "Sonarr grabbed a thing"}`)
	f.post(t, path(made.Url), "application/json", `{"text": "`+strings.Repeat("x", 5000)+`"}`)
	if len(f.poster.posts) != 3 || f.poster.posts[1].req.Content != "Sonarr grabbed a thing" || len([]rune(f.poster.posts[2].req.Content)) != 4000 {
		t.Errorf("adapted posts wrong: %d", len(f.poster.posts))
	}

	// Refusals an appliance can act on.
	if status, _ := f.post(t, path(made.Url), "application/json", `{"blocks": []}`); status != http.StatusBadRequest {
		t.Errorf("empty body: %d", status)
	}
	if status, _ := f.post(t, "/hooks/stp_hook_nope", "text/plain", "hi"); status != http.StatusNotFound {
		t.Errorf("unknown token: %d", status)
	}
	req := httptest.NewRequest(http.MethodPost, path(made.Url), strings.NewReader("looping"))
	req.Header.Set("User-Agent", userAgent)
	rec := httptest.NewRecorder()
	f.svc.HookHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("a Stoop delivery posted into a hook: %d", rec.Code)
	}
	f.poster.fail = connect.NewError(connect.CodePermissionDenied, errors.New("not a member of this space"))
	if status, _ := f.post(t, path(made.Url), "text/plain", "hi"); status != http.StatusForbidden {
		t.Errorf("kicked bot: %d", status)
	}
	f.poster.fail = nil
	f.policy.incoming = false
	if status, _ := f.post(t, path(made.Url), "text/plain", "hi"); status != http.StatusNotFound {
		t.Errorf("incoming off: %d", status)
	}
	f.policy.incoming = true

	// The per-hook limit.
	f.svc.UseHookThrottle(ratelimit.New(2, 2))
	f.post(t, path(made.Url), "text/plain", "one")
	f.post(t, path(made.Url), "text/plain", "two")
	if status, _ := f.post(t, path(made.Url), "text/plain", "three"); status != http.StatusTooManyRequests {
		t.Errorf("over the limit: %d", status)
	}
	f.svc.UseHookThrottle(nil)

	// Disabled, rotated, deleted.
	off := false
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: made.Webhook.Id, Enabled: &off})); err != nil {
		t.Fatal(err)
	}
	if status, _ := f.post(t, path(made.Url), "text/plain", "hi"); status != http.StatusNotFound {
		t.Errorf("disabled hook: %d", status)
	}
	on := true
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: made.Webhook.Id, Enabled: &on})); err != nil {
		t.Fatal(err)
	}
	rotated, err := f.svc.RotateSecret(f.admin, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: made.Webhook.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if status, _ := f.post(t, path(made.Url), "text/plain", "old"); status != http.StatusNotFound {
		t.Errorf("old token after rotation: %d", status)
	}
	if status, _ := f.post(t, path(rotated.Msg.Url), "text/plain", "new"); status != http.StatusOK {
		t.Errorf("new token after rotation: %d", status)
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: made.Webhook.Id})); err != nil {
		t.Fatal(err)
	}
	if status, _ := f.post(t, path(rotated.Msg.Url), "text/plain", "gone"); status != http.StatusNotFound {
		t.Errorf("deleted hook: %d", status)
	}
	if f.bots.bots[made.Webhook.BotUserId].DeactivatedAt == nil {
		t.Error("a bot with no credentials left should be deactivated")
	}
}

func TestIncomingHookAuthorisationAndListing(t *testing.T) {
	f := setup(t)
	if _, err := f.svc.CreateIncoming(f.member, connect.NewRequest(&integrationsv1.CreateIncomingRequest{ChannelId: f.channel, Name: "x"})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member created a hook: %v", err)
	}
	narrow := authctx.WithIdentity(context.Background(), authctx.Identity{UserID: authctx.UserID(f.admin), Role: authctx.RoleAdmin,
		Credential: authctx.Credential{Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.InstanceRead}}})
	if _, err := f.svc.CreateIncoming(narrow, connect.NewRequest(&integrationsv1.CreateIncomingRequest{ChannelId: f.channel, Name: "x"})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("an admin's narrow token created a hook: %v", err)
	}

	made := f.create(t, "UPS", true)
	if !f.spaces.admin[f.space+"/"+made.Webhook.BotUserId] {
		t.Error("notify_everyone should make the bot a space admin")
	}
	perms := made.Webhook.Permissions
	if len(perms) != 2 {
		t.Errorf("permissions = %v", perms)
	}
	no := false
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: made.Webhook.Id, NotifyEveryone: &no})); err != nil {
		t.Fatal(err)
	}
	if f.spaces.admin[f.space+"/"+made.Webhook.BotUserId] {
		t.Error("unticking the last notify grant should revert the bot to member")
	}

	// Members see the space's list without secrets; the server-wide list
	// is the admin's.
	list, err := f.svc.ListWebhooks(f.member, connect.NewRequest(&integrationsv1.ListWebhooksRequest{SpaceId: f.space}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Incoming) != 1 || list.Msg.Incoming[0].Name != "UPS" || len(list.Msg.Incoming[0].Hint) != 4 {
		t.Errorf("member list = %+v", list.Msg.Incoming)
	}
	if strings.Contains(list.Msg.String(), "stp_incoming_hook_") {
		t.Error("a listing carried a token")
	}
	if _, err := f.svc.ListWebhooks(f.member, connect.NewRequest(&integrationsv1.ListWebhooksRequest{})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member listed the whole server: %v", err)
	}
	all, err := f.svc.ListWebhooks(f.admin, connect.NewRequest(&integrationsv1.ListWebhooksRequest{}))
	if err != nil || len(all.Msg.Incoming) != 1 {
		t.Errorf("server-wide list: %v %+v", err, all)
	}

	// A second hook on the same bot; deleting one keeps the bot.
	second, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{
		ChannelId: f.channel, Name: "UPS again", BotUserId: made.Webhook.BotUserId,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if second.Msg.Webhook.BotUserId != made.Webhook.BotUserId {
		t.Error("attaching to an existing bot made a new one")
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: second.Msg.Webhook.Id})); err != nil {
		t.Fatal(err)
	}
	if f.bots.bots[made.Webhook.BotUserId].DeactivatedAt != nil {
		t.Error("a bot with a credential left was deactivated")
	}

	bots, err := f.svc.ListBots(f.admin, connect.NewRequest(&integrationsv1.ListBotsRequest{}))
	if err != nil || len(bots.Msg.Bots) != 1 || bots.Msg.Bots[0].Username != "ups" {
		t.Errorf("ListBots: %v %+v", err, bots)
	}
	if _, err := f.svc.ListBots(f.member, connect.NewRequest(&integrationsv1.ListBotsRequest{})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member listed bots: %v", err)
	}
}

func TestOrphanedHookCredentialsAreSwept(t *testing.T) {
	f := setup(t)
	first := f.create(t, "Stays", false)
	other := uuid.NewString()
	if _, err := f.bots.pool.Exec(context.Background(), `INSERT INTO channels (id, space_id, name, position) VALUES ($1, $2, 'other', 1)`, other, f.space); err != nil {
		t.Fatal(err)
	}
	f.spaces.channel[other] = f.space
	second, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{ChannelId: other, Name: "Goes", BotUserId: first.Webhook.BotUserId}))
	if err != nil {
		t.Fatal(err)
	}
	third := f.create(t, "Alone", false)

	// Nothing to sweep while every hook is in place.
	if n, err := f.svc.SweepOrphanHooks(context.Background()); err != nil || n != 0 {
		t.Fatalf("sweep on a clean table: %d, %v", n, err)
	}
	// Deleting the channel cascades the hook row; the credential lingers
	// until the sweep.
	if _, err := f.bots.pool.Exec(context.Background(), `DELETE FROM channels WHERE id = $1`, other); err != nil {
		t.Fatal(err)
	}
	if status, _ := f.post(t, path(second.Msg.Url), "text/plain", "orphan"); status != http.StatusNotFound {
		t.Errorf("orphaned hook answered %d", status)
	}
	if n, err := f.svc.SweepOrphanHooks(context.Background()); err != nil || n != 1 {
		t.Fatalf("sweep = %d, %v", n, err)
	}
	if len(f.bots.revoked) != 1 || f.bots.bots[first.Webhook.BotUserId].DeactivatedAt != nil {
		t.Errorf("revoked %v; bot with a live hook left deactivated=%v", f.bots.revoked, f.bots.bots[first.Webhook.BotUserId].DeactivatedAt)
	}
	if status, _ := f.post(t, path(first.Url), "text/plain", "still here"); status != http.StatusOK {
		t.Errorf("the surviving hook answered %d", status)
	}
	// A space delete orphans a bot's only hook: the bot retires.
	if _, err := f.bots.pool.Exec(context.Background(), `DELETE FROM incoming_webhooks WHERE id = $1`, third.Webhook.Id); err != nil {
		t.Fatal(err)
	}
	if n, err := f.svc.SweepOrphanHooks(context.Background()); err != nil || n != 1 {
		t.Fatalf("second sweep = %d, %v", n, err)
	}
	if f.bots.bots[third.Webhook.BotUserId].DeactivatedAt == nil {
		t.Error("a bot whose only hook was orphaned should retire")
	}
}

func TestHooksOfADeactivatedBot(t *testing.T) {
	f := setup(t)
	made := f.create(t, "Doomed", false)
	if _, err := f.svc.DeactivateBot(f.admin, connect.NewRequest(&integrationsv1.DeactivateBotRequest{Id: made.Webhook.BotUserId})); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RotateSecret(f.admin, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: made.Webhook.Id})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("rotate on a deactivated bot: %v", err)
	}
	on := true
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: made.Webhook.Id, Enabled: &on})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("re-enable on a deactivated bot: %v", err)
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: made.Webhook.Id})); err != nil {
		t.Errorf("deleting the hook of a deactivated bot: %v", err)
	}
}

func TestBotTokens(t *testing.T) {
	f := setup(t)
	made := f.create(t, "Mirror", false)
	bot := made.Webhook.BotUserId
	read := []accessv1.Permission{accessv1.Permission_PERMISSION_SPACE_READ, accessv1.Permission_PERMISSION_MESSAGES_READ}

	if _, err := f.svc.CreateBotToken(f.member, connect.NewRequest(&integrationsv1.CreateBotTokenRequest{BotUserId: bot, Name: "x", Permissions: read})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member minted a bot token: %v", err)
	}
	if _, err := f.svc.CreateBotToken(f.admin, connect.NewRequest(&integrationsv1.CreateBotTokenRequest{BotUserId: authctx.UserID(f.member), Name: "x", Permissions: read})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("a token for a person: %v", err)
	}
	if _, err := f.svc.CreateBotToken(f.admin, connect.NewRequest(&integrationsv1.CreateBotTokenRequest{BotUserId: bot, Name: "x", Permissions: []accessv1.Permission{accessv1.Permission_PERMISSION_ACCOUNT_SECURITY}})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("account.security granted: %v", err)
	}
	res, err := f.svc.CreateBotToken(f.admin, connect.NewRequest(&integrationsv1.CreateBotTokenRequest{
		BotUserId: bot, Name: "mirror reader", Permissions: read,
	}))
	if err != nil {
		t.Fatal(err)
	}
	// A token has no limit of its own: it works wherever the bot is.
	tok := res.Msg.Token
	if !strings.HasPrefix(res.Msg.Secret, "stp_bot_token_") || tok.BotUserId != bot || tok.Limited || len(tok.SpaceIds) != 0 || len(tok.Permissions) != 2 || tok.Hint == "" {
		t.Errorf("token = %+v secret %q", tok, res.Msg.Secret)
	}
	bots, err := f.svc.ListBots(f.admin, connect.NewRequest(&integrationsv1.ListBotsRequest{}))
	if err != nil || len(bots.Msg.Bots) != 1 || len(bots.Msg.Bots[0].Tokens) != 1 || bots.Msg.Bots[0].Tokens[0].Id != tok.Id {
		t.Errorf("ListBots tokens: %v %+v", err, bots.Msg.Bots)
	}
	if strings.Contains(bots.Msg.String(), res.Msg.Secret) {
		t.Error("a listing carried the secret")
	}

	// Revoking: the hook credential is not a token; the token goes; the
	// bot stays while its hook remains, and retires once that goes too.
	if _, err := f.svc.RevokeBotToken(f.admin, connect.NewRequest(&integrationsv1.RevokeBotTokenRequest{TokenId: made.Webhook.Id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("revoking a hook id as a token: %v", err)
	}
	if _, err := f.svc.RevokeBotToken(f.member, connect.NewRequest(&integrationsv1.RevokeBotTokenRequest{TokenId: tok.Id})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member revoked: %v", err)
	}
	if _, err := f.svc.RevokeBotToken(f.admin, connect.NewRequest(&integrationsv1.RevokeBotTokenRequest{TokenId: tok.Id})); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RevokeBotToken(f.admin, connect.NewRequest(&integrationsv1.RevokeBotTokenRequest{TokenId: tok.Id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("revoking twice: %v", err)
	}
	if f.bots.bots[bot].DeactivatedAt != nil {
		t.Error("bot retired while its hook remained")
	}
	res, err = f.svc.CreateBotToken(f.admin, connect.NewRequest(&integrationsv1.CreateBotTokenRequest{BotUserId: bot, Name: "again", Permissions: read}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: made.Webhook.Id})); err != nil {
		t.Fatal(err)
	}
	if f.bots.bots[bot].DeactivatedAt != nil {
		t.Error("bot retired while its token remained")
	}
	if _, err := f.svc.RevokeBotToken(f.admin, connect.NewRequest(&integrationsv1.RevokeBotTokenRequest{TokenId: res.Msg.Token.Id})); err != nil {
		t.Fatal(err)
	}
	if f.bots.bots[bot].DeactivatedAt == nil {
		t.Error("a bot with nothing left should retire")
	}
	if _, err := f.svc.CreateBotToken(f.admin, connect.NewRequest(&integrationsv1.CreateBotTokenRequest{BotUserId: bot, Name: "x", Permissions: read})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a token for a deactivated bot: %v", err)
	}
}

func TestCreateBotWithBio(t *testing.T) {
	f := setup(t)
	res, err := f.svc.CreateBot(f.admin, connect.NewRequest(&integrationsv1.CreateBotRequest{
		Username: "hass", DisplayName: "Home Assistant", Bio: "  Says when the garage door is open.  ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Bot.Bio != "Says when the garage door is open." {
		t.Errorf("bio = %q", res.Msg.Bot.Bio)
	}
	plain, err := f.svc.CreateBot(f.admin, connect.NewRequest(&integrationsv1.CreateBotRequest{Username: "quiet", DisplayName: "Quiet"}))
	if err != nil {
		t.Fatal(err)
	}
	if plain.Msg.Bot.Bio != "" {
		t.Errorf("no bio: %q", plain.Msg.Bot.Bio)
	}
}

func TestBotSpaces(t *testing.T) {
	f := setup(t)
	made, err := f.svc.CreateBot(f.admin, connect.NewRequest(&integrationsv1.CreateBotRequest{Username: "mirror", DisplayName: "Mirror"}))
	if err != nil {
		t.Fatal(err)
	}
	bot := made.Msg.Bot.Id
	add := &integrationsv1.AddBotToSpaceRequest{BotUserId: bot, SpaceId: f.space}

	// Instance admins only; a hook for a bot outside the space is refused.
	if _, err := f.svc.AddBotToSpace(f.member, connect.NewRequest(add)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member added a bot to a space: %v", err)
	}
	if _, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{ChannelId: f.channel, Name: "alerts", BotUserId: bot})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a hook widened a bot into a space: %v", err)
	}

	res, err := f.svc.AddBotToSpace(f.admin, connect.NewRequest(add))
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Msg.Bot.SpaceIds; len(got) != 1 || got[0] != f.space {
		t.Errorf("space_ids after add = %v", got)
	}
	if _, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{ChannelId: f.channel, Name: "alerts", BotUserId: bot})); err != nil {
		t.Errorf("a hook for a member bot: %v", err)
	}
	bots, err := f.svc.ListBots(f.admin, connect.NewRequest(&integrationsv1.ListBotsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range bots.Msg.Bots {
		if b.Id == bot && (len(b.SpaceIds) != 1 || b.SpaceIds[0] != f.space) {
			t.Errorf("ListBots space_ids = %v", b.SpaceIds)
		}
	}

	out, err := f.svc.RemoveBotFromSpace(f.admin, connect.NewRequest(&integrationsv1.RemoveBotFromSpaceRequest{BotUserId: bot, SpaceId: f.space}))
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Msg.Bot.SpaceIds) != 0 {
		t.Errorf("space_ids after remove = %v", out.Msg.Bot.SpaceIds)
	}
	if _, err := f.svc.RemoveBotFromSpace(f.admin, connect.NewRequest(&integrationsv1.RemoveBotFromSpaceRequest{BotUserId: bot, SpaceId: f.space})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("removing twice: %v", err)
	}
}

func TestRemovedBotHooks(t *testing.T) {
	f := setup(t)
	made := f.create(t, "Alerts", false)
	bot, hookID := made.Webhook.BotUserId, made.Webhook.Id
	url := path(made.Url)
	on := true
	listed := func() *integrationsv1.IncomingWebhook {
		t.Helper()
		res, err := f.svc.ListWebhooks(f.admin, connect.NewRequest(&integrationsv1.ListWebhooksRequest{SpaceId: f.space}))
		if err != nil {
			t.Fatal(err)
		}
		for _, h := range res.Msg.Incoming {
			if h.Id == hookID {
				return h
			}
		}
		t.Fatal("hook not listed")
		return nil
	}

	// Removing the bot from the space turns its hook off, with a reason,
	// and posts stop; turning it on is refused until the bot is back.
	if _, err := f.svc.RemoveBotFromSpace(f.admin, connect.NewRequest(&integrationsv1.RemoveBotFromSpaceRequest{BotUserId: bot, SpaceId: f.space})); err != nil {
		t.Fatal(err)
	}
	if h := listed(); h.Enabled || h.DisabledReason != "the bot was removed from this space" {
		t.Errorf("after removal: enabled=%v reason=%q", h.Enabled, h.DisabledReason)
	}
	if code, _ := f.post(t, url, "text/plain", "hi"); code != http.StatusNotFound {
		t.Errorf("a disabled hook answered %d", code)
	}
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: hookID, Enabled: &on})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("turned on while the bot is out: %v", err)
	}
	if _, err := f.svc.AddBotToSpace(f.admin, connect.NewRequest(&integrationsv1.AddBotToSpaceRequest{BotUserId: bot, SpaceId: f.space})); err != nil {
		t.Fatal(err)
	}
	if h := listed(); h.Enabled {
		t.Error("adding the bot back silently re-enabled the hook")
	}
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: hookID, Enabled: &on})); err != nil {
		t.Fatal(err)
	}
	if h := listed(); !h.Enabled {
		t.Error("hook not back on")
	}

	// A kick doesn't pass through this module: the list still reads the
	// hook as off at once, and the sweep makes the row agree.
	if _, err := f.pool.Exec(context.Background(), `DELETE FROM space_members WHERE space_id = $1 AND user_id = $2`, f.space, bot); err != nil {
		t.Fatal(err)
	}
	if h := listed(); h.Enabled || h.DisabledReason != "the bot was removed from this space" {
		t.Errorf("after a kick: enabled=%v reason=%q", h.Enabled, h.DisabledReason)
	}
	row, err := f.svc.q.GetIncomingWebhook(context.Background(), hookID)
	if err != nil || row.DisabledAt != nil {
		t.Errorf("row disabled before the sweep: %v %v", row.DisabledAt, err)
	}
	if n, err := f.svc.SweepRemovedBotHooks(context.Background()); err != nil || n != 1 {
		t.Errorf("sweep = %d, %v", n, err)
	}
	if row, err := f.svc.q.GetIncomingWebhook(context.Background(), hookID); err != nil || row.DisabledAt == nil || row.DisabledReason != "the bot was removed from this space" {
		t.Errorf("row after sweep: %+v %v", row, err)
	}
	if n, _ := f.svc.SweepRemovedBotHooks(context.Background()); n != 0 {
		t.Errorf("second sweep changed %d rows", n)
	}
}
