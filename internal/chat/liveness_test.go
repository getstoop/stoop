package chat_test

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
)

// A handler checks its target message before its transaction, and the
// transaction takes the channel row first (seq.go). A delete can commit
// in between, and since a delete is a tombstone no foreign key stops the
// write. These tests open that gap on purpose: beforeLock runs a hook
// just before a transaction's NextChannelSeq, so the delete commits
// after the handler's check and before its lock.

// beforeLock runs the armed hook once, as the next transaction is about
// to take its channel row.
type beforeLock struct {
	mu   sync.Mutex
	hook func()
}

func (gap *beforeLock) arm(hook func()) {
	gap.mu.Lock()
	defer gap.mu.Unlock()
	gap.hook = hook
}

func (gap *beforeLock) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if !strings.Contains(data.SQL, "UPDATE channels SET seq = seq + 1") {
		return ctx
	}
	gap.mu.Lock()
	hook := gap.hook
	gap.hook = nil // the hook's own writes take the channel row too
	gap.mu.Unlock()
	if hook != nil {
		hook()
	}
	return ctx
}

func (gap *beforeLock) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// newGapService is newTestService with the service's pool traced by a
// beforeLock.
func newGapService(t *testing.T) (*pgxpool.Pool, *events.InProcBus, *chat.Service, *beforeLock) {
	t.Helper()
	pool := dbtest.New(t)
	gap := &beforeLock{}
	config := pool.Config()
	config.ConnConfig.Tracer = gap
	traced, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(traced.Close)
	bus := events.NewInProcBus()
	return pool, bus, chat.New(traced, bus, dbDirectory{pool}), gap
}

// threadState is what a root's thread looks like: the channel's seq, its
// summary rows and its live replies.
type threadState struct {
	seq         int64
	summaries   int
	liveReplies int
	pins        int
}

func readThreadState(t *testing.T, pool *pgxpool.Pool, channelID, rootID string) threadState {
	t.Helper()
	var state threadState
	err := pool.QueryRow(context.Background(), `
		SELECT (SELECT seq FROM channels WHERE id = $1),
		    (SELECT count(*) FROM threads WHERE root_message_id = $2),
		    (SELECT count(*) FROM messages WHERE thread_root_id = $2 AND deleted_at IS NULL),
		    (SELECT count(*) FROM channel_pins WHERE message_id = $2)`, channelID, rootID).
		Scan(&state.seq, &state.summaries, &state.liveReplies, &state.pins)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

// A reply whose root was deleted between the send's check and its lock is
// refused as the check refuses it, spends no seq and recreates nothing:
// a hidden root stays hidden, a placeholder keeps its count.
func TestReplyUnderRootDeletedInTheGapIsRefused(t *testing.T) {
	pool, bus, svc, gap := newGapService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	send := func(content, rootID string) (*chatv1.Message, error) {
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content, ThreadRootId: rootID}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	deleteMessage := func(id string) error {
		_, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id}))
		return err
	}
	deleteThread := func(id string) error {
		_, err := svc.DeleteThread(owner, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: id}))
		return err
	}

	for _, tc := range []struct {
		name        string
		withReply   bool
		remove      func(string) error // what commits in the gap
		placeholder bool               // the root is kept, shown deleted
		want        connect.Code
	}{
		{name: "root hidden by its delete", remove: deleteMessage, want: connect.CodeNotFound},
		{name: "root kept as a placeholder", withReply: true, remove: deleteMessage, placeholder: true, want: connect.CodeFailedPrecondition},
		{name: "thread deleted", withReply: true, remove: deleteThread, want: connect.CodeNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, err := send("ladder?", "")
			if err != nil {
				t.Fatal(err)
			}
			if tc.withReply {
				if _, err := send("first", root.Id); err != nil {
					t.Fatal(err)
				}
			}
			eventKinds(sub)
			var afterDelete threadState
			gap.arm(func() {
				if err := tc.remove(root.Id); err != nil {
					t.Errorf("delete in the gap: %v", err)
				}
				afterDelete = readThreadState(t, pool, channelID, root.Id)
			})
			_, err = send("late", root.Id)
			if code(err) != tc.want {
				t.Fatalf("reply under the deleted root: got %v, want %v", err, tc.want)
			}
			if got := readThreadState(t, pool, channelID, root.Id); got != afterDelete {
				t.Errorf("the refused reply changed the thread: %+v, was %+v after the delete", got, afterDelete)
			}
			wantEvents := []string{"message_deleted:" + root.Id + ":" + at(messageSeq(t, pool, root.Id))}
			if tc.placeholder {
				wantEvents = []string{"message_updated:" + root.Id + ":deleted" + at(messageSeq(t, pool, root.Id))}
			}
			if kinds := eventKinds(sub); !slices.Equal(kinds, wantEvents) {
				t.Errorf("events = %v, want the delete's alone %v", kinds, wantEvents)
			}
		})
	}
}

