package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// botDirectory reads users and their kind from the table.
type botDirectory struct{ pool *pgxpool.Pool }

func (d botDirectory) GetUsers(ctx context.Context, ids []string) ([]chat.UserRecord, error) {
	rows, err := d.pool.Query(ctx, `SELECT id, username, role, kind FROM users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []chat.UserRecord
	for rows.Next() {
		var r chat.UserRecord
		var role, kind string
		if err := rows.Scan(&r.ID, &r.Username, &role, &kind); err != nil {
			return nil, err
		}
		r.InstanceAdmin, r.Bot = role == "admin", kind == "bot"
		out = append(out, r)
	}
	return out, rows.Err()
}

func newBot(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, display_name, role, kind) VALUES ($1, $2, $3, 'member', 'bot')`, id, name, name); err != nil {
		t.Fatal(err)
	}
	return id
}

// hookIdentity is a bot posting through an incoming hook: a credential
// bounded to one channel, with the given grant.
func hookIdentity(botID, channelID string, grants ...authctx.Action) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: botID, Role: authctx.RoleMember, Kind: authctx.KindBot,
		Credential: authctx.Credential{
			ID: uuid.NewString(), Kind: authctx.CredentialIncomingHook, Grants: grants,
			Bounded: true, Channels: []string{channelID},
		},
	})
}

func TestBotsInSpaces(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), botDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	bot := newBot(t, pool, "uptime")
	bg := context.Background()

	// A bot can't be messaged, and doesn't appear as a candidate.
	if _, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{bot}})); code(err) != connect.CodePermissionDenied {
		t.Errorf("DM to a bot: %v", err)
	}
	if err := svc.AddBotMember(bg, spaceID, bot); err != nil {
		t.Fatal(err)
	}
	if err := svc.AddBotMember(bg, spaceID, bot); err != nil {
		t.Errorf("adding twice should be fine: %v", err)
	}
	cands, err := svc.ListDirectMessageCandidates(owner, connect.NewRequest(&chatv1.ListDirectMessageCandidatesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands.Msg.Users) != 0 {
		t.Errorf("bot listed as a DM candidate: %+v", cands.Msg.Users)
	}
	if got, err := svc.ChannelSpace(bg, channelID); err != nil || got != spaceID {
		t.Errorf("ChannelSpace = %q, %v", got, err)
	}
	if name, err := svc.SpaceName(bg, spaceID); err != nil || name != "Porch" {
		t.Errorf("SpaceName = %q, %v", name, err)
	}

	// The hook's grant alone doesn't ping: the bot must hold it too.
	post := func(ctx context.Context) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@everyone disk failing"}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	if m := post(hookIdentity(bot, channelID, authctx.MessagesPost)); m.MentionsEveryone {
		t.Error("a hook without the grant pinged everyone")
	}
	if m := post(hookIdentity(bot, channelID, authctx.MessagesPost, authctx.MessagesNotifyEveryone)); m.MentionsEveryone {
		t.Error("a member bot pinged everyone")
	}
	if err := svc.SetBotAdmin(bg, spaceID, bot, true); err != nil {
		t.Fatal(err)
	}
	if m := post(hookIdentity(bot, channelID, authctx.MessagesPost)); m.MentionsEveryone {
		t.Error("an admin bot without the grant pinged everyone")
	}
	if m := post(hookIdentity(bot, channelID, authctx.MessagesPost, authctx.MessagesNotifyEveryone)); !m.MentionsEveryone || len(m.MentionUserIds) != 1 {
		t.Errorf("grant + admin should ping: %+v", m)
	}
	if memberRole(t, pool, spaceID, hookIdentity(bot, channelID)) != "admin" {
		t.Error("bot is not admin")
	}
	if err := svc.SetBotAdmin(bg, spaceID, bot, false); err != nil {
		t.Fatal(err)
	}
	if memberRole(t, pool, spaceID, hookIdentity(bot, channelID)) != "member" {
		t.Error("bot is not back to member")
	}

	// The bound channel is the only one the hook reaches.
	other, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "other"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(hookIdentity(bot, channelID, authctx.MessagesPost), connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: other.Msg.Channel.Id, Content: "wrong room",
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("posted outside the bound channel: %v", err)
	}
}
