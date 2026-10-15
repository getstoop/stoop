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

// Kept tokens carry the current handle whatever the sender wrote; the
// rest are saved as text and reach nobody. Content goes out as stored.
func TestMentionTokensAreChecked(t *testing.T) {
	fixture := newGroupFixture(t)
	beaID := authctx.UserID(fixture.bea)
	stranger := newUser(t, fixture.pool, "stranger", authctx.RoleMember)
	written := "hi <@u:" + beaID + ":wrong> and <@g:" + fixture.groupID + ":wrong>, not " +
		mentionOf(stranger) + " or <@g:0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8c:ghosts> or @cal"
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, written)
	want := "hi <@u:" + beaID + ":bea> and <@g:" + fixture.groupID + ":gardeners>, not @someone or @ghosts or @cal"
	if stored := fixture.storedContent(t, sent.Id); stored != want {
		t.Errorf("stored content = %q, want %q", stored, want)
	}
	if sent.Content != want {
		t.Errorf("sent content = %q, want it as stored", sent.Content)
	}
	if listed := fixture.history(t, fixture.cal)[sent.Id].Content; listed != want {
		t.Errorf("listed content = %q, want it as stored", listed)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 1 {
		t.Errorf("cal, in the group, has %d unread; want 1 (typed @cal tells nobody)", unread)
	}
	if unread := fixture.unread(t, stranger); unread != 0 {
		t.Errorf("someone outside the space was told: %d unread", unread)
	}
}

