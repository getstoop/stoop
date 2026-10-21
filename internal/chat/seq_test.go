package chat_test

import (
	"context"
	"slices"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
)

// channelSeq reads a channel's log counter.
func channelSeq(t *testing.T, pool *pgxpool.Pool, channelID string) int64 {
	t.Helper()
	var seq int64
	if err := pool.QueryRow(context.Background(), `SELECT seq FROM channels WHERE id = $1`, channelID).Scan(&seq); err != nil {
		t.Fatal(err)
	}
	return seq
}

// messageSeq reads the position a row was last stamped with.
func messageSeq(t *testing.T, pool *pgxpool.Pool, messageID string) int64 {
	t.Helper()
	var seq *int64
	if err := pool.QueryRow(context.Background(), `SELECT seq FROM messages WHERE id = $1`, messageID).Scan(&seq); err != nil {
		t.Fatal(err)
	}
	if seq == nil {
		t.Fatalf("message %s has no seq", messageID)
	}
	return *seq
}

// Every write that changes how a message renders takes the channel's next
// seq and stamps the row with it; a write that changes nothing takes none
// (docs/proposals/channel-log.md).
func TestChannelLogStampsEveryWrite(t *testing.T) {
	pool, _, svc := newTestService(t)
	svc.UseUnfurler(&fakeUnfurler{fetches: map[string]int{}}, &fakePreviewImages{pool: pool}, chat.UnfurlOptions{Inline: true})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	channelID := sp.Msg.DefaultChannel.Id
	send := func(req *chatv1.SendMessageRequest) *chatv1.Message {
		t.Helper()
		req.ChannelId = channelID
		res, err := svc.SendMessage(owner, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("send %q: %v", req.Content, err)
		}
		return res.Msg.Message
	}
	remove := func(id string) {
		t.Helper()
		if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
			t.Fatalf("delete: %v", err)
		}
	}

	// expect checks that the counter moved by bumps since the last step and
	// that each row named was stamped with one of the new values, no two
	// alike; a step's values then lie above every earlier step's.
	last := channelSeq(t, pool, channelID)
	if last != 0 {
		t.Fatalf("a new channel's seq is %d, want 0", last)
	}
	var seen []int64
	expect := func(step string, bumps int64, rows ...string) {
		t.Helper()
		now := channelSeq(t, pool, channelID)
		if now != last+bumps {
			t.Fatalf("%s: channel seq moved %d → %d, want %d", step, last, now, last+bumps)
		}
		var stamped []int64
		for _, id := range rows {
			seq := messageSeq(t, pool, id)
			if seq <= last || seq > now {
				t.Fatalf("%s: row %s stamped %d, want in (%d, %d]", step, id, seq, last, now)
			}
			if slices.Contains(stamped, seq) {
				t.Fatalf("%s: two rows stamped %d", step, seq)
			}
			stamped = append(stamped, seq)
		}
		slices.Sort(stamped)
		seen = append(seen, stamped...)
		last = now
	}

	first := send(&chatv1.SendMessageRequest{Content: "first"})
	expect("send", 1, first.Id)
	if first.Seq != 1 {
		t.Errorf("the first send answered seq %d, want 1", first.Seq)
	}
	second := send(&chatv1.SendMessageRequest{Content: "second"})
	expect("send", 1, second.Id)
	if second.Seq != 2 {
		t.Errorf("the second send answered seq %d, want 2", second.Seq)
	}

	edited, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: first.Id, Content: "first, edited"}))
	if err != nil {
		t.Fatal(err)
	}
	expect("edit", 1, first.Id)
	if edited.Msg.Message.Seq != last {
		t.Errorf("edit answered seq %d, want %d", edited.Msg.Message.Seq, last)
	}

	reacted, err := svc.ToggleReaction(owner, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: second.Id, Emoji: "👍"}))
	if err != nil {
		t.Fatal(err)
	}
	expect("reaction", 1, second.Id)
	if reacted.Msg.Message.Seq != last {
		t.Errorf("reaction answered seq %d, want %d", reacted.Msg.Message.Seq, last)
	}

	pinned, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: first.Id, Pinned: true}))
	if err != nil {
		t.Fatal(err)
	}
	expect("pin", 1, first.Id)
	if pinned.Msg.Pin.Message.Seq != last {
		t.Errorf("pin answered seq %d, want %d", pinned.Msg.Pin.Message.Seq, last)
	}
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: first.Id, Pinned: true})); err != nil {
		t.Fatal(err)
	}
	expect("pin again", 0)
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: first.Id, Pinned: false})); err != nil {
		t.Fatal(err)
	}
	expect("unpin", 1, first.Id)
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: first.Id, Pinned: false})); err != nil {
		t.Fatal(err)
	}
	expect("unpin again", 0)

	// The send stamps the row, and the preview arriving (inline here)
	// stamps it again: the send's answer carries the first position, the
	// MessageUpdated that follows the second.
	linked := send(&chatv1.SendMessageRequest{Content: "https://example.com/article"})
	expect("send with preview", 2, linked.Id)
	if linked.Seq != last-1 {
		t.Errorf("send with a link answered seq %d, want %d", linked.Seq, last-1)
	}
	if _, err := svc.DismissLinkPreview(owner, connect.NewRequest(&chatv1.DismissLinkPreviewRequest{MessageId: linked.Id, Url: "https://example.com/article"})); err != nil {
		t.Fatal(err)
	}
	expect("dismiss preview", 1, linked.Id)
	if _, err := svc.DismissLinkPreview(owner, connect.NewRequest(&chatv1.DismissLinkPreviewRequest{MessageId: linked.Id, Url: "https://example.com/other"})); code(err) != connect.CodeNotFound {
		t.Fatalf("dismissing a link the message lacks: %v, want NotFound", err)
	}
	expect("dismiss nothing", 0)

	// A reply stamps itself and its root, whose summary changed.
	reply := send(&chatv1.SendMessageRequest{Content: "in the thread", ThreadRootId: first.Id})
	expect("reply", 2, reply.Id, first.Id)
	if reply.Seq != last-1 || messageSeq(t, pool, first.Id) != last {
		t.Errorf("reply stamped %d and root %d, want %d and %d", reply.Seq, messageSeq(t, pool, first.Id), last-1, last)
	}
	alsoSent := send(&chatv1.SendMessageRequest{Content: "also in the channel", ThreadRootId: first.Id, AlsoSendToChannel: true})
	expect("reply also sent to the channel", 2, alsoSent.Id, first.Id)

	// Every delete is a tombstone, stamped like any other write. Deleting
	// a reply stamps it and the root, whose summary changed.
	remove(reply.Id)
	expect("delete reply", 2, reply.Id, first.Id)
	// A root with replies left is kept as a placeholder, and stamped.
	remove(first.Id)
	expect("delete root to placeholder", 1, first.Id)
	// The last reply takes the placeholder with it: both are stamped.
	remove(alsoSent.Id)
	expect("delete last reply under a placeholder", 2, alsoSent.Id, first.Id)
	// A top-level message with no replies is one tombstone.
	remove(second.Id)
	expect("delete top-level", 1, second.Id)

	root := send(&chatv1.SendMessageRequest{Content: "a thread to moderate"})
	expect("send", 1, root.Id)
	threadReply := send(&chatv1.SendMessageRequest{Content: "its reply", ThreadRootId: root.Id})
	expect("reply", 2, root.Id)
	if _, err := svc.DeleteThread(owner, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}
	// Delete thread stamps every row it tombstones.
	expect("delete thread", 2, threadReply.Id, root.Id)

	// The page says where the channel's log stood, and every row is at or
	// below it.
	page, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	if page.Msg.ChannelSeq != last {
		t.Errorf("channel_seq = %d, want %d", page.Msg.ChannelSeq, last)
	}
	if len(page.Msg.Messages) != 1 || page.Msg.Messages[0].Id != linked.Id {
		t.Fatalf("page holds %d messages, want only the linked one", len(page.Msg.Messages))
	}
	for _, message := range page.Msg.Messages {
		if message.Seq <= 0 || message.Seq > page.Msg.ChannelSeq {
			t.Errorf("row %s carries seq %d, want in (0, %d]", message.Id, message.Seq, page.Msg.ChannelSeq)
		}
	}

	// Across every kind of write, positions only went up.
	for i := 1; i < len(seen); i++ {
		if seen[i] <= seen[i-1] {
			t.Fatalf("stamped positions are not strictly increasing: %v", seen)
		}
	}
}

// Sends racing for one channel queue on its row: each gets its own
// position, and together they take consecutive ones.
func TestChannelLogSerialisesConcurrentSends(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	channelID := sp.Msg.DefaultChannel.Id

	const sends = 4
	seqs := make([]int64, sends)
	errs := make([]error, sends)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for index := range sends {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "go"}))
			if err != nil {
				errs[index] = err
				return
			}
			seqs[index] = res.Msg.Message.Seq
		}()
	}
	close(start)
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	slices.Sort(seqs)
	if want := []int64{1, 2, 3, 4}; !slices.Equal(seqs, want) {
		t.Errorf("concurrent sends took seqs %v, want %v", seqs, want)
	}
	if got := channelSeq(t, pool, channelID); got != sends {
		t.Errorf("channel seq after %d sends = %d", sends, got)
	}
}
