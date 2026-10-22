package chat_test

import (
	"context"
	"slices"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/events"
)

// at is how eventKinds writes a seq.
func at(seq int64) string {
	return "@" + strconv.FormatInt(seq, 10)
}

// tombstone is what a deleted message's row looks like.
type tombstone struct {
	deletedAt  *time.Time
	content    string
	seq        *int64
	dependents int // rows in the tables a hard delete used to cascade through
}

func readTombstone(t *testing.T, pool *pgxpool.Pool, messageID string) tombstone {
	t.Helper()
	var row tombstone
	err := pool.QueryRow(context.Background(), `
		SELECT m.deleted_at, m.content, m.seq,
		    (SELECT count(*) FROM message_reactions WHERE message_id = m.id)
		  + (SELECT count(*) FROM message_attachments WHERE message_id = m.id)
		  + (SELECT count(*) FROM message_mentions WHERE message_id = m.id)
		  + (SELECT count(*) FROM message_links WHERE message_id = m.id)
		  + (SELECT count(*) FROM channel_pins WHERE message_id = m.id)
		  + (SELECT count(*) FROM activity_items WHERE message_id = m.id)
		FROM messages m WHERE m.id = $1`, messageID).Scan(&row.deletedAt, &row.content, &row.seq, &row.dependents)
	if err != nil {
		t.Fatalf("read %s: %v", messageID, err)
	}
	return row
}

// eventKinds drains what the subscription holds and names each event:
// message_deleted carries the id and root it names, and every message
// event ends in @ and the seq it carries.
func eventKinds(sub *events.Subscription) []string {
	var kinds []string
	for {
		select {
		case ev := <-sub.Events():
			switch payload := ev.Payload.(type) {
			case *realtimev1.ServerEvent_MessageDeleted:
				kinds = append(kinds, "message_deleted:"+payload.MessageDeleted.MessageId+":"+payload.MessageDeleted.ThreadRootId+at(payload.MessageDeleted.Seq))
			case *realtimev1.ServerEvent_MessageUpdated:
				kind := "message_updated:" + payload.MessageUpdated.Id
				if payload.MessageUpdated.Deleted {
					kind += ":deleted"
				}
				kinds = append(kinds, kind+at(payload.MessageUpdated.Seq))
			case *realtimev1.ServerEvent_ThreadChanged:
				kinds = append(kinds, "thread_changed:"+payload.ThreadChanged.RootMessageId+at(payload.ThreadChanged.Seq))
			default:
				kinds = append(kinds, "other")
			}
		default:
			return kinds
		}
	}
}

