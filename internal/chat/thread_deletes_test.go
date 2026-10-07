package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
)

// threadSpace is a space owned by ada with bea as a member, and helpers
// to post and read its default channel.
type threadSpace struct {
	t        *testing.T
	svc      *chat.Service
	ada, bea context.Context
	space    string
	channel  string
}

func newThreadSpace(t *testing.T) (*threadSpace, func() int) {
	t.Helper()
	pool, _, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	inv, _ := svc.CreateInvite(ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	rows := func() int {
		var count int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM messages`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	return &threadSpace{t: t, svc: svc, ada: ada, bea: bea, space: sp.Msg.Space.Id, channel: sp.Msg.DefaultChannel.Id}, rows
}

func (ts *threadSpace) send(ctx context.Context, content, threadRoot, quote string) *chatv1.Message {
	ts.t.Helper()
	res, err := ts.svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: ts.channel, Content: content, ThreadRootId: threadRoot, ReplyToMessageId: quote,
	}))
	if err != nil {
		ts.t.Fatalf("send %q: %v", content, err)
	}
	return res.Msg.Message
}

func (ts *threadSpace) channelPage() []*chatv1.Message {
	ts.t.Helper()
	res, err := ts.svc.ListMessages(ts.ada, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: ts.channel}))
	if err != nil {
		ts.t.Fatal(err)
	}
	return res.Msg.Messages
}

func (ts *threadSpace) find(id string) *chatv1.Message {
	ts.t.Helper()
	for _, message := range ts.channelPage() {
		if message.Id == id {
			return message
		}
	}
	return nil
}

func (ts *threadSpace) remove(ctx context.Context, id string) {
	ts.t.Helper()
	if _, err := ts.svc.DeleteMessage(ctx, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
		ts.t.Fatalf("delete %s: %v", id, err)
	}
}

// A root deleted while its thread has replies stays as a placeholder; the
// replies stay; and the last reply's delete takes the placeholder too.
func TestDeletedRootBecomesPlaceholder(t *testing.T) {
	ts, rows := newThreadSpace(t)
	root := ts.send(ts.ada, "ladder? @bea", "", "")
	quote := ts.send(ts.bea, "quoting the root", "", root.Id)
	first := ts.send(ts.bea, "mine", root.Id, "")
	second := ts.send(ts.ada, "thanks", root.Id, "")
	if _, err := ts.svc.ToggleReaction(ts.bea, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: root.Id, Emoji: "👍"})); err != nil {
		t.Fatal(err)
	}

	ts.remove(ts.ada, root.Id)
	placeholder := ts.find(root.Id)
	if placeholder == nil || !placeholder.Deleted || placeholder.Content != "" || len(placeholder.Reactions) != 0 {
		t.Fatalf("placeholder = %+v, want deleted with no content or reactions", placeholder)
	}
	if placeholder.Thread.GetReplyCount() != 2 {
		t.Errorf("placeholder's thread = %+v, want two replies", placeholder.Thread)
	}
	if quoted := ts.find(quote.Id).ReplyTo; quoted.GetAuthor() != nil || quoted.GetPreview() != "" {
		t.Errorf("quote of the placeholder = %+v, want only its id", quoted)
	}
	activity, err := ts.svc.ListActivity(ts.bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range activity.Msg.Items {
		if item.MessageId == root.Id {
			t.Errorf("bea still has activity for the deleted root: %+v", item)
		}
	}

	refused := func(name string, err error) {
		t.Helper()
		if code(err) != connect.CodeFailedPrecondition {
			t.Errorf("%s on a placeholder: want failed_precondition, got %v", name, err)
		}
	}
	_, err = ts.svc.EditMessage(ts.ada, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: root.Id, Content: "back"}))
	refused("edit", err)
	_, err = ts.svc.ToggleReaction(ts.bea, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: root.Id, Emoji: "👍"}))
	refused("react", err)
	_, err = ts.svc.SendMessage(ts.bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: ts.channel, Content: "x", ThreadRootId: root.Id}))
	refused("reply", err)
	_, err = ts.svc.SendMessage(ts.bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: ts.channel, Content: "x", ReplyToMessageId: root.Id}))
	refused("quote", err)

	ts.remove(ts.bea, first.Id)
	if ts.find(root.Id).Thread.GetReplyCount() != 1 {
		t.Errorf("after one reply goes, thread = %+v", ts.find(root.Id).Thread)
	}
	before := rows()
	ts.remove(ts.ada, second.Id)
	if ts.find(root.Id) != nil {
		t.Error("the placeholder outlived its last reply")
	}
	if rows() != before-2 {
		t.Errorf("deleting the last reply removed %d rows, want 2 (reply and placeholder)", before-rows())
	}
}

// Deleting replies recounts the summary, and the last reply under a live
// root leaves a root with no thread; a root with no replies is deleted
// outright.
func TestDeletingRepliesRecounts(t *testing.T) {
	ts, _ := newThreadSpace(t)
	root := ts.send(ts.ada, "root", "", "")
	byBea := ts.send(ts.bea, "one", root.Id, "")
	byAda := ts.send(ts.ada, "two", root.Id, "")

	ts.remove(ts.ada, byAda.Id)
	thread := ts.find(root.Id).Thread
	if thread.GetReplyCount() != 1 || len(thread.GetRecentAuthors()) != 1 || thread.RecentAuthors[0].Username != "bea" {
		t.Errorf("after ada's reply goes, thread = %+v, want one reply by bea", thread)
	}
	ts.remove(ts.bea, byBea.Id)
	if live := ts.find(root.Id); live == nil || live.Deleted || live.Thread != nil {
		t.Errorf("root after its last reply = %+v, want live with no thread", live)
	}

	lone := ts.send(ts.ada, "no replies", "", "")
	ts.remove(ts.ada, lone.Id)
	if ts.find(lone.Id) != nil {
		t.Error("a root with no replies was kept")
	}
}

func TestDeleteThread(t *testing.T) {
	ts, rows := newThreadSpace(t)
	root := ts.send(ts.bea, "root", "", "")
	reply := ts.send(ts.bea, "reply", root.Id, "")
	ts.send(ts.ada, "another", root.Id, "")

	deleteThread := func(ctx context.Context, id string) error {
		_, err := ts.svc.DeleteThread(ctx, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: id}))
		return err
	}
	if err := deleteThread(ts.bea, root.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("member deleting a thread: want permission_denied, got %v", err)
	}
	if err := deleteThread(ts.ada, reply.Id); code(err) != connect.CodeInvalidArgument {
		t.Errorf("deleting a thread by a reply: want invalid_argument, got %v", err)
	}
	if err := deleteThread(ts.ada, root.Id); err != nil {
		t.Fatal(err)
	}
	if left := rows(); left != 0 {
		t.Errorf("%d messages left after Delete thread, want 0", left)
	}
}