// A pin whose message was deleted between the handler's check and its
// lock is refused as the check refuses it, spends no seq and pins
// nothing, so a tombstone is never kept from the sweep by a pin.
func TestPinOfMessageDeletedInTheGapIsRefused(t *testing.T) {
	pool, bus, svc, gap := newGapService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	send := func(content, rootID string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content, ThreadRootId: rootID}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}

	for _, tc := range []struct {
		name      string
		withReply bool // deleted, the message stays as a placeholder
		want      connect.Code
	}{
		{name: "message hidden by its delete", want: connect.CodeNotFound},
		{name: "root kept as a placeholder", withReply: true, want: connect.CodeFailedPrecondition},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msg := send("pin me", "")
			if tc.withReply {
				send("a reply", msg.Id)
			}
			eventKinds(sub)
			var afterDelete threadState
			gap.arm(func() {
				if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: msg.Id})); err != nil {
					t.Errorf("delete in the gap: %v", err)
				}
				afterDelete = readThreadState(t, pool, channelID, msg.Id)
			})
			_, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: msg.Id, Pinned: true}))
			if code(err) != tc.want {
				t.Fatalf("pinning the deleted message: got %v, want %v", err, tc.want)
			}
			got := readThreadState(t, pool, channelID, msg.Id)
			if got.pins != 0 {
				t.Errorf("the tombstone is pinned")
			}
			if got != afterDelete {
				t.Errorf("the refused pin changed the channel: %+v, was %+v after the delete", got, afterDelete)
			}
			wantEvents := []string{"message_deleted:" + msg.Id + ":" + at(messageSeq(t, pool, msg.Id))}
			if tc.withReply {
				wantEvents = []string{"message_updated:" + msg.Id + ":deleted" + at(messageSeq(t, pool, msg.Id))}
			}
			if kinds := eventKinds(sub); !slices.Equal(kinds, wantEvents) {
				t.Errorf("events = %v, want the delete's alone %v", kinds, wantEvents)
			}
		})
	}
}