// Previews read tokens as current handles; content keeps its tokens.
func TestMentionTokensPreviewsFollowRenames(t *testing.T) {
	fixture := newGroupFixture(t)
	beaID := authctx.UserID(fixture.bea)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, "hi "+mentionOf(fixture.bea)+" and "+groupMention(fixture.groupID))
	quote, err := fixture.svc.SendMessage(fixture.cal, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.generalID, Content: "agreed", ReplyToMessageId: sent.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if preview := quote.Msg.Message.ReplyTo.Preview; preview != "hi @bea and @gardeners" {
		t.Errorf("reply quote on send = %q", preview)
	}

	fixture.exec(t, "UPDATE users SET username = 'bea_k' WHERE id = $1", beaID)
	fixture.exec(t, "UPDATE groups SET handle = 'growers' WHERE id = $1", fixture.groupID)

	history := fixture.history(t, fixture.cal)
	if got := history[quote.Msg.Message.Id].ReplyTo.Preview; got != "hi @bea_k and @growers" {
		t.Errorf("after the renames the reply quotes %q", got)
	}
	if got := history[sent.Id].Content; !strings.Contains(got, "<@u:"+beaID+":bea>") {
		t.Errorf("content after the renames = %q, want the token as stored", got)
	}
	activity, err := fixture.svc.ListActivity(fixture.bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(activity.Msg.Items) == 0 || activity.Msg.Items[0].Preview != "hi @bea_k and @growers" {
		t.Errorf("bea's activity after the renames = %v", activity.Msg.Items)
	}

	// A group deleted since previews as its saved handle.
	fixture.exec(t, "DELETE FROM groups WHERE id = $1", fixture.groupID)
	if got := fixture.history(t, fixture.cal)[quote.Msg.Message.Id].ReplyTo.Preview; got != "hi @bea_k and @gardeners" {
		t.Errorf("after the group's deletion the reply quotes %q", got)
	}
}

// A handle with "__" in it previews as written, not as underline.
func TestMentionTokensPreviewHandlesWhole(t *testing.T) {
	fixture := newGroupFixture(t)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, mentionOf(fixture.bea)+" hi")
	fixture.exec(t, "UPDATE users SET username = 'b__e__a' WHERE id = $1", authctx.UserID(fixture.bea))
	reply, err := fixture.svc.SendMessage(fixture.cal, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.generalID, Content: "same", ReplyToMessageId: sent.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got := reply.Msg.Message.ReplyTo.Preview; got != "@b__e__a hi" {
		t.Errorf("reply quote on send = %q", got)
	}
	if got := fixture.history(t, fixture.cal)[reply.Msg.Message.Id].ReplyTo.Preview; got != "@b__e__a hi" {
		t.Errorf("reply quote listed = %q", got)
	}
	activity, err := fixture.svc.ListActivity(fixture.bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(activity.Msg.Items) != 1 || activity.Msg.Items[0].Preview != "@b__e__a hi" {
		t.Errorf("bea's activity = %v", activity.Msg.Items)
	}
}

func TestMentionTokensOnEdit(t *testing.T) {
	fixture := newGroupFixture(t)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, "hello")
	edited, err := fixture.svc.EditMessage(fixture.owner, connect.NewRequest(&chatv1.EditMessageRequest{
		MessageId: sent.Id, Content: "hello " + mentionOf(fixture.cal),
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := "hello <@u:" + authctx.UserID(fixture.cal) + ":cal>"
	if edited.Msg.Message.Content != want || fixture.storedContent(t, sent.Id) != want {
		t.Errorf("edited content = %q, want %q", edited.Msg.Message.Content, want)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("an edit told cal: %d unread", unread)
	}
}

func TestMentionTokensLengthCountsHandles(t *testing.T) {
	fixture := newGroupFixture(t)
	unit := mentionOf(fixture.cal) + " "
	content := strings.Repeat(unit, 4000/len("@someone "))
	if _, err := fixture.svc.SendMessage(fixture.owner, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.generalID, Content: content,
	})); err != nil {
		t.Errorf("a message of %d characters as written was refused: %v", 4000/len("@someone ")*len("@someone "), err)
	}
	if _, err := fixture.svc.SendMessage(fixture.owner, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.generalID, Content: content + strings.Repeat("x", 4000),
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("an over-long message: %v, want invalid_argument", err)
	}
}

// A mention doesn't work in code: it is saved as its handle and tells
// nobody.
func TestMentionTokensInCodeAreText(t *testing.T) {
	fixture := newGroupFixture(t)
	written := "`" + mentionOf(fixture.cal) + "`\n```\n" + groupMention(fixture.groupID) + "\n```"
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, written)
	if want := "`@someone`\n```\n@somegroup\n```"; sent.Content != want {
		t.Errorf("content = %q, want %q", sent.Content, want)
	}
	if len(sent.MentionUserIds) != 0 {
		t.Errorf("tokens in code reached %v", sent.MentionUserIds)
	}
}

// A token the message shows as text reaches nobody and is saved as text;
// one it shows as a mention reaches its person, wherever backticks sit.
func TestMentionTokensFollowTheParse(t *testing.T) {
	fixture := newGroupFixture(t)
	calID := authctx.UserID(fixture.cal)
	cal := "<@u:" + calID + ":cal>"
	shownAsText := map[string]string{
		"||" + mentionOf(fixture.cal) + "||":                      "||@someone||",
		"[see " + mentionOf(fixture.cal) + "](https://x.example)": "[see @someone](https://x.example)",
		"**a `b** c` d " + mentionOf(fixture.cal) + " `e`":        "**a `b** c` d @someone `e`",
	}
	for written, want := range shownAsText {
		sent := fixture.sendTo(t, fixture.owner, fixture.generalID, written)
		if sent.Content != want {
			t.Errorf("%q saved as %q, want %q", written, sent.Content, want)
		}
		if len(sent.MentionUserIds) != 0 {
			t.Errorf("%q reached %v", written, sent.MentionUserIds)
		}
	}
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("cal has %d unread from tokens shown as text", unread)
	}

	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, "*x `"+mentionOf(fixture.cal)+"* y`")
	if want := "*x `" + cal + "* y`"; sent.Content != want {
		t.Errorf("saved as %q, want %q", sent.Content, want)
	}
	if len(sent.MentionUserIds) != 1 || sent.MentionUserIds[0] != calID {
		t.Errorf("a token outside code reached %v, want cal", sent.MentionUserIds)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 1 {
		t.Errorf("cal has %d unread, want 1", unread)
	}
}
