package integrations

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
)

func (f *fixture) isAdmin(botID string) bool { return f.spaces.admin[f.space+"/"+botID] }

func (f *fixture) hookRow(t *testing.T, id string) (disabled bool, reason string) {
	t.Helper()
	row, err := f.svc.q.GetIncomingWebhook(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row.DisabledAt != nil, row.DisabledReason
}

func (f *fixture) rotate(t *testing.T, id string) string {
	t.Helper()
	res, err := f.svc.RotateSecret(f.admin, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: id}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.Url
}

func TestDeletingANotifyHookDemotesItsBot(t *testing.T) {
	f := setup(t)
	made := f.create(t, "UPS", true)
	bot := made.Webhook.BotUserId
	if !f.isAdmin(bot) {
		t.Fatal("notify_everyone should make the bot a space admin")
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: made.Webhook.Id})); err != nil {
		t.Fatal(err)
	}
	if f.isAdmin(bot) {
		t.Error("the bot stayed a space admin after its only notify hook was deleted")
	}

	// A bot already out of the space has no role to settle.
	kicked := f.create(t, "Grafana", true)
	if _, err := f.pool.Exec(context.Background(), `DELETE FROM space_members WHERE space_id = $1 AND user_id = $2`, f.space, kicked.Webhook.BotUserId); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: kicked.Webhook.Id})); err != nil {
		t.Errorf("deleting the hook of a kicked bot: %v", err)
	}
}