// A thread mute lands only on a root that is still shown, and a mute row
// on a hidden root (one that got there in the gap) is listed to nobody.
// A placeholder can still be muted: its thread still runs.
func TestThreadMutesSkipAHiddenRoot(t *testing.T) {
	pool, _, svc := newTestService(t)
	queries := dbgen.New(pool)
	ctx := context.Background()
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
	send := func(author context.Context, content, rootID string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(author, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content, ThreadRootId: rootID}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	remove := func(id string) {
		t.Helper()
		if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
			t.Fatal(err)
		}
	}
	mutesOn := func(rootID string) int {
		t.Helper()
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM thread_mutes WHERE root_message_id = $1`, rootID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	listed := func(person context.Context) []string {
		t.Helper()
		res, err := svc.ListThreadMutes(person, connect.NewRequest(&chatv1.ListThreadMutesRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, len(res.Msg.Threads))
		for index, thread := range res.Msg.Threads {
			ids[index] = thread.Root.Id
		}
		return ids
	}

	hidden := send(owner, "gone", "")
	remove(hidden.Id)
	if err := queries.MuteThread(ctx, dbgen.MuteThreadParams{UserID: authctx.UserID(bea), RootMessageID: hidden.Id}); err != nil {
		t.Fatal(err)
	}
	if got := mutesOn(hidden.Id); got != 0 {
		t.Errorf("muting a hidden root wrote %d rows", got)
	}
	// A row that got there anyway is shown to nobody.
	if _, err := pool.Exec(ctx, `INSERT INTO thread_mutes (user_id, root_message_id) VALUES ($1, $2)`, authctx.UserID(bea), hidden.Id); err != nil {
		t.Fatal(err)
	}
	if got := listed(bea); len(got) != 0 {
		t.Errorf("ListThreadMutes lists the hidden root: %v", got)
	}

	placeholder := send(owner, "kept", "")
	send(bea, "a reply", placeholder.Id)
	remove(placeholder.Id)
	if _, err := svc.SetThreadMuted(bea, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: placeholder.Id, Muted: true})); err != nil {
		t.Fatalf("muting a placeholder: %v", err)
	}
	if got := mutesOn(placeholder.Id); got != 1 {
		t.Errorf("muting a placeholder wrote %d rows, want 1", got)
	}
	if got := listed(bea); !slices.Equal(got, []string{placeholder.Id}) {
		t.Errorf("ListThreadMutes = %v, want the placeholder alone", got)
	}
}

// Activity is recorded after a send commits, so its message can be a
// tombstone by then: neither insert writes an item for one, and an
// unread item is not refreshed to point at one.
func TestActivityItemsAreNotWrittenForATombstone(t *testing.T) {
	pool, _, svc := newTestService(t)
	queries := dbgen.New(pool)
	ctx := context.Background()
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	send := func(content string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	live := send("still here")
	gone := send("deleted meanwhile")
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: gone.Id})); err != nil {
		t.Fatal(err)
	}
	recipients := []string{authctx.UserID(bea)}
	itemsFor := func(person context.Context) (count int, messageID string) {
		t.Helper()
		err := pool.QueryRow(ctx, `SELECT count(*), COALESCE(min(message_id::text), '') FROM activity_items WHERE user_id = $1`, authctx.UserID(person)).Scan(&count, &messageID)
		if err != nil {
			t.Fatal(err)
		}
		return count, messageID
	}

	items, err := queries.CreateActivityItems(ctx, dbgen.CreateActivityItemsParams{
		Ids: []string{rowid.New()}, UserIds: recipients, Kind: "mention", SpaceID: &spaceID,
		ChannelID: channelID, MessageID: gone.Id, ActorID: authctx.UserID(owner),
	})
	if err != nil || len(items) != 0 {
		t.Errorf("CreateActivityItems for a tombstone = %v, %v; want nothing", items, err)
	}
	if count, _ := itemsFor(bea); count != 0 {
		t.Errorf("bea has %d items after the refused create", count)
	}

	upsert := func(messageID string) []dbgen.UpsertUnreadActivityItemsRow {
		t.Helper()
		rows, err := queries.UpsertUnreadActivityItems(ctx, dbgen.UpsertUnreadActivityItemsParams{
			Ids: []string{rowid.New()}, UserIds: recipients, Kind: "dm",
			ChannelID: channelID, MessageID: messageID, ActorID: authctx.UserID(owner),
		})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if rows := upsert(live.Id); len(rows) != 1 {
		t.Fatalf("upsert for a live message wrote %d items, want 1", len(rows))
	}
	if rows := upsert(gone.Id); len(rows) != 0 {
		t.Errorf("upsert for a tombstone refreshed or wrote %d items", len(rows))
	}
	if count, messageID := itemsFor(bea); count != 1 || messageID != live.Id {
		t.Errorf("bea's items after the refused upsert: %d, pointing at %s; want the one about the live message", count, messageID)
	}
	// A recipient with no unread item gets none either.
	if rows, err := queries.UpsertUnreadActivityItems(ctx, dbgen.UpsertUnreadActivityItemsParams{
		Ids: []string{rowid.New()}, UserIds: []string{authctx.UserID(owner)}, Kind: "dm",
		ChannelID: channelID, MessageID: gone.Id, ActorID: authctx.UserID(owner),
	}); err != nil || len(rows) != 0 {
		t.Errorf("upsert for a tombstone with no unread item = %v, %v; want nothing", rows, err)
	}
}
