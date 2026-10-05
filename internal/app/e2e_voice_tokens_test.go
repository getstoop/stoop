package app_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// A bot's token may join voice; a personal token may not, whether it
// asks at minting or already holds the grant from before the rule.
func TestE2EVoiceIsForBotsNotPersonalTokens(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	h := newHarnessOn(t, databaseURL,
		"STOOP_LIVEKIT_URL", "http://127.0.0.1:7880",
		"STOOP_LIVEKIT_KEY_FILE", filepath.Join(t.TempDir(), "keys.yaml"))
	casey := h.person("casey")
	stoop, _ := h.space(casey, "The Stoop")
	hangout := h.rpc(casey, "stoop.chat.v1.ChatService/CreateChannel", map[string]any{
		"spaceId": stoop, "name": "hangout", "kind": "CHANNEL_KIND_VOICE",
	}).expect(t, "ok").str("channel.id")
	join := map[string]any{"channelId": hangout}

	h.rpc(casey, "stoop.voice.v1.VoiceService/JoinVoiceChannel", join).expect(t, "ok")

	bot := h.bot(casey, "scribe")
	h.addBot(casey, bot, stoop)
	h.rpc(h.botToken(casey, bot, "voice.join"), "stoop.voice.v1.VoiceService/JoinVoiceChannel", join).expect(t, "ok")

	h.rpc(casey, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{
		"name": "x", "permissions": perms([]string{"voice.join"}), "expiresInDays": 30,
	}).expect(t, "invalid_argument", "can't be allowed to join voice")

	// A token minted before the rule still holds the grant; it no longer works.
	script := h.pat(casey, "space.read")
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(context.Background(),
		`UPDATE credentials SET grants = array_append(grants, 'voice.join') WHERE kind = 'personal_token'`); err != nil {
		t.Fatal(err)
	}
	h.rpc(script, "stoop.voice.v1.VoiceService/JoinVoiceChannel", join).expect(t, "permission_denied")
	h.rpc(script, "stoop.chat.v1.ChatService/ListChannels", map[string]any{"spaceId": stoop}).expect(t, "ok")
}