func TestSweepingAnOrphanedNotifyHookDemotesItsBot(t *testing.T) {
	f := setup(t)
	other := uuid.NewString()
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO channels (id, space_id, name, position) VALUES ($1, $2, 'alerts', 1)`, other, f.space); err != nil {
		t.Fatal(err)
	}
	f.spaces.channel[other] = f.space
	quiet := f.create(t, "Backups", false)
	loud, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{
		ChannelId: other, Name: "Backups loud", BotUserId: quiet.Webhook.BotUserId, NotifyEveryone: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	bot := loud.Msg.Webhook.BotUserId
	if !f.isAdmin(bot) {
		t.Fatal("notify_everyone should make the bot a space admin")
	}
	if _, err := f.pool.Exec(context.Background(), `DELETE FROM channels WHERE id = $1`, other); err != nil {
		t.Fatal(err)
	}
	if n, err := f.svc.SweepOrphanHooks(context.Background()); err != nil || n != 1 {
		t.Fatalf("sweep = %d, %v", n, err)
	}
	if f.isAdmin(bot) {
		t.Error("the bot stayed a space admin after the sweep revoked its only notify hook")
	}
	if f.bots.bots[bot].DeactivatedAt != nil {
		t.Error("a bot with a live hook was retired")
	}
}

func TestRotatingKeepsAHookOff(t *testing.T) {
	f := setup(t)
	off := false

	// Turned off by an admin: a new token doesn't turn it back on.
	made := f.create(t, "Alertmanager", false)
	if _, err := f.svc.UpdateIncoming(f.admin, connect.NewRequest(&integrationsv1.UpdateIncomingRequest{Id: made.Webhook.Id, Enabled: &off})); err != nil {
		t.Fatal(err)
	}
	url := f.rotate(t, made.Webhook.Id)
	if disabled, reason := f.hookRow(t, made.Webhook.Id); !disabled || reason != "turned off by an admin" {
		t.Errorf("after rotating an admin-disabled hook: disabled=%v reason=%q", disabled, reason)
	}
	if status, _ := f.post(t, path(url), "text/plain", "hi"); status != http.StatusNotFound {
		t.Errorf("the rotated token of a disabled hook answered %d", status)
	}

	// Off because its bot left the space: rotating doesn't bring it back.
	left := f.create(t, "Prometheus", false)
	if _, err := f.svc.RemoveBotFromSpace(f.admin, connect.NewRequest(&integrationsv1.RemoveBotFromSpaceRequest{BotUserId: left.Webhook.BotUserId, SpaceId: f.space})); err != nil {
		t.Fatal(err)
	}
	f.rotate(t, left.Webhook.Id)
	if disabled, reason := f.hookRow(t, left.Webhook.Id); !disabled || reason != reasonBotRemoved {
		t.Errorf("after rotating a bot-removed hook: disabled=%v reason=%q", disabled, reason)
	}

	// Off only because its token was revoked: rotating is the remedy.
	revoked := f.create(t, "Healthchecks", true)
	if err := f.bots.RevokeCredential(context.Background(), f.credentialOf(t, revoked.Webhook.Id)); err != nil {
		t.Fatal(err)
	}
	url = f.rotate(t, revoked.Webhook.Id)
	if disabled, _ := f.hookRow(t, revoked.Webhook.Id); disabled {
		t.Error("rotating a hook whose token was revoked left it off")
	}
	if status, _ := f.post(t, path(url), "text/plain", "back"); status != http.StatusOK {
		t.Errorf("the new token answered %d", status)
	}
	// Its grant went with the token: post-only, and the bot back to member.
	if f.isAdmin(revoked.Webhook.BotUserId) {
		t.Error("the bot kept its admin role with no notify grant left")
	}
}

func (f *fixture) credentialOf(t *testing.T, hookID string) string {
	t.Helper()
	row, err := f.svc.q.GetIncomingWebhook(context.Background(), hookID)
	if err != nil || row.CredentialID == nil {
		t.Fatalf("hook credential: %v %v", row.CredentialID, err)
	}
	return *row.CredentialID
}

func TestAFailedCreateLeavesNothingBehind(t *testing.T) {
	f := setup(t)
	activeBots := func() int {
		count := 0
		for _, bot := range f.bots.bots {
			if bot.DeactivatedAt == nil {
				count++
			}
		}
		return count
	}
	admins := func() int {
		count := 0
		for _, admin := range f.spaces.admin {
			if admin {
				count++
			}
		}
		return count
	}

	// The token can't be minted, after the bot was made an admin.
	f.bots.failMint = errors.New("credentials store down")
	if _, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{
		ChannelId: f.channel, Name: "Watchtower", NotifyEveryone: true,
	})); err == nil {
		t.Fatal("create succeeded with the mint failing")
	}
	f.bots.failMint = nil
	if activeBots() != 0 || admins() != 0 || len(f.bots.creds) != 0 {
		t.Errorf("after a failed mint: %d active bots, %d admins, %d credentials", activeBots(), admins(), len(f.bots.creds))
	}

	// The hook row can't be written: its channel is unknown to the table.
	ghost := uuid.NewString()
	f.spaces.channel[ghost] = f.space
	if _, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{
		ChannelId: ghost, Name: "Watchtower", NotifyEveryone: true,
	})); err == nil {
		t.Fatal("create succeeded with no channel row")
	}
	if activeBots() != 0 || admins() != 0 || len(f.bots.creds) != 0 {
		t.Errorf("after a failed insert: %d active bots, %d admins, %d credentials", activeBots(), admins(), len(f.bots.creds))
	}

	// An existing bot the admin chose is left as it was.
	made, err := f.svc.CreateBot(f.admin, connect.NewRequest(&integrationsv1.CreateBotRequest{Username: "ntfy", DisplayName: "ntfy"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddBotToSpace(f.admin, connect.NewRequest(&integrationsv1.AddBotToSpaceRequest{BotUserId: made.Msg.Bot.Id, SpaceId: f.space})); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CreateIncoming(f.admin, connect.NewRequest(&integrationsv1.CreateIncomingRequest{
		ChannelId: ghost, Name: "ntfy", BotUserId: made.Msg.Bot.Id, NotifyEveryone: true,
	})); err == nil {
		t.Fatal("create succeeded with no channel row")
	}
	if f.bots.bots[made.Msg.Bot.Id].DeactivatedAt != nil || f.isAdmin(made.Msg.Bot.Id) {
		t.Errorf("an existing bot after a failed create: deactivated=%v admin=%v",
			f.bots.bots[made.Msg.Bot.Id].DeactivatedAt != nil, f.isAdmin(made.Msg.Bot.Id))
	}
}

func TestRotatingWithAnUnreadableCredentialFails(t *testing.T) {
	f := setup(t)
	made := f.create(t, "UPS", true)
	f.bots.failCredentials = errors.New("credentials store down")
	if _, err := f.svc.RotateSecret(f.admin, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: made.Webhook.Id})); err == nil {
		t.Fatal("rotated without reading the old grant")
	}
	f.bots.failCredentials = nil
	if status, _ := f.post(t, path(made.Url), "text/plain", "still here"); status != http.StatusOK {
		t.Errorf("the old token after a refused rotation answered %d", status)
	}
	cred := f.bots.creds[f.credentialOf(t, made.Webhook.Id)]
	if len(cred.Grants) != 2 {
		t.Errorf("grants after a refused rotation = %v", cred.Grants)
	}
}
