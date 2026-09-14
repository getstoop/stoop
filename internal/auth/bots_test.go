package auth_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

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
	if bot.Username != "uptime" || bot.InstanceAdmin || bot.DeactivatedAt != nil {
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

	// A bot never signs in.
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "uptime", Password: ""})); err == nil {
		t.Error("a bot logged in")
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
		Grants: []authctx.Action{authctx.SpaceRead, authctx.MessagesRead}, Limited: true, SpaceIDs: []string{spaceID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tokenSecret, "stp_bot_") {
		t.Errorf("bot token secret %q", tokenSecret)
	}
	if tid, err := svc.VerifyToken(bg, tokenSecret); err != nil || tid.Credential.Kind != authctx.CredentialBotToken || !tid.Credential.Reaches(spaceID, "") {
		t.Errorf("bot token verified as %+v, %v", tid, err)
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
