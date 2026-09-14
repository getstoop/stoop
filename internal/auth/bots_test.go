package auth_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestBotsAndHookTokens(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	casey, _ := signIn(t, svc, "casey", "correct horse battery")
	bg := context.Background()

	bot, err := svc.CreateBot(bg, "Uptime", "Uptime Kuma")
	if err != nil {
		t.Fatal(err)
	}
	if bot.Username != "uptime" || bot.DeactivatedAt != nil {
		t.Errorf("bot = %+v", bot)
	}
	if _, err := svc.CreateBot(bg, "uptime", "again"); codeOf(err) != connect.CodeAlreadyExists {
		t.Errorf("duplicate username: %v", err)
	}
	if _, err := svc.CreateBot(bg, "everyone", "x"); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("reserved username: %v", err)
	}
	if _, err := svc.GetBot(bg, authctx.UserID(casey)); codeOf(err) != connect.CodeNotFound {
		t.Errorf("a person answered as a bot: %v", err)
	}

	// A bot never signs in, even if its row somehow holds a password:
	// the answer is the one an unknown handle gets.
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "uptime", Password: ""})); err == nil {
		t.Error("a bot logged in")
	}
	hash, err := argon2id.CreateHash("hunter22", testArgon2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(bg, `UPDATE users SET password_hash = $1 WHERE id = $2`, hash, bot.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "uptime", Password: "hunter22"})); codeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("a bot with a password: want unauthenticated, got %v", err)
	}

	// A bot never holds the instance role: both promote paths refuse it,
	// and the schema refuses a row that slips past them.
	if _, err := svc.SetAccountRole(bg, bot.ID, authctx.RoleAdmin); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("promote a bot by id: %v", err)
	}
	if _, err := svc.SetRoleByUsername(bg, "uptime", authctx.RoleAdmin); err == nil {
		t.Error("promote a bot by username succeeded")
	}
	if _, err := pool.Exec(bg, `UPDATE users SET role = 'admin' WHERE id = $1`, bot.ID); err == nil {
		t.Error("the schema let a bot be admin")
	}
	if _, err := svc.SetAccountRole(bg, bot.ID, authctx.RoleMember); err != nil {
		t.Errorf("setting a bot to member should be a no-op, got %v", err)
	}

	// What only makes sense for a person is refused for a bot, in words.
	if _, _, err := svc.ResetPassword(bg, bot.ID); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("reset a bot's password: %v", err)
	}
	if _, err := svc.SetAccountUsernameFrozen(bg, bot.ID, true); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("freeze a bot's username: %v", err)
	}
	asBot := authctx.WithIdentity(bg, authctx.Identity{UserID: bot.ID, Role: authctx.RoleMember, Kind: authctx.KindBot,
		Credential: authctx.Credential{Kind: authctx.CredentialBotToken, Grants: []authctx.Action{authctx.ProfileManage}}})
	if _, err := svc.UpdateProfile(asBot, connect.NewRequest(&authv1.UpdateProfileRequest{DisplayName: "Sneaky"})); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a bot edited its own profile: %v", err)
	}

	// An admin writes the bio; it takes a person's shape and shows on the
	// card. Files asks who is a bot before setting an avatar for them.
	long := strings.Repeat("x", 301)
	if _, err := svc.UpdateBot(bg, bot.ID, nil, nil, &long); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("a 301-character bio: %v", err)
	}
	about := "Posts when a service\n\ngoes down."
	updated, err := svc.UpdateBot(bg, bot.ID, nil, nil, &about)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Bio != "Posts when a service goes down." {
		t.Errorf("bio = %q", updated.Bio)
	}
	if isBot, err := svc.IsBot(bg, bot.ID); err != nil || !isBot {
		t.Errorf("IsBot(bot) = %v, %v", isBot, err)
	}
	if isBot, err := svc.IsBot(bg, authctx.UserID(casey)); err != nil || isBot {
		t.Errorf("IsBot(person) = %v, %v", isBot, err)
	}

	// The card and GetMe say what it is.
	profile, err := svc.GetUserProfile(casey, connect.NewRequest(&authv1.GetUserProfileRequest{UserId: bot.ID}))
	if err != nil {
		t.Fatal(err)
	}
	if profile.Msg.Profile.Kind != accessv1.IdentityKind_IDENTITY_KIND_BOT || profile.Msg.Profile.Bio != updated.Bio {
		t.Errorf("bot profile = %+v", profile.Msg.Profile)
	}
	if me, err := svc.GetMe(asBot, connect.NewRequest(&authv1.GetMeRequest{})); err != nil {
		t.Fatal(err)
	} else if me.Msg.User.Kind != accessv1.IdentityKind_IDENTITY_KIND_BOT {
		t.Errorf("bot GetMe kind = %v", me.Msg.User.Kind)
	}
	if me, err := svc.GetMe(casey, connect.NewRequest(&authv1.GetMeRequest{})); err != nil {
		t.Fatal(err)
	} else if me.Msg.User.Kind != accessv1.IdentityKind_IDENTITY_KIND_PERSON {
		t.Errorf("person GetMe kind = %v", me.Msg.User.Kind)
	}

	spaceID, channelID := uuid.NewString(), uuid.NewString()
	if _, err := pool.Exec(bg, `INSERT INTO spaces (id, name, owner_id) VALUES ($1, 'Porch', $2)`, spaceID, authctx.UserID(casey)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(bg, `INSERT INTO channels (id, space_id, name, position) VALUES ($1, $2, 'general', 0)`, channelID, spaceID); err != nil {
		t.Fatal(err)
	}

	// A hook token: bounded to one channel, refused everywhere but the hook URL.
	hook, secret, err := svc.MintCredential(bg, auth.MintBotCredential{
		HolderID: bot.ID, Kind: authctx.CredentialIncomingHook, Name: "alerts",
		Grants: []authctx.Action{authctx.MessagesPost}, ChannelID: channelID, CreatedBy: authctx.UserID(casey),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "stp_hook_") || hook.Hint != secret[len(secret)-4:] || !hook.Bounded {
		t.Errorf("hook = %+v secret %q", hook, secret)
	}
	if _, err := svc.VerifyToken(bg, secret); err == nil {
		t.Error("a hook token worked as a bearer token")
	}
	id, err := svc.VerifyHookToken(bg, secret)
	if err != nil {
		t.Fatal(err)
	}
	if id.UserID != bot.ID || id.Kind != authctx.KindBot || id.Credential.Kind != authctx.CredentialIncomingHook ||
		!id.Credential.Reaches("", channelID) || id.Credential.Reaches(spaceID, "") || !id.Credential.Covers(authctx.MessagesPost) || id.Credential.Covers(authctx.MessagesRead) {
		t.Errorf("hook identity = %+v", id)
	}

	// Minting rules.
	if _, _, err := svc.MintCredential(bg, auth.MintBotCredential{HolderID: bot.ID, Kind: authctx.CredentialIncomingHook, Name: "x", Grants: []authctx.Action{authctx.MessagesPost}}); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("hook without a channel: %v", err)
	}
	if _, _, err := svc.MintCredential(bg, auth.MintBotCredential{HolderID: bot.ID, Kind: authctx.CredentialIncomingHook, Name: "x", Grants: []authctx.Action{authctx.InstanceRead}, ChannelID: channelID}); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("bounded hook with an instance action: %v", err)
	}
	if _, _, err := svc.MintCredential(bg, auth.MintBotCredential{HolderID: authctx.UserID(casey), Kind: authctx.CredentialBotToken, Name: "x", Grants: []authctx.Action{authctx.MessagesRead}}); codeOf(err) != connect.CodeNotFound {
		t.Errorf("a person got a bot credential: %v", err)
	}
	token, tokenSecret, err := svc.MintCredential(bg, auth.MintBotCredential{
		HolderID: bot.ID, Kind: authctx.CredentialBotToken, Name: "reader",
		Grants: []authctx.Action{authctx.SpaceRead, authctx.MessagesRead},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tokenSecret, "stp_bot_") {
		t.Errorf("bot token secret %q", tokenSecret)
	}
	if tid, err := svc.VerifyToken(bg, tokenSecret); err != nil || tid.Credential.Kind != authctx.CredentialBotToken || tid.Credential.Bounded || !tid.Credential.Reaches(spaceID, "") {
		t.Errorf("bot token verified as %+v, %v", tid, err)
	}
	// Activity is a preview of messages: a bot token can't be granted it
	// without a read grant beside it.
	if _, _, err := svc.MintCredential(bg, auth.MintBotCredential{HolderID: bot.ID, Kind: authctx.CredentialBotToken, Name: "x", Grants: []authctx.Action{authctx.ActivityRead}}); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("activity without a read: %v", err)
	}
	if _, err := svc.VerifyHookToken(bg, tokenSecret); err == nil {
		t.Error("a bot token worked as a hook token")
	}

	// Grants change in place; listing never carries the secret.
	if err := svc.SetCredentialGrants(bg, hook.ID, []authctx.Action{authctx.MessagesPost, authctx.MessagesNotifyEveryone}); err != nil {
		t.Fatal(err)
	}
	creds, err := svc.BotCredentials(bg, []string{bot.ID}, nil)
	if err != nil || len(creds) != 2 {
		t.Fatalf("credentials = %+v, %v", creds, err)
	}
	if all, err := svc.BotCredentials(bg, nil, nil); err != nil || len(all) != 2 {
		t.Errorf("every bot credential = %+v, %v", all, err)
	}
	byID, err := svc.BotCredentials(bg, nil, []string{hook.ID})
	if err != nil || len(byID) != 1 || len(byID[0].Grants) != 2 || byID[0].ChannelIDs[0] != channelID {
		t.Errorf("by id = %+v, %v", byID, err)
	}
	if n, _ := svc.CountCredentials(bg, bot.ID); n != 2 {
		t.Errorf("count = %d", n)
	}

	// Revoking and deactivating.
	if err := svc.RevokeCredential(bg, hook.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyHookToken(bg, secret); err == nil {
		t.Error("a revoked hook token still verifies")
	}
	if err := svc.RevokeCredential(bg, hook.ID); codeOf(err) != connect.CodeNotFound {
		t.Errorf("revoking twice: %v", err)
	}
	if _, err := svc.RevokeCredential(bg, token.ID), svc.DeactivateBot(bg, bot.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.GetBot(bg, bot.ID); got.DeactivatedAt == nil {
		t.Error("bot not deactivated")
	}
	if _, _, err := svc.MintCredential(bg, auth.MintBotCredential{HolderID: bot.ID, Kind: authctx.CredentialBotToken, Name: "x", Grants: []authctx.Action{authctx.MessagesRead}}); codeOf(err) != connect.CodeNotFound {
		t.Errorf("a deactivated bot got a credential: %v", err)
	}
	if err := svc.DeactivateBot(bg, authctx.UserID(casey)); codeOf(err) != connect.CodeNotFound {
		t.Errorf("deactivating a person as a bot: %v", err)
	}
}
