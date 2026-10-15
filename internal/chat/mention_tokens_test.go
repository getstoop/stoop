package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func (f groupFixture) storedContent(t *testing.T, messageID string) string {
	t.Helper()
	var content string
	if err := f.pool.QueryRow(context.Background(), "SELECT content FROM messages WHERE id = $1", messageID).Scan(&content); err != nil {
		t.Fatal(err)
	}
	return content
}

func (f groupFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (f groupFixture) history(t *testing.T, person context.Context) map[string]*chatv1.Message {
	t.Helper()
	list, err := f.svc.ListMessages(person, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: f.generalID}))
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]*chatv1.Message{}
	for _, message := range list.Msg.Messages {
		byID[message.Id] = message
	}
	return byID
}

func TestMentionTokensFollowRenames(t *testing.T) {
	fixture := newGroupFixture(t)
	beaID := authctx.UserID(fixture.bea)

	written := "hi @Bea and @@gardeners, not @nobody"
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, written)
	if want := "hi @bea and @@gardeners, not @nobody"; sent.Content != want {
		t.Errorf("sent content = %q, want %q", sent.Content, want)
	}
	stored := fixture.storedContent(t, sent.Id)
	if want := "hi <@u:" + beaID + ":bea> and <@g:" + fixture.groupID + ":gardeners>, not @nobody"; stored != want {
		t.Errorf("stored content = %q, want %q", stored, want)
	}

	quote, err := fixture.svc.SendMessage(fixture.cal, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.generalID, Content: "agreed @bea", ReplyToMessageId: sent.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if preview := quote.Msg.Message.ReplyTo.Preview; !strings.Contains(preview, "hi @bea and @@gardeners") {
		t.Errorf("reply quote on send = %q", preview)
	}

	fixture.exec(t, "UPDATE users SET username = 'bea_k' WHERE id = $1", beaID)
	fixture.exec(t, "UPDATE groups SET handle = 'growers' WHERE id = $1", fixture.groupID)

	history := fixture.history(t, fixture.cal)
	if got, want := history[sent.Id].Content, "hi @bea_k and @@growers, not @nobody"; got != want {
		t.Errorf("after the renames the message reads %q, want %q", got, want)
	}
	if got := history[quote.Msg.Message.Id]; got.Content != "agreed @bea_k" || !strings.Contains(got.ReplyTo.Preview, "hi @bea_k and @@growers") {
		t.Errorf("after the renames the reply reads %q quoting %q", got.Content, got.ReplyTo.Preview)
	}

	activity, err := fixture.svc.ListActivity(fixture.bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range activity.Msg.Items {
		if strings.Contains(item.Preview, "<@") || !strings.Contains(item.Preview, "@bea_k") {
			t.Errorf("activity preview after the rename = %q", item.Preview)
		}
	}
	if len(activity.Msg.Items) == 0 {
		t.Error("bea has no activity")
	}

	// A group deleted since reads as the handle it was written with.
	fixture.exec(t, "DELETE FROM groups WHERE id = $1", fixture.groupID)
	if got, want := fixture.history(t, fixture.cal)[sent.Id].Content, "hi @bea_k and @@gardeners, not @nobody"; got != want {
		t.Errorf("after the group's deletion the message reads %q, want %q", got, want)
	}
}

func TestMentionTokensANewOwnerOfAnOldNameInheritsNothing(t *testing.T) {
	fixture := newGroupFixture(t)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, "thanks @bea")
	fixture.exec(t, "UPDATE users SET username = 'bea_k' WHERE id = $1", authctx.UserID(fixture.bea))
	newBea := newUser(t, fixture.pool, "bea", authctx.RoleMember)
	invite, err := fixture.svc.CreateInvite(fixture.owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: fixture.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.JoinSpace(newBea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if got := fixture.history(t, newBea)[sent.Id].Content; got != "thanks @bea_k" {
		t.Errorf("the old message reads %q, want it to name the renamed person", got)
	}
}

func TestMentionTokensOnEdit(t *testing.T) {
	fixture := newGroupFixture(t)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, "hello")
	edited, err := fixture.svc.EditMessage(fixture.owner, connect.NewRequest(&chatv1.EditMessageRequest{
		MessageId: sent.Id, Content: "hello @cal",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if edited.Msg.Message.Content != "hello @cal" {
		t.Errorf("edited content = %q", edited.Msg.Message.Content)
	}
	if stored := fixture.storedContent(t, sent.Id); stored != "hello <@u:"+authctx.UserID(fixture.cal)+":cal>" {
		t.Errorf("stored after the edit = %q", stored)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("an edit told cal: %d unread", unread)
	}
}

func TestMentionTokensLengthCountsTheWrittenText(t *testing.T) {
	fixture := newGroupFixture(t)
	written := strings.Repeat("@cal ", 800)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, written)
	if sent.Content != written {
		t.Error("a full-length message with mentions did not read back as written")
	}
	if stored := fixture.storedContent(t, sent.Id); len(stored) <= len(written) {
		t.Errorf("stored %d characters, want more than the %d written", len(stored), len(written))
	}
}

func TestMentionTokensTypedByHandAreSavedAsText(t *testing.T) {
	fixture := newGroupFixture(t)
	typed := "<@u:" + authctx.UserID(fixture.cal) + ":someone>"
	sent := fixture.sendTo(t, fixture.bea, fixture.generalID, typed)
	if sent.Content != "@someone" || len(sent.MentionUserIds) != 0 {
		t.Errorf("a typed token reads %q and reached %v", sent.Content, sent.MentionUserIds)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("a typed token told cal: %d unread", unread)
	}
	if stored := fixture.storedContent(t, sent.Id); stored != "@someone" {
		t.Errorf("a typed token was stored as %q", stored)
	}
}