// Every delete leaves a tombstone: deleted_at set, no text, nothing
// hanging off the row, one seq higher; nobody is shown it, except a root
// kept as the placeholder of a thread with live replies. The events are
// the ones the client expects of today's deletes
// (docs/proposals/channel-log.md, step 3).
func TestDeletesLeaveTombstones(t *testing.T) {
	pool, bus, svc := newTestService(t)
	files := &dbFiles{pool: pool}
	svc.UseFiles(files)
	svc.UseUnfurler(&fakeUnfurler{fetches: map[string]int{}}, &fakePreviewImages{pool: pool}, chat.UnfurlOptions{Inline: true})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()

	send := func(ctx context.Context, req *chatv1.SendMessageRequest) *chatv1.Message {
		t.Helper()
		req.ChannelId = channelID
		res, err := svc.SendMessage(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("send %q: %v", req.Content, err)
		}
		return res.Msg.Message
	}
	remove := func(ctx context.Context, id string) {
		t.Helper()
		if _, err := svc.DeleteMessage(ctx, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
			t.Fatalf("delete %s: %v", id, err)
		}
	}
	page := func(req *chatv1.ListMessagesRequest) (*chatv1.ListMessagesResponse, error) {
		req.ChannelId = channelID
		res, err := svc.ListMessages(owner, connect.NewRequest(req))
		if err != nil {
			return nil, err
		}
		return res.Msg, nil
	}
	find := func(messages []*chatv1.Message, id string) *chatv1.Message {
		for _, message := range messages {
			if message.Id == id {
				return message
			}
		}
		return nil
	}
	lastMessage := func() string {
		t.Helper()
		var last *string
		if err := pool.QueryRow(context.Background(), `SELECT last_message_id FROM channels WHERE id = $1`, channelID).Scan(&last); err != nil {
			t.Fatal(err)
		}
		if last == nil {
			return ""
		}
		return *last
	}
	// stamp is the position a row holds now, as eventKinds writes it.
	stamp := func(id string) string {
		t.Helper()
		return at(messageSeq(t, pool, id))
	}
	// expectTombstone checks the row's shape and that it took the seq
	// right after before.
	expectTombstone := func(what, id string, before int64) tombstone {
		t.Helper()
		row := readTombstone(t, pool, id)
		if row.deletedAt == nil || row.content != "" || row.dependents != 0 {
			t.Errorf("%s: row = deleted_at %v, content %q, %d dependent rows; want a bare tombstone", what, row.deletedAt, row.content, row.dependents)
		}
		if row.seq == nil || *row.seq <= before {
			t.Errorf("%s: stamped %v, want above %d", what, row.seq, before)
		}
		return row
	}

	// A top-level message carrying everything a message can: a file, a
	// mention (and bea's activity item for it), a link with its preview, a reaction
	// and a pin; an earlier message for the channel to fall back to.
	earlier := send(owner, &chatv1.SendMessageRequest{Content: "earlier"})
	photo := newFile(t, pool, owner, spaceID, "attachment", "porch.jpg")
	full := send(owner, &chatv1.SendMessageRequest{
		Content: "tomatoes " + mentionOf(bea) + " https://example.com/article", AttachmentIds: []string{photo},
	})
	if _, err := svc.ToggleReaction(bea, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: full.Id, Emoji: "👍"})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: full.Id, Pinned: true})); err != nil {
		t.Fatal(err)
	}
	if row := readTombstone(t, pool, full.Id); row.dependents != 6 {
		t.Fatalf("the message carries %d dependent rows before its delete, want 6", row.dependents)
	}
	eventKinds(sub)
	before := channelSeq(t, pool, channelID)
	remove(owner, full.Id)
	expectTombstone("full top-level", full.Id, before)
	if got := channelSeq(t, pool, channelID); got != before+1 {
		t.Errorf("channel seq after the delete = %d, want %d", got, before+1)
	}
	if kinds := eventKinds(sub); !slices.Equal(kinds, []string{"message_deleted:" + full.Id + ":" + stamp(full.Id)}) {
		t.Errorf("events after deleting a top-level message: %v", kinds)
	}
	if !slices.Contains(files.deleted, photo) {
		t.Errorf("the attachment's file was not deleted: %v", files.deleted)
	}
	if listed, err := page(&chatv1.ListMessagesRequest{}); err != nil || find(listed.Messages, full.Id) != nil {
		t.Errorf("the tombstone is in the channel page (%v)", err)
	}
	if _, err := page(&chatv1.ListMessagesRequest{AroundId: full.Id}); code(err) != connect.CodeNotFound {
		t.Errorf("around a tombstone: want not_found, got %v", err)
	}
	found, err := svc.SearchMessages(owner, connect.NewRequest(&chatv1.SearchMessagesRequest{
		Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: spaceID}, Query: "tomatoes",
	}))
	if err != nil || len(found.Msg.Messages) != 0 {
		t.Errorf("search finds the tombstone: %v %v", found.Msg.GetMessages(), err)
	}
	pins, err := svc.ListPinnedMessages(owner, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{ChannelId: channelID}))
	if err != nil || len(pins.Msg.Pins) != 0 {
		t.Errorf("the pin survived: %v %v", pins.Msg.GetPins(), err)
	}
	activity, err := svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range activity.Msg.Items {
		if item.MessageId == full.Id {
			t.Errorf("bea still has activity for the deleted message: %+v", item)
		}
	}
	if got := lastMessage(); got != earlier.Id {
		t.Errorf("last_message_id = %q, want the earlier message", got)
	}
	// Acting on it again reads as a message that does not exist.
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: full.Id})); code(err) != connect.CodeNotFound {
		t.Errorf("deleting a tombstone: want not_found, got %v", err)
	}
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: full.Id, Content: "back"})); code(err) != connect.CodeNotFound {
		t.Errorf("editing a tombstone: want not_found, got %v", err)
	}

	// A thread: deleting a reply tombstones it, recounts the summary over
	// the live replies and tells the channel about the reply and the root.
	root := send(owner, &chatv1.SendMessageRequest{Content: "ladder?"})
	byBea := send(bea, &chatv1.SendMessageRequest{Content: "mine", ThreadRootId: root.Id})
	byOwner := send(owner, &chatv1.SendMessageRequest{Content: "thanks", ThreadRootId: root.Id})
	if _, err := svc.SetThreadMuted(bea, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id, Muted: true})); err != nil {
		t.Fatal(err)
	}
	eventKinds(sub)
	before = channelSeq(t, pool, channelID)
	remove(bea, byBea.Id)
	expectTombstone("reply", byBea.Id, before)
	if kinds := eventKinds(sub); !slices.Equal(kinds, []string{"message_deleted:" + byBea.Id + ":" + root.Id + stamp(byBea.Id), "thread_changed:" + root.Id + stamp(root.Id)}) {
		t.Errorf("events after deleting a reply: %v", kinds)
	}
	thread, err := page(&chatv1.ListMessagesRequest{ThreadId: root.Id})
	if err != nil || len(thread.Messages) != 1 || thread.Messages[0].Id != byOwner.Id {
		t.Errorf("thread page after the delete = %v %v, want the owner's reply alone", thread.GetMessages(), err)
	}
	listed, err := page(&chatv1.ListMessagesRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if summary := find(listed.Messages, root.Id).Thread; summary.GetReplyCount() != 1 || len(summary.GetRecentAuthors()) != 1 || summary.RecentAuthors[0].Username != "owner" {
		t.Errorf("root's summary after the delete = %+v, want one reply by owner", summary)
	}
	if _, err := page(&chatv1.ListMessagesRequest{AroundId: byBea.Id}); code(err) != connect.CodeNotFound {
		t.Errorf("around a deleted reply: want not_found, got %v", err)
	}

	// The root with a live reply left is kept as a placeholder, shown in
	// the channel and still opening its thread.
	before = channelSeq(t, pool, channelID)
	remove(owner, root.Id)
	expectTombstone("root with replies", root.Id, before)
	if kinds := eventKinds(sub); !slices.Equal(kinds, []string{"message_updated:" + root.Id + ":deleted" + stamp(root.Id)}) {
		t.Errorf("events after deleting a root with replies: %v", kinds)
	}
	listed, err = page(&chatv1.ListMessagesRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if placeholder := find(listed.Messages, root.Id); placeholder == nil || !placeholder.Deleted || placeholder.Thread.GetReplyCount() != 1 {
		t.Fatalf("placeholder in the channel = %+v, want deleted with one reply", placeholder)
	}
	if thread, err := page(&chatv1.ListMessagesRequest{ThreadId: root.Id}); err != nil || len(thread.Messages) != 1 {
		t.Errorf("the placeholder's thread = %v %v, want its one reply", thread.GetMessages(), err)
	}
	if around, err := page(&chatv1.ListMessagesRequest{AroundId: root.Id}); err != nil || find(around.Messages, root.Id) == nil {
		t.Errorf("around the placeholder: %v %v, want a page holding it", around.GetMessages(), err)
	}
	if got := lastMessage(); got != root.Id {
		t.Errorf("last_message_id with the placeholder newest = %q, want the placeholder as before", got)
	}

	// Pinning a placeholder is refused, as edits and reactions are.
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: root.Id, Pinned: true})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("pinning a placeholder: want failed_precondition, got %v", err)
	}
	// A pin row that got there anyway (a binary from before the refusal)
	// goes when the root is hidden.
	if _, err := pool.Exec(context.Background(), `INSERT INTO channel_pins (message_id, channel_id, pinned_by) VALUES ($1, $2, $3)`, root.Id, channelID, authctx.UserID(owner)); err != nil {
		t.Fatal(err)
	}

	// Its last reply going hides it: both rows are stamped, the channel
	// hears of both, the thread's mute and pin go, and the channel falls
	// back.
	before = channelSeq(t, pool, channelID)
	remove(owner, byOwner.Id)
	replyRow := expectTombstone("last reply under a placeholder", byOwner.Id, before)
	rootRow := readTombstone(t, pool, root.Id)
	if rootRow.seq == nil || *rootRow.seq <= *replyRow.seq {
		t.Errorf("the vanishing placeholder was stamped %v, want above the reply's %d", rootRow.seq, *replyRow.seq)
	}
	if kinds := eventKinds(sub); !slices.Equal(kinds, []string{"message_deleted:" + byOwner.Id + ":" + root.Id + stamp(byOwner.Id), "message_deleted:" + root.Id + ":" + stamp(root.Id)}) {
		t.Errorf("events after deleting the last reply under a placeholder: %v", kinds)
	}
	if listed, err := page(&chatv1.ListMessagesRequest{}); err != nil || find(listed.Messages, root.Id) != nil {
		t.Errorf("the hidden placeholder is in the channel page (%v)", err)
	}
	if _, err := page(&chatv1.ListMessagesRequest{ThreadId: root.Id}); code(err) != connect.CodeNotFound {
		t.Errorf("opening the hidden root's thread: want not_found, got %v", err)
	}
	if _, err := page(&chatv1.ListMessagesRequest{AroundId: root.Id}); code(err) != connect.CodeNotFound {
		t.Errorf("around the hidden root: want not_found, got %v", err)
	}
	var mutes int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM thread_mutes WHERE root_message_id = $1`, root.Id).Scan(&mutes); err != nil {
		t.Fatal(err)
	}
	if mutes != 0 {
		t.Errorf("%d thread mutes survived the thread", mutes)
	}
	if pins, err := svc.ListPinnedMessages(owner, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{ChannelId: channelID})); err != nil || len(pins.Msg.Pins) != 0 {
		t.Errorf("the hidden root is still pinned: %v %v", pins.Msg.GetPins(), err)
	}
	if got := lastMessage(); got != earlier.Id {
		t.Errorf("last_message_id after the thread went = %q, want the earlier message", got)
	}
	// Both tombstones kept their place in the thread.
	var rootRef *string
	if err := pool.QueryRow(context.Background(), `SELECT thread_root_id FROM messages WHERE id = $1`, byOwner.Id).Scan(&rootRef); err != nil {
		t.Fatal(err)
	}
	if rootRef == nil || *rootRef != root.Id {
		t.Errorf("the reply's tombstone lost its root: %v", rootRef)
	}
}

// Delete thread tombstones the root and every live reply in one go, each
// with its own seq, and the channel hears one message_deleted for the root.
func TestDeleteThreadTombstonesEveryRow(t *testing.T) {
	pool, bus, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	send := func(content, threadRoot string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content, ThreadRootId: threadRoot}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	root := send("a thread to moderate", "")
	first := send("one", root.Id)
	second := send("two", root.Id)
	gone := send("three", root.Id)
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: gone.Id})); err != nil {
		t.Fatal(err)
	}
	goneStamp := readTombstone(t, pool, gone.Id).seq
	eventKinds(sub)
	stamp := func(id string) string {
		t.Helper()
		return at(messageSeq(t, pool, id))
	}

	before := channelSeq(t, pool, channelID)
	if _, err := svc.DeleteThread(owner, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}
	if kinds := eventKinds(sub); !slices.Equal(kinds, []string{"message_deleted:" + root.Id + ":" + stamp(root.Id)}) {
		t.Errorf("events after Delete thread: %v", kinds)
	}
	// Three live rows, three new positions, each row its own, the root
	// last; the reply deleted earlier keeps its old stamp.
	if got := channelSeq(t, pool, channelID); got != before+3 {
		t.Errorf("channel seq moved %d → %d, want +3", before, got)
	}
	var stamps []int64
	for _, id := range []string{first.Id, second.Id, root.Id} {
		row := readTombstone(t, pool, id)
		if row.deletedAt == nil || row.content != "" || row.seq == nil || *row.seq <= before {
			t.Errorf("row %s after Delete thread = %+v, want a tombstone stamped above %d", id, row, before)
			continue
		}
		stamps = append(stamps, *row.seq)
	}
	if !slices.IsSorted(stamps) || len(slices.Compact(slices.Clone(stamps))) != len(stamps) {
		t.Errorf("Delete thread stamped %v, want distinct and increasing", stamps)
	}
	if got := readTombstone(t, pool, gone.Id).seq; got == nil || goneStamp == nil || *got != *goneStamp {
		t.Errorf("the reply deleted earlier was stamped again: %v, had %v", got, goneStamp)
	}
	var summaries int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM threads WHERE root_message_id = $1`, root.Id).Scan(&summaries); err != nil {
		t.Fatal(err)
	}
	if summaries != 0 {
		t.Error("the thread summary survived Delete thread")
	}
	if _, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID, ThreadId: root.Id})); code(err) != connect.CodeNotFound {
		t.Errorf("opening the deleted thread: want not_found, got %v", err)
	}
}
