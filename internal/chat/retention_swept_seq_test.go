package chat_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// sweptSeq reads what the sweep recorded as the highest seq it removed.
func sweptSeq(t *testing.T, pool *pgxpool.Pool, channelID string) int64 {
	t.Helper()
	var seq int64
	if err := pool.QueryRow(context.Background(), `SELECT swept_seq FROM channels WHERE id = $1`, channelID).Scan(&seq); err != nil {
		t.Fatal(err)
	}
	return seq
}

// The sweep removes tombstones with everything else past the cutoff, and
// records per channel the highest seq it removed: never lower than
// before, untouched in a channel the batch did not reach, unmoved by a
// row no binary stamped.
func TestSweepRecordsSweptSeq(t *testing.T) {
	pool, _, svc := newTestService(t)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, porch := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	gardenChannel, err := svc.CreateChannel(casey, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "garden"}))
	if err != nil {
		t.Fatal(err)
	}
	garden := gardenChannel.Msg.Channel.Id
	send := func(channelID, content, threadRoot string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content, ThreadRootId: threadRoot}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	remove := func(id string) {
		t.Helper()
		if _, err := svc.DeleteMessage(casey, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
			t.Fatal(err)
		}
	}

	// The porch: an old root with a reply, both deleted (two tombstones),
	// then an old message that stays live. The garden: one old message.
	root := send(porch, "old root", "")
	reply := send(porch, "its reply", root.Id)
	remove(reply.Id)
	remove(root.Id)
	live := send(porch, "still here", "")
	gardenOld := send(garden, "in the garden", "")
	cutoff := time.Now()
	time.Sleep(20 * time.Millisecond)
	porchNew := send(porch, "after the cutoff", "")
	gardenNew := send(garden, "also after", "")
	later := cutoff.Add(30 * 24 * time.Hour)
	svc.UseInstancePolicy(retentionPolicy(30))

	// Tombstones are rows past the cutoff like any other.
	if count, err := svc.CountExpiredMessages(context.Background(), later, 30); err != nil || count != 4 {
		t.Errorf("count = %d %v, want 4 (two tombstones, the live porch message, the garden one)", count, err)
	}
	// The highest stamp each channel is about to lose: the live porch
	// message's (the last porch write before the cutoff), the garden's old
	// message's.
	porchHighest, gardenHighest := messageSeq(t, pool, live.Id), messageSeq(t, pool, gardenOld.Id)
	swept, err := svc.SweepMessages(context.Background(), later)
	if err != nil || swept != 4 {
		t.Fatalf("swept = %d %v, want 4", swept, err)
	}
	var left int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE id = ANY($1::uuid[])`, []string{root.Id, reply.Id, live.Id, gardenOld.Id}).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d of the expired rows are still there", left)
	}
	if got := sweptSeq(t, pool, porch); got != porchHighest {
		t.Errorf("porch swept_seq = %d, want %d", got, porchHighest)
	}
	if got := sweptSeq(t, pool, garden); got != gardenHighest {
		t.Errorf("garden swept_seq = %d, want %d", got, gardenHighest)
	}
	if got, seq := sweptSeq(t, pool, porch), channelSeq(t, pool, porch); got > seq {
		t.Errorf("porch swept_seq %d is past its seq %d", got, seq)
	}
	for _, message := range []*chatv1.Message{porchNew, gardenNew} {
		if messageSeq(t, pool, message.Id) != message.Seq {
			t.Errorf("a row after the cutoff lost its stamp")
		}
	}

	// Later, every row goes. The porch's was written by an older binary
	// (no stamp) and its recorded value stands higher than any stamp, so
	// it stays as it is; the garden's rises to its newest row's stamp.
	if _, err := pool.Exec(context.Background(), `UPDATE messages SET seq = NULL WHERE id = $1`, porchNew.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE channels SET swept_seq = 100 WHERE id = $1`, porch); err != nil {
		t.Fatal(err)
	}
	gardenBefore := sweptSeq(t, pool, garden)
	if swept, err := svc.SweepMessages(context.Background(), time.Now().Add(30*24*time.Hour)); err != nil || swept != 2 {
		t.Fatalf("second sweep = %d %v, want 2", swept, err)
	}
	if got := sweptSeq(t, pool, porch); got != 100 {
		t.Errorf("porch swept_seq after removing an unstamped row = %d, want 100 (unchanged)", got)
	}
	if got := sweptSeq(t, pool, garden); got != gardenNew.Seq || got <= gardenBefore {
		t.Errorf("garden swept_seq = %d, want the newer row's stamp %d (above %d)", got, gardenNew.Seq, gardenBefore)
	}
}
