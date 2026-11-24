package chat

import (
	"context"
	"reflect"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// Pinning a message records a system row about it: docs/architecture/
// messaging.md → System messages.

func (f *systemRows) setPinned(actor context.Context, messageID string, pinned bool) error {
	f.t.Helper()
	_, err := f.svc.SetMessagePinned(actor, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: messageID, Pinned: pinned}))
	return err
}

// pinRowsIn are channelID's pin rows in seq order: who pinned, and what.
func (f *systemRows) pinRowsIn(channelID string) [][2]string {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT author_id, COALESCE(reference_message_id::text, '') FROM messages
		 WHERE channel_id = $1 AND kind = $2 ORDER BY seq`, channelID, kindMessagePinned)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var row [2]string
		if err := rows.Scan(&row[0], &row[1]); err != nil {
			f.t.Fatal(err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		f.t.Fatal(err)
	}
	return out
}

// Pinning writes one row by the pinner about the message; pinning it
// again and unpinning it write none, and the row outlives the pin.
func TestPinRecordsOneRow(t *testing.T) {
	fixture := newSystemRows(t)
	adaID := authctx.UserID(fixture.ada)
	message := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "house rules"})
	if err := fixture.setPinned(fixture.ada, message.Id, true); err != nil {
		t.Fatal(err)
	}
	want := [][2]string{{adaID, message.Id}}
	if got := fixture.pinRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
		t.Fatalf("rows after the pin = %v, want %v", got, want)
	}
	if got := fixture.systemRowsIn(fixture.channel.ID); len(got) != 1 {
		t.Errorf("system rows = %+v, want the pin row alone", got)
	}

	seq := fixture.channelRow(fixture.channel.ID).Seq
	if err := fixture.setPinned(fixture.ada, message.Id, true); err != nil {
		t.Fatal(err)
	}
	if got := fixture.channelRow(fixture.channel.ID).Seq; got != seq {
		t.Errorf("pinning a pinned message moved the channel seq from %d to %d", seq, got)
	}
	if err := fixture.setPinned(fixture.ada, message.Id, false); err != nil {
		t.Fatal(err)
	}
	if err := fixture.setPinned(fixture.ada, message.Id, false); err != nil {
		t.Fatal(err)
	}
	if got := fixture.pinRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
		t.Errorf("rows after re-pinning and unpinning = %v, want %v", got, want)
	}

	listed := fixture.listed(fixture.cat)
	if len(listed) != 2 {
		t.Fatalf("listed %d rows, want the message and the pin row", len(listed))
	}
	row := listed[1]
	if row.Event.GetPin() == nil || !row.Quiet || row.Author.GetId() != adaID ||
		row.Reference.GetMessageId() != message.Id || row.Reference.GetPreview() != "house rules" ||
		row.Reference.GetAuthor().GetId() != authctx.UserID(fixture.bea) {
		t.Errorf("pin row after the unpin = %v, want ada's pin of bea's message, excerpt kept", row)
	}

	// Pinned again after an unpin is a new pin, and a new row.
	if err := fixture.setPinned(fixture.ada, message.Id, true); err != nil {
		t.Fatal(err)
	}
	if got := fixture.pinRowsIn(fixture.channel.ID); len(got) != 2 {
		t.Errorf("rows after pinning again = %v, want two", got)
	}
}

// A refused pin writes nothing: a member without the permission, a reply
// in a thread, a deleted message, a system row.
func TestRefusedPinRecordsNothing(t *testing.T) {
	fixture := newSystemRows(t)
	root := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "who has the key?"})
	reply := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "I do", ThreadRootId: root.Id})
	gone := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "oops"})
	if _, err := fixture.svc.DeleteMessage(fixture.bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: gone.Id})); err != nil {
		t.Fatal(err)
	}
	renamed := fixture.record(fixture.ada, fixture.channel, channelRenamed{OldName: "general", NewName: "porch"})
	seq := fixture.channelRow(fixture.channel.ID).Seq

	attempts := []struct {
		name      string
		actor     context.Context
		messageID string
	}{
		{"a member", fixture.bea, root.Id},
		{"a reply in a thread", fixture.ada, reply.Id},
		{"a deleted message", fixture.ada, gone.Id},
		{"a system row", fixture.ada, renamed.ID},
	}
	for _, attempt := range attempts {
		if err := fixture.setPinned(attempt.actor, attempt.messageID, true); err == nil {
			t.Errorf("%s: pinned", attempt.name)
		}
	}
	if got := fixture.pinRowsIn(fixture.channel.ID); len(got) != 0 {
		t.Errorf("rows after refused pins = %v, want none", got)
	}
	if got := fixture.channelRow(fixture.channel.ID).Seq; got != seq {
		t.Errorf("refused pins moved the channel seq from %d to %d", seq, got)
	}
}

// A pin changes nothing a reader is told: not the unread count, the
// channel's last message, the space's unread mark or the alert counts,
// for the person whose message it is or anyone else.
func TestPinMarksNothingUnread(t *testing.T) {
	fixture := newSystemRows(t)
	message := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "house rules"})
	readers := map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea, "cat": fixture.cat}
	before := map[string]readerState{}
	for name, reader := range readers {
		before[name] = fixture.state(reader)
	}
	if before["cat"].unread != 1 || before["bea"] != (readerState{lastMessageID: message.Id}) {
		t.Fatalf("before = %+v, want cat with one unread and bea with none", before)
	}
	if err := fixture.setPinned(fixture.ada, message.Id, true); err != nil {
		t.Fatal(err)
	}
	for name, reader := range readers {
		if got := fixture.state(reader); got != before[name] {
			t.Errorf("%s after the pin = %+v, want %+v as before", name, got, before[name])
		}
	}
}

// pinEvent is one event a subscription received: its payload kind and seq.
type pinEvent struct {
	kind string
	seq  int64
}

// heardPins is what a subscription receives within a moment, the created
// messages kept.
func heardPins(t *testing.T, sub *events.Subscription) ([]pinEvent, []*chatv1.Message) {
	t.Helper()
	var got []pinEvent
	var created []*chatv1.Message
	for {
		select {
		case event := <-sub.Events():
			switch payload := event.Payload.(type) {
			case *realtimev1.ServerEvent_MessagePinned:
				got = append(got, pinEvent{"message_pinned", payload.MessagePinned.Seq})
			case *realtimev1.ServerEvent_MessageCreated:
				got = append(got, pinEvent{"message_created", payload.MessageCreated.Seq})
				created = append(created, payload.MessageCreated)
			default:
				got = append(got, pinEvent{"other", 0})
			}
		case <-time.After(300 * time.Millisecond):
			return got, created
		}
	}
}

// The pin goes out before its row, in seq order, and only to those who
// may read the channel.
func TestPinIsPublishedInSeqOrder(t *testing.T) {
	fixture := newSystemRows(t)
	bus := fixture.svc.bus.(*events.InProcBus)
	if _, err := fixture.pool.Exec(context.Background(), "UPDATE channels SET private = true WHERE id = $1", fixture.channel.ID); err != nil {
		t.Fatal(err)
	}
	for _, member := range []context.Context{fixture.ada, fixture.bea} {
		if _, err := fixture.pool.Exec(context.Background(),
			"INSERT INTO channel_members (channel_id, space_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
			fixture.channel.ID, fixture.spaceID, authctx.UserID(member)); err != nil {
			t.Fatal(err)
		}
	}
	message := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "house rules"})
	space := bus.Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()
	bea := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.bea)))
	defer bea.Close()
	cat := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.cat)))
	defer cat.Close()

	if err := fixture.setPinned(fixture.ada, message.Id, true); err != nil {
		t.Fatal(err)
	}
	got, created := heardPins(t, bea)
	if len(got) != 2 || got[0].kind != "message_pinned" || got[1].kind != "message_created" {
		t.Fatalf("bea heard %v, want the pin and then its row", got)
	}
	if got[1].seq != got[0].seq+1 {
		t.Errorf("seqs = %d then %d, want the row next after the pin", got[0].seq, got[1].seq)
	}
	if row := created[0]; row.Event.GetPin() == nil || !row.Quiet || row.Author.GetUsername() != "ada" ||
		row.Reference.GetMessageId() != message.Id || row.Reference.GetPreview() != "house rules" {
		t.Errorf("published row = %v, want ada's quiet pin row with the excerpt", row)
	}
	if listed := fixture.load(created[0].Id); !proto.Equal(created[0], listed) {
		t.Errorf("published %v, read back %v", created[0], listed)
	}
	for name, sub := range map[string]*events.Subscription{"cat": cat, "the space": space} {
		if heard, _ := heardPins(t, sub); len(heard) != 0 {
			t.Errorf("%s, outside the private channel, heard %v", name, heard)
		}
	}
}

// Deleting the pinned message leaves the row with the message's id and no
// excerpt; the retention sweep taking it for good leaves no reference.
func TestPinRowOutlivesItsMessage(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.svc.UseInstancePolicy(fixedRetention(30))
	// The sweep goes by the id's time, so the message to sweep is written
	// with an id from before the retention period.
	sweptID := cutoffID(time.Now().AddDate(0, 0, -40))
	if _, err := fixture.pool.Exec(context.Background(),
		`WITH next AS (UPDATE channels SET seq = seq + 1 WHERE id = $1 RETURNING seq)
		 INSERT INTO messages (id, channel_id, author_id, content, seq) SELECT $2, $1, $3, 'old news', next.seq FROM next`,
		fixture.channel.ID, sweptID, authctx.UserID(fixture.bea)); err != nil {
		t.Fatal(err)
	}
	deleted := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "house rules"})
	for _, id := range []string{sweptID, deleted.Id} {
		if err := fixture.setPinned(fixture.ada, id, true); err != nil {
			t.Fatal(err)
		}
	}
	rows := fixture.listed(fixture.cat)
	if len(rows) != 4 {
		t.Fatalf("listed %d rows, want two messages and two pin rows", len(rows))
	}
	aboutSwept, aboutDeleted := rows[2].Id, rows[3].Id
	if rows[2].Reference.GetMessageId() != sweptID || rows[3].Reference.GetMessageId() != deleted.Id {
		t.Fatalf("pin rows refer to %v and %v", rows[2].Reference, rows[3].Reference)
	}

	if _, err := fixture.svc.DeleteMessage(fixture.bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: deleted.Id})); err != nil {
		t.Fatal(err)
	}
	if row := fixture.load(aboutDeleted); row.Event.GetPin() == nil || row.Reference.GetMessageId() != deleted.Id ||
		row.Reference.GetPreview() != "" || row.Reference.GetAuthor() != nil {
		t.Errorf("row about a deleted message = %v, want the id alone", row)
	}

	// The sweep keeps pinned messages, so the old one is unpinned first.
	if err := fixture.setPinned(fixture.ada, sweptID, false); err != nil {
		t.Fatal(err)
	}
	if removed, err := fixture.svc.SweepMessages(context.Background(), time.Now()); err != nil || removed != 1 {
		t.Fatalf("sweep = %d, %v; want the old message alone", removed, err)
	}
	if row := fixture.load(aboutSwept); row.Event.GetPin() == nil || row.Reference != nil {
		t.Errorf("row about a swept message = %v, want no reference", row)
	}
}
