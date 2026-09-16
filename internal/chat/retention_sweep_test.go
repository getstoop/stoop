package chat_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// retentionPolicy keeps messages for a fixed number of days.
type retentionPolicy int

func (retentionPolicy) MembersMayCreateSpaces(context.Context) (bool, error) { return true, nil }
func (p retentionPolicy) MessageRetentionDays(context.Context) (int, error)  { return int(p), nil }

// See docs/architecture/messaging.md#message-retention.
func TestMessageRetention(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	files := &dbFiles{pool: pool}
	svc.UseFiles(files)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, err := svc.CreateInvite(casey, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(ada, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	send := func(ctx context.Context, channel, content, replyTo string, files ...string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channel, Content: content, ReplyToMessageId: replyTo, AttachmentIds: files,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	photo := newFile(t, pool, casey, spaceID, "attachment", "porch.jpg")
	old := send(casey, channelID, "tomatoes are in", "", photo)
	pinned := send(ada, channelID, "the rules", old.Id)
	if _, err := svc.SetMessagePinned(casey, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: pinned.Id, Pinned: true})); err != nil {
		t.Fatal(err)
	}
	dm, err := svc.OpenDirectMessage(casey, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{authctx.UserID(ada)}}))
	if err != nil {
		t.Fatal(err)
	}
	send(casey, dm.Msg.DirectMessage.Channel.Id, "see you saturday", "")
	later := time.Now().Add(31 * 24 * time.Hour)

	// Keep forever, or nothing old enough: nothing goes.
	svc.UseInstancePolicy(retentionPolicy(0))
	if n, err := svc.SweepMessages(context.Background(), later); err != nil || n != 0 {
		t.Fatalf("sweep keeping forever: %d %v", n, err)
	}
	svc.UseInstancePolicy(retentionPolicy(30))
	if n, err := svc.SweepMessages(context.Background(), time.Now()); err != nil || n != 0 {
		t.Fatalf("sweep today: %d %v", n, err)
	}

	count, err := svc.CountExpiredMessages(context.Background(), later, 30)
	if err != nil || count != 2 {
		t.Errorf("count in a month: %d %v, want 2 (the space message and the DM)", count, err)
	}
	n, err := svc.SweepMessages(context.Background(), later)
	if err != nil || n != 2 {
		t.Fatalf("sweep in a month: %d %v", n, err)
	}

	// The pinned reply stays, quoting nothing; the old message's file went
	// with it; the channel now ends at what's left.
	msgs, err := svc.ListMessages(ada, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs.Msg.Messages) != 1 || msgs.Msg.Messages[0].Id != pinned.Id {
		t.Fatalf("channel after the sweep: %v", msgs.Msg.Messages)
	}
	if ref := msgs.Msg.Messages[0].ReplyTo; ref != nil && ref.Preview != "" {
		t.Errorf("reply still quotes a swept parent: %v", ref)
	}
	if len(files.deleted) != 1 || files.deleted[0] != photo {
		t.Errorf("files deleted: %v, want the swept message's photo", files.deleted)
	}
	chs, err := svc.ListChannels(ada, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range chs.Msg.Channels {
		if c.Id == channelID && c.LastMessageId != pinned.Id {
			t.Errorf("last message = %q, want the pinned reply", c.LastMessageId)
		}
	}
	dmMsgs, err := svc.ListMessages(ada, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: dm.Msg.DirectMessage.Channel.Id}))
	if err != nil || len(dmMsgs.Msg.Messages) != 0 {
		t.Errorf("DM after the sweep: %v %v", dmMsgs, err)
	}
}

// An expired attachment keeps its place on the message, nameless, and
// can't be attached again.
func TestExpiredAttachmentsOnMessages(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	svc.UseFiles(&dbFiles{pool: pool})
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	photo := newFile(t, pool, casey, spaceID, "attachment", "porch.jpg")
	sent, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, AttachmentIds: []string{photo}}))
	if err != nil {
		t.Fatal(err)
	}
	pending := newFile(t, pool, casey, spaceID, "attachment", "draft.jpg")
	if _, err := pool.Exec(context.Background(), `UPDATE files SET expired_at = now(), name = '' WHERE id = ANY($1::uuid[])`, []string{photo, pending}); err != nil {
		t.Fatal(err)
	}

	msgs, err := svc.ListMessages(casey, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	if a := msgs.Msg.Messages[0].Attachments; len(a) != 1 || !a[0].Expired || a[0].Name != "" || a[0].Size == 0 {
		t.Errorf("expired attachment on the message: %v", a)
	}
	reply, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "that one", ReplyToMessageId: sent.Msg.Message.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if got := reply.Msg.Message.ReplyTo.GetPreview(); got != "📎 Expired attachment" {
		t.Errorf("reply quote = %q", got)
	}
	if _, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, AttachmentIds: []string{pending}})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("attaching an expired upload: want invalid_argument, got %v", err)
	}
}
