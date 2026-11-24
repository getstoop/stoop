package chat

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// Deleting a poll and its closing row (docs/architecture/messaging.md →
// Polls). Who may delete either is TestDeletingAPoll.

func (f *systemRows) remove(person context.Context, messageID string) error {
	_, err := f.svc.DeleteMessage(person, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: messageID}))
	return err
}

// liveRowsAbout are the live rows that refer to a message, oldest first.
func (f *systemRows) liveRowsAbout(messageID string) []string {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT id::text FROM messages WHERE reference_message_id = $1 AND deleted_at IS NULL ORDER BY id`, messageID)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			f.t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		f.t.Fatal(err)
	}
	return ids
}

// Deleting a closed, pinned poll takes its votes, its pin, its pin rows
// and its closing row in one go: the poll's delete is published first
// and then each row's, oldest first, on consecutive seqs. Another poll
// and its rows are untouched, and the channel's last message and unread
// count are read again, since a closing row counted in both.
func TestDeletedPollTakesItsRows(t *testing.T) {
	fixture := newSystemRows(t)
	spared := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: "Snacks?", Options: yesNo})
	fixture.voted(fixture.bea, spared.Id, 1)
	if err := fixture.setPinned(fixture.ada, spared.Id, true); err != nil {
		t.Fatal(err)
	}
	sparedClosing := fixture.closing(fixture.cat, spared)
	fixture.markRead(fixture.bea, fixture.channel.ID)

	poll := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: "Secret plans?", Options: yesNo, Multiple: true})
	fixture.voted(fixture.bea, poll.Id, 1, 2)
	fixture.voted(fixture.ada, poll.Id, 2)
	// A pin row either side of the closing row, so the rows about the poll
	// are of two kinds, interleaved.
	if err := fixture.setPinned(fixture.ada, poll.Id, true); err != nil {
		t.Fatal(err)
	}
	closing := fixture.closing(fixture.cat, poll)
	for _, pinned := range []bool{false, true} {
		if err := fixture.setPinned(fixture.ada, poll.Id, pinned); err != nil {
			t.Fatal(err)
		}
	}
	about := fixture.liveRowsAbout(poll.Id)
	if len(about) != 3 || about[1] != closing.ID {
		t.Fatalf("rows about the poll = %v, want a pin row, the closing row %s and a pin row", about, closing.ID)
	}
	if got := fixture.state(fixture.bea); got.unread != 2 || got.lastMessageID != closing.ID {
		t.Fatalf("bea before the delete = %+v, want the poll and its closing row unread", got)
	}
	space := fixture.subscribeSpace()
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq

	if err := fixture.remove(fixture.cat, poll.Id); err != nil {
		t.Fatal(err)
	}

	if left, others := fixture.votesOn(poll.Id), fixture.votesOn(spared.Id); left != 0 || others != 1 {
		t.Errorf("after the delete: %d votes on the poll, %d on another; want 0 and 1", left, others)
	}
	if left := fixture.liveRowsAbout(poll.Id); len(left) != 0 {
		t.Errorf("live rows still about the poll: %v", left)
	}
	// A tombstone keeps nothing of the outcome.
	var data string
	if err := fixture.pool.QueryRow(context.Background(), `SELECT data::text FROM messages WHERE id = $1`, closing.ID).Scan(&data); err != nil {
		t.Fatal(err)
	}
	if data != "{}" {
		t.Errorf("the closing row's tombstone holds %s, want {}", data)
	}
	listed := messageIDs(fixture.listed(fixture.bea))
	if len(listed) != 3 || listed[0] != spared.Id || listed[2] != sparedClosing.ID {
		t.Errorf("history after the delete = %v, want the other poll, its pin row and its closing row", listed)
	}
	pins, err := fixture.svc.ListPinnedMessages(fixture.bea, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{ChannelId: fixture.channel.ID}))
	if err != nil {
		t.Fatal(err)
	}
	if len(pins.Msg.Pins) != 1 || pins.Msg.Pins[0].Message.Id != spared.Id {
		t.Errorf("pins after the delete = %v, want the other poll alone", pins.Msg.Pins)
	}

	heard := heardRows(space)
	wantIDs := append([]string{poll.Id}, about...)
	if len(heard) != len(wantIDs) {
		t.Fatalf("heard %+v, want a delete for the poll and each of %v", heard, about)
	}
	for index, want := range wantIDs {
		if heard[index].kind != "message_deleted" || heard[index].id != want || heard[index].seq != channelSeq+int64(index)+1 {
			t.Errorf("event %d = %+v, want message_deleted for %s at seq %d", index, heard[index], want, channelSeq+int64(index)+1)
		}
	}
	if got, want := fixture.state(fixture.bea), (readerState{lastMessageID: sparedClosing.ID}); got != want {
		t.Errorf("bea after the delete = %+v, want %+v", got, want)
	}

	// The change log carries all four as deleted, with nothing of them.
	changes, err := fixture.svc.ListChanges(fixture.bea, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: fixture.channel.ID, SinceSeq: channelSeq}))
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(changes.Msg.Messages); !slices.Equal(got, wantIDs) {
		t.Errorf("ListChanges = %v, want %v", got, wantIDs)
	}
	for _, row := range changes.Msg.Messages {
		if !row.Deleted || row.Content != "" || row.Reference != nil || row.Event.GetPollClosed().GetQuestion() != "" || len(row.Event.GetPoll().GetOptions()) != 0 {
			t.Errorf("a deleted row still carries something: %v", row)
		}
	}
}

// A moderator's delete of the closing row alone leaves the poll closed:
// no vote, no second close, and the channel's last message goes back to
// what is left. The poll is deleted afterwards as any other.
func TestDeletingAClosingRowLeavesThePollClosed(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	fixture.voted(fixture.bea, poll.Id, 1)
	closing := fixture.closing(fixture.cat, poll)
	space := fixture.subscribeSpace()

	if err := fixture.remove(fixture.ada, closing.ID); err != nil {
		t.Fatal(err)
	}
	if heard := heardRows(space); len(heard) != 1 || heard[0].kind != "message_deleted" || heard[0].id != closing.ID {
		t.Errorf("heard %+v, want the closing row's delete alone", heard)
	}
	after := fixture.load(poll.Id)
	if after.Deleted || after.Event.GetPoll().GetClosedAt() == nil || tally(after) != "1:bea 2: of 1" {
		t.Errorf("the poll after its closing row went = %v, want it closed with its vote", after)
	}
	if got := fixture.state(fixture.bea).lastMessageID; got != poll.Id {
		t.Errorf("last message = %s, want the poll %s", got, poll.Id)
	}
	if _, err := fixture.setVote(fixture.bea, poll.Id, 2); !errors.Is(err, errPollClosed) {
		t.Errorf("a vote after the closing row went: err = %v, want it refused as closed", err)
	}
	if _, err := fixture.closePoll(fixture.cat, poll.Id); !errors.Is(err, errPollClosed) {
		t.Errorf("a second close after the closing row went: err = %v, want it refused as closed", err)
	}
	if got := fixture.closingRows(fixture.channel.ID); got != 1 {
		t.Errorf("%d closing rows, want the deleted one alone", got)
	}
	if err := fixture.remove(fixture.cat, poll.Id); err != nil {
		t.Errorf("deleting the poll afterwards: %v", err)
	}
	if heard := heardRows(space); len(heard) != 1 || heard[0].kind != "message_deleted" || heard[0].id != poll.Id {
		t.Errorf("heard %+v, want the poll's delete alone", heard)
	}
}

// In a conversation its author deletes a closed poll, and the closing
// row goes with it, though nobody there could delete that row alone: the
// other person's alert about it goes, and the conversation's last
// message and unread count go back to what is left.
func TestDeletedPollInAConversation(t *testing.T) {
	fixture := newSystemRows(t)
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	before := fixture.send(fixture.bea, &chatv1.SendMessageRequest{ChannelId: conversation.ID, Content: "hello"})
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: "Lunch?", Options: yesNo})
	fixture.voted(fixture.bea, poll.Id, 1)
	closing := fixture.closing(fixture.ada, poll)
	if listed := fixture.listedConversation(fixture.bea, conversation.ID); listed.Channel.UnreadCount != 2 || len(fixture.activity(fixture.bea)) != 1 {
		t.Fatalf("bea before the delete = %v, want two unread and an alert", listed)
	}
	bea := fixture.subscribeUser(fixture.bea)

	if err := fixture.remove(fixture.bea, poll.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("the other person deleting the poll: err = %v, want PermissionDenied", err)
	}
	if err := fixture.remove(fixture.ada, poll.Id); err != nil {
		t.Fatal(err)
	}
	var deleted []string
	for _, heard := range heardRows(bea) {
		if heard.kind == "message_deleted" {
			deleted = append(deleted, heard.id)
		}
	}
	if fmt.Sprint(deleted) != fmt.Sprint([]string{poll.Id, closing.ID}) {
		t.Errorf("bea heard deletes for %v, want the poll and then its closing row", deleted)
	}
	listed := fixture.listedConversation(fixture.bea, conversation.ID)
	if listed.Channel.UnreadCount != 0 || listed.LastMessage.GetMessageId() != before.Id {
		t.Errorf("the conversation after the delete = %v, want nothing unread and bea's message last", listed)
	}
	if items := fixture.activity(fixture.bea); len(items) != 0 {
		t.Errorf("bea still has activity about a deleted poll: %v", items)
	}
	if got := fixture.votesOn(poll.Id); got != 0 {
		t.Errorf("%d votes left on the deleted poll", got)
	}
}
