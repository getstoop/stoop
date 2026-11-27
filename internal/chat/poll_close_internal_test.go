package chat

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Closing a poll (docs/architecture/messaging.md → Polls).

func (f *systemRows) closePoll(closer context.Context, pollID string) (*chatv1.Message, error) {
	res, err := f.svc.ClosePoll(closer, connect.NewRequest(&chatv1.ClosePollRequest{MessageId: pollID}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Message, nil
}

// closingRows is how many closing rows, live or not, a poll's channel
// holds.
func (f *systemRows) closingRows(channelID string) int {
	f.t.Helper()
	var count int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM messages WHERE channel_id = $1 AND kind = $2`, channelID, kindPollClosed).Scan(&count); err != nil {
		f.t.Fatal(err)
	}
	return count
}

func (f *systemRows) markRead(reader context.Context, channelID string) {
	f.t.Helper()
	if _, err := f.svc.MarkChannelRead(reader, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID})); err != nil {
		f.t.Fatal(err)
	}
}

// Closing a poll in a channel writes when and by whom into the poll and
// records a closing row by the closer: the outcome as it stood, about
// the poll. The poll is stamped and the row takes the next seq, and they
// are published in that order as a fresh read has them. The row is the
// channel's last message and unread for everyone but the closer; nobody
// is alerted. A closed poll takes no vote and no second close.
func TestClosePollInAChannel(t *testing.T) {
	fixture := newSystemRows(t)
	const question = "What are we playing on Friday?"
	poll := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{
		Question: question, Options: []string{"The co-op campaign", "Racing league", "Nothing"},
	})
	fixture.voted(fixture.ada, poll.Id, 1)
	fixture.voted(fixture.bea, poll.Id, 1)
	fixture.voted(fixture.cat, poll.Id, 2)
	for _, reader := range []context.Context{fixture.ada, fixture.bea, fixture.cat} {
		fixture.markRead(reader, fixture.channel.ID)
	}
	space := fixture.subscribeSpace()
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq
	started := time.Now().Add(-time.Second)

	answered, err := fixture.closePoll(fixture.cat, poll.Id)
	if err != nil {
		t.Fatal(err)
	}
	closed := answered.Event.GetPoll()
	if closed.GetClosedBy().GetId() != authctx.UserID(fixture.cat) || closed.GetClosedAt() == nil ||
		closed.ClosedAt.AsTime().Before(started) || closed.ClosedAt.AsTime().After(time.Now().Add(time.Second)) {
		t.Errorf("the closed poll = %v, want it closed by cat just now", closed)
	}
	if got := tally(answered); got != "1:ada,bea 2:cat 3: of 3" {
		t.Errorf("the closed poll's votes = %q, want them as they were", got)
	}
	var data []byte
	if err := fixture.pool.QueryRow(context.Background(), `SELECT data FROM messages WHERE id = $1`, poll.Id).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var stored struct {
		Question string           `json:"question"`
		Options  []map[string]any `json:"options"`
		Multiple bool             `json:"multiple"`
		ClosedAt *time.Time       `json:"closed_at"`
		ClosedBy *string          `json:"closed_by"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Question != question || len(stored.Options) != 3 || stored.Multiple || stored.ClosedAt == nil ||
		!stored.ClosedAt.Equal(closed.ClosedAt.AsTime()) || stored.ClosedBy == nil || *stored.ClosedBy != authctx.UserID(fixture.cat) {
		t.Errorf("stored data = %s, want the definition untouched and closed by cat", data)
	}

	row := fixture.load(fixture.closingRowOf(poll.Id).ID)
	wantEvent := &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_PollClosed{PollClosed: &chatv1.PollClosed{
		Question: question, Winners: []*chatv1.PollWinner{{Text: "The co-op campaign", Votes: 2}}, VoterCount: 3,
	}}}
	if !proto.Equal(row.Event, wantEvent) || row.Content != question || row.Quiet || !row.InChannel ||
		row.Author.GetId() != authctx.UserID(fixture.cat) {
		t.Errorf("closing row = %v, want cat's loud row with the snapshot and the question", row)
	}
	if reference := row.Reference; reference.GetMessageId() != poll.Id || reference.GetAuthor().GetId() != authctx.UserID(fixture.cat) ||
		reference.GetPreview() != "Poll: "+question {
		t.Errorf("closing row's reference = %v, want the poll", reference)
	}
	if answered.Seq != channelSeq+1 || row.Seq != channelSeq+2 || fixture.channelRow(fixture.channel.ID).Seq != channelSeq+2 {
		t.Errorf("seqs: poll %d, closing row %d, want %d and %d", answered.Seq, row.Seq, channelSeq+1, channelSeq+2)
	}

	heard := heardRows(space)
	if len(heard) != 2 || heard[0].kind != "message_updated" || heard[1].kind != "message_created" {
		t.Fatalf("published %+v, want the poll updated and then its closing row created", heard)
	}
	if !proto.Equal(heard[0].message, answered) || !proto.Equal(heard[0].message, fixture.load(poll.Id)) {
		t.Errorf("published poll %v, want it as answered and as read", heard[0].message)
	}
	if !proto.Equal(heard[1].message, row) {
		t.Errorf("published closing row %v, read back %v", heard[1].message, row)
	}

	for name, reader := range map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea} {
		if got, want := fixture.state(reader), (readerState{unread: 1, lastMessageID: row.Id, spaceHasUnread: true}); got != want {
			t.Errorf("%s after the close = %+v, want %+v", name, got, want)
		}
	}
	if got, want := fixture.state(fixture.cat), (readerState{lastMessageID: row.Id}); got != want {
		t.Errorf("the closer after the close = %+v, want %+v", got, want)
	}
	for name, reader := range map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea, "cat": fixture.cat} {
		if items := fixture.activity(reader); len(items) != 0 {
			t.Errorf("%s has activity from a close in a channel: %v", name, items)
		}
	}

	// Closed for good: by its author, by a moderator, and to votes.
	channelSeq = fixture.channelRow(fixture.channel.ID).Seq
	for name, closer := range map[string]context.Context{"its author": fixture.cat, "the owner": fixture.ada} {
		if _, err := fixture.closePoll(closer, poll.Id); connect.CodeOf(err) != connect.CodeFailedPrecondition || !errors.Is(err, errPollClosed) {
			t.Errorf("%s closing it again: err = %v, want FailedPrecondition, closed", name, err)
		}
	}
	if _, err := fixture.setVote(fixture.bea, poll.Id, 2); !errors.Is(err, errPollClosed) {
		t.Errorf("a vote on the closed poll: err = %v, want it refused as closed", err)
	}
	if rows, seq := fixture.closingRows(fixture.channel.ID), fixture.channelRow(fixture.channel.ID).Seq; rows != 1 || seq != channelSeq {
		t.Errorf("after the refused closes: %d closing rows and seq %d, want 1 and %d", rows, seq, channelSeq)
	}
	if again := fixture.load(poll.Id); !proto.Equal(again, answered) {
		t.Errorf("the poll after the refused closes = %v, want %v", again, answered)
	}
	if heard := heardRows(space); len(heard) != 0 {
		t.Errorf("refused closes published %+v", heard)
	}
}

// The outcome is every option with the most votes when that is at least
// one, in the poll's order; the count of voters is of people.
func TestPollOutcomes(t *testing.T) {
	fixture := newSystemRows(t)
	type ballot struct {
		voter     context.Context
		selection []int32
	}
	abc := []string{"A", "B", "C"}
	cases := []struct {
		name     string
		multiple bool
		ballots  []ballot
		winners  []*chatv1.PollWinner
		voters   int32
	}{
		{"a clear winner", false,
			[]ballot{{fixture.ada, []int32{2}}, {fixture.bea, []int32{2}}, {fixture.cat, []int32{1}}},
			[]*chatv1.PollWinner{{Text: "B", Votes: 2}}, 3},
		{"a tie", false,
			[]ballot{{fixture.ada, []int32{3}}, {fixture.bea, []int32{1}}},
			[]*chatv1.PollWinner{{Text: "A", Votes: 1}, {Text: "C", Votes: 1}}, 2},
		{"nobody voted", false, nil, nil, 0},
		{"a vote taken back", false, []ballot{{fixture.ada, []int32{1}}, {fixture.ada, nil}}, nil, 0},
		{"several choices", true,
			[]ballot{{fixture.ada, []int32{1, 2}}, {fixture.bea, []int32{2, 3}}, {fixture.cat, []int32{2}}},
			[]*chatv1.PollWinner{{Text: "B", Votes: 3}}, 3},
		{"several choices, tied", true,
			[]ballot{{fixture.ada, []int32{1, 2, 3}}, {fixture.bea, []int32{3, 1}}},
			[]*chatv1.PollWinner{{Text: "A", Votes: 2}, {Text: "C", Votes: 2}}, 2},
	}
	for _, outcome := range cases {
		poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: outcome.name + "?", Options: abc, Multiple: outcome.multiple})
		for _, cast := range outcome.ballots {
			fixture.voted(cast.voter, poll.Id, cast.selection...)
		}
		row := fixture.closing(fixture.ada, poll)
		want := &chatv1.PollClosed{Question: outcome.name + "?", Winners: outcome.winners, VoterCount: outcome.voters}
		if got := fixture.load(row.ID).Event.GetPollClosed(); !proto.Equal(got, want) {
			t.Errorf("%s: outcome = %v, want %v", outcome.name, got, want)
		}
		// With no winner the row stores an empty list, not null.
		var winners string
		if err := fixture.pool.QueryRow(context.Background(), `SELECT data->>'winners' FROM messages WHERE id = $1`, row.ID).Scan(&winners); err != nil {
			t.Fatal(err)
		}
		if len(outcome.winners) == 0 && winners != "[]" {
			t.Errorf("%s: stored winners = %s, want []", outcome.name, winners)
		}
	}
}

// A time poll closes as any poll does, and each winner carries its time:
// the one with the most votes, or every one tied, earliest first. The
// closed poll keeps its times, and the closing row stores them. A text
// poll's winner stores none.
func TestCloseTimePoll(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	base := time.Now().UTC().Truncate(time.Minute)
	first, second, third := base.Add(24*time.Hour), base.Add(48*time.Hour), base.Add(72*time.Hour)
	ask := func(question string) *chatv1.Message {
		return fixture.poll(fixture.ada, &chatv1.CreatePollRequest{
			Question: question, Multiple: true, Times: stamps(third, first, second),
		})
	}
	storedWinners := func(pollID string) string {
		t.Helper()
		var winners string
		if err := fixture.pool.QueryRow(ctx, `SELECT data->>'winners' FROM messages WHERE id = $1`, fixture.closingRowOf(pollID).ID).Scan(&winners); err != nil {
			t.Fatal(err)
		}
		return winners
	}

	clear := ask("One winner?")
	fixture.voted(fixture.ada, clear.Id, 2)
	fixture.voted(fixture.bea, clear.Id, 2, 3)
	fixture.voted(fixture.cat, clear.Id, 1)
	answered, err := fixture.closePoll(fixture.ada, clear.Id)
	if err != nil {
		t.Fatal(err)
	}
	// The poll's data was decoded and written back: its times are intact.
	closed := answered.Event.GetPoll()
	if closed.GetClosedAt() == nil || len(closed.GetOptions()) != 3 {
		t.Fatalf("the closed poll = %v, want it closed with its three options", closed)
	}
	for index, want := range []time.Time{first, second, third} {
		if option := closed.Options[index]; option.Id != int32(index+1) || option.Text != "" || !proto.Equal(option.At, timestamppb.New(want)) {
			t.Errorf("closed option %d = %v, want id %d at %s", index, option, index+1, want)
		}
	}
	var options string
	if err := fixture.pool.QueryRow(ctx, `SELECT data->>'options' FROM messages WHERE id = $1`, clear.Id).Scan(&options); err != nil {
		t.Fatal(err)
	}
	var storedOptions []map[string]any
	if err := json.Unmarshal([]byte(options), &storedOptions); err != nil {
		t.Fatal(err)
	}
	if len(storedOptions) != 3 || storedOptions[0]["at"] != first.Format(time.RFC3339) || storedOptions[2]["at"] != third.Format(time.RFC3339) {
		t.Errorf("stored options after the close = %s, want each still with its time", options)
	}
	want := &chatv1.PollClosed{
		Question: "One winner?", VoterCount: 3,
		Winners: []*chatv1.PollWinner{{Votes: 2, At: timestamppb.New(second)}},
	}
	if got := fixture.load(fixture.closingRowOf(clear.Id).ID).Event.GetPollClosed(); !proto.Equal(got, want) {
		t.Errorf("outcome = %v, want %v", got, want)
	}
	var winners []map[string]any
	if err := json.Unmarshal([]byte(storedWinners(clear.Id)), &winners); err != nil {
		t.Fatal(err)
	}
	wantStored := []map[string]any{{"text": "", "votes": float64(2), "at": second.Format(time.RFC3339)}}
	if !reflect.DeepEqual(winners, wantStored) {
		t.Errorf("stored winners = %v, want %v", winners, wantStored)
	}

	tied := ask("A tie?")
	fixture.voted(fixture.ada, tied.Id, 3, 1)
	fixture.voted(fixture.bea, tied.Id, 1, 3)
	fixture.voted(fixture.cat, tied.Id, 2)
	fixture.closing(fixture.ada, tied)
	want = &chatv1.PollClosed{
		Question: "A tie?", VoterCount: 3,
		Winners: []*chatv1.PollWinner{{Votes: 2, At: timestamppb.New(first)}, {Votes: 2, At: timestamppb.New(third)}},
	}
	if got := fixture.load(fixture.closingRowOf(tied.Id).ID).Event.GetPollClosed(); !proto.Equal(got, want) {
		t.Errorf("a tie's outcome = %v, want %v", got, want)
	}

	text := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	fixture.voted(fixture.bea, text.Id, 1)
	fixture.closing(fixture.ada, text)
	if got := storedWinners(text.Id); got != `[{"text": "Yes", "votes": 1}]` {
		t.Errorf("a text poll's stored winners = %s, want them with no time", got)
	}
}

// A poll is closed by its author or, in a space, by someone with
// messages.moderate, and by either only where they may still write. A
// conversation has no moderator.
func TestWhoMayCloseAPoll(t *testing.T) {
	fixture := newSystemRows(t)
	ask := func(author context.Context, channelID string) *chatv1.Message {
		return fixture.poll(author, &chatv1.CreatePollRequest{ChannelId: channelID, Question: "Friday?", Options: yesNo})
	}
	open := func(where string, pollID string) {
		t.Helper()
		if fixture.load(pollID).Event.GetPoll().GetClosedAt() != nil {
			t.Fatalf("%s: the refused close went through", where)
		}
	}

	theirs := ask(fixture.cat, "")
	if _, err := fixture.closePoll(fixture.bea, theirs.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member closing someone else's poll: err = %v, want PermissionDenied", err)
	}
	open("a member", theirs.Id)
	byOwner, err := fixture.closePoll(fixture.ada, theirs.Id)
	if err != nil || byOwner.Event.GetPoll().GetClosedBy().GetId() != authctx.UserID(fixture.ada) {
		t.Errorf("the owner closing a member's poll = %v, %v; want it closed by ada", byOwner, err)
	}
	if row := fixture.closingRowOf(theirs.Id); row.AuthorID != authctx.UserID(fixture.ada) {
		t.Errorf("the closing row is by %s, want the closer", row.AuthorID)
	}
	// An announcement channel keeps a member from posting, not from
	// closing the poll they asked before it was one.
	own := ask(fixture.cat, "")
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if _, err := fixture.svc.UpdateChannel(fixture.ada, connect.NewRequest(&chatv1.UpdateChannelRequest{
		ChannelId: fixture.channel.ID, PostPolicy: &policy,
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.closePoll(fixture.cat, own.Id); err != nil {
		t.Errorf("a member closing their own poll in an announcement channel: %v", err)
	}

	// Authorship is not access: removed from a private channel, the
	// author closes nothing, and is told what anyone outside it is.
	private, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "back-room", Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	backRoom := private.Msg.Channel.Id
	if _, err := fixture.svc.AddChannelMembers(fixture.ada, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: backRoom, UserIds: []string{authctx.UserID(fixture.cat)},
	})); err != nil {
		t.Fatal(err)
	}
	inPrivate := ask(fixture.cat, backRoom)
	if _, err := fixture.svc.RemoveChannelMember(fixture.ada, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
		ChannelId: backRoom, UserId: authctx.UserID(fixture.cat),
	})); err != nil {
		t.Fatal(err)
	}
	_, removed := fixture.closePoll(fixture.cat, inPrivate.Id)
	_, outside := fixture.closePoll(fixture.bea, inPrivate.Id)
	if connect.CodeOf(removed) != connect.CodeNotFound || connect.CodeOf(outside) != connect.CodeNotFound {
		t.Errorf("closing from outside a private channel: its removed author %v, a stranger %v; want NotFound for both", removed, outside)
	}
	open("a removed author", inPrivate.Id)

	// In a conversation: its author, and not the other person.
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	between := ask(fixture.bea, conversation.ID)
	if _, err := fixture.closePoll(fixture.ada, between.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("the other person closing a poll in a conversation: err = %v, want PermissionDenied", err)
	}
	if _, err := fixture.closePoll(fixture.cat, between.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("someone outside a conversation closing its poll: err = %v, want PermissionDenied", err)
	}
	open("the other person", between.Id)
	// Nor its author once a block stops them writing there.
	blocked := fixture.conversation(fixture.ada, fixture.cat)
	behindBlock := ask(fixture.ada, blocked.ID)
	if _, err := fixture.svc.BlockUser(fixture.cat, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(fixture.ada)})); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.closePoll(fixture.ada, behindBlock.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("an author closing a poll behind a block: err = %v, want PermissionDenied", err)
	}
	open("a blocked author", behindBlock.Id)
	if _, err := fixture.closePoll(fixture.bea, between.Id); err != nil {
		t.Errorf("the author closing their poll in a conversation: %v", err)
	}

	// What is not an open poll is not closed, whoever asks.
	plain := fixture.send(fixture.ada, &chatv1.SendMessageRequest{ChannelId: conversation.ID, Content: "hello"})
	for name, messageID := range map[string]string{"a message": plain.Id, "a closing row": fixture.closingRowOf(between.Id).ID} {
		if _, err := fixture.closePoll(fixture.ada, messageID); connect.CodeOf(err) != connect.CodeFailedPrecondition || !errors.Is(err, errNotAPoll) {
			t.Errorf("closing %s: err = %v, want FailedPrecondition, not a poll", name, err)
		}
	}
	if _, err := fixture.closePoll(fixture.ada, "00000000-0000-7000-8000-000000000000"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("closing no message: err = %v, want NotFound", err)
	}
}

// In a direct message and in a group conversation a close behaves as a
// message does: it puts a closed conversation back on the others' lists,
// its row is their unread last message, and each is alerted once,
// previewed "Poll closed:" and the question. The closer is told nothing.
func TestClosePollInAConversation(t *testing.T) {
	for name, size := range map[string]int{"direct message": 1, "group conversation": 2} {
		t.Run(name, func(t *testing.T) {
			fixture := newSystemRows(t)
			others := []context.Context{fixture.bea, fixture.cat}[:size]
			conversation := fixture.conversation(fixture.ada, others...)
			question := typedQuestion(fixture.bea)
			poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: question, Options: yesNo})
			fixture.voted(fixture.bea, poll.Id, 2)
			for _, other := range others {
				fixture.markRead(other, conversation.ID)
				if _, err := fixture.svc.SetDirectMessageClosed(other, connect.NewRequest(&chatv1.SetDirectMessageClosedRequest{
					ChannelId: conversation.ID, Closed: true,
				})); err != nil {
					t.Fatal(err)
				}
			}
			bea := fixture.subscribeUser(fixture.bea)

			answered, err := fixture.closePoll(fixture.ada, poll.Id)
			if err != nil {
				t.Fatal(err)
			}
			row := fixture.closingRowOf(poll.Id)
			want := "Poll closed: " + question
			for _, other := range others {
				listed := fixture.listedConversation(other, conversation.ID)
				if listed.Closed || listed.Channel.UnreadCount != 1 || listed.LastMessage.GetMessageId() != row.ID ||
					listed.LastMessage.GetPreview() != want || listed.LastMessage.GetAuthor().GetId() != authctx.UserID(fixture.ada) {
					t.Errorf("the conversation for someone else = %v, want it reopened, one unread, last message %q", listed, want)
				}
				// The poll's own alert was read with the conversation.
				var items []*chatv1.ActivityItem
				for _, item := range fixture.activity(other) {
					if item.ReadAt == nil {
						items = append(items, item)
					}
				}
				if len(items) != 1 || items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_DM || items[0].MessageId != row.ID ||
					items[0].Preview != want || items[0].Actor.GetId() != authctx.UserID(fixture.ada) {
					t.Fatalf("unread activity for someone else = %v, want one dm item by ada about the closing row, previewed %q", items, want)
				}
			}
			mine := fixture.listedConversation(fixture.ada, conversation.ID)
			if mine.Channel.UnreadCount != 0 || mine.LastMessage.GetMessageId() != row.ID {
				t.Errorf("the conversation for the closer = %v, want it read up to the closing row", mine)
			}
			if items := fixture.activity(fixture.ada); len(items) != 0 {
				t.Errorf("the closer has activity for their own close: %v", items)
			}

			var reopened, alerted int
			var rows []rowEvent
			for _, event := range everyEvent(bea) {
				switch {
				case event.GetChannelCreated().GetId() == conversation.ID:
					reopened++
				case event.GetActivityItemCreated().GetItem().GetPreview() == want:
					alerted++
				case event.GetMessageUpdated() != nil:
					rows = append(rows, rowEvent{"message_updated", event.GetMessageUpdated().Id, event.GetMessageUpdated().Seq, event.GetMessageUpdated()})
				case event.GetMessageCreated() != nil:
					rows = append(rows, rowEvent{"message_created", event.GetMessageCreated().Id, event.GetMessageCreated().Seq, event.GetMessageCreated()})
				}
			}
			if reopened != 1 || alerted != 1 {
				t.Errorf("bea heard %d reopen and %d alert previewed %q; want one of each", reopened, alerted, want)
			}
			if len(rows) != 2 || rows[0].kind != "message_updated" || !proto.Equal(rows[0].message, answered) ||
				rows[1].kind != "message_created" || rows[1].id != row.ID || rows[1].seq != rows[0].seq+1 {
				t.Errorf("bea heard %+v, want the closed poll and then its closing row, one seq apart", rows)
			}
		})
	}
}

// Someone who voted and then left the space is still counted in the
// outcome and still named on the closed poll.
func TestVotesOfSomeoneWhoLeftAreCounted(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	fixture.voted(fixture.cat, poll.Id, 2)
	fixture.voted(fixture.bea, poll.Id, 2)
	fixture.voted(fixture.ada, poll.Id, 1)
	if _, err := fixture.svc.LeaveSpace(fixture.cat, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: fixture.spaceID})); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.setVote(fixture.cat, poll.Id, 1); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a vote from someone who left: err = %v, want PermissionDenied", err)
	}
	answered, err := fixture.closePoll(fixture.ada, poll.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := tally(answered); got != "1:ada 2:cat,bea of 3" {
		t.Errorf("the closed poll = %q, want cat still named", got)
	}
	want := &chatv1.PollClosed{Question: "Friday?", Winners: []*chatv1.PollWinner{{Text: "No", Votes: 2}}, VoterCount: 3}
	if got := fixture.load(fixture.closingRowOf(poll.Id).ID).Event.GetPollClosed(); !proto.Equal(got, want) {
		t.Errorf("outcome = %v, want %v", got, want)
	}
}

// Nothing but ClosePoll's own transaction can record a closing row:
// recordEvent refuses one about anything but a live, closed poll in the
// same channel.
func TestClosingRowIsOnlyAboutAClosedPoll(t *testing.T) {
	fixture := newSystemRows(t)
	open := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	plain := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "hello"})
	deleted := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Gone?", Options: yesNo})
	if _, err := fixture.svc.DeleteMessage(fixture.ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: deleted.Id})); err != nil {
		t.Fatal(err)
	}
	closed := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Done?", Options: yesNo})
	closing := fixture.closing(fixture.ada, closed)
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	elsewhere := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: "Lunch?", Options: yesNo})
	fixture.closing(fixture.ada, elsewhere)
	rows := fixture.closingRows(fixture.channel.ID)
	seq := fixture.channelRow(fixture.channel.ID).Seq

	record := func(pollID string) error {
		return fixture.svc.inTx(context.Background(), func(qtx *dbgen.Queries) error {
			if _, err := qtx.LockChannel(context.Background(), fixture.channel.ID); err != nil {
				return err
			}
			_, err := recordEvent(context.Background(), qtx, fixture.channel, authctx.UserID(fixture.ada),
				pollClosed{PollID: pollID, Question: "Friday?", Winners: []pollWinner{}})
			return err
		})
	}
	for name, id := range map[string]string{
		"an open poll": open.Id, "a message": plain.Id, "a deleted poll": deleted.Id,
		"a closing row": closing.ID, "a closed poll in another channel": elsewhere.Id, "no poll": "",
	} {
		if err := record(id); err == nil {
			t.Errorf("a closing row about %s was recorded", name)
		}
	}
	if got, at := fixture.closingRows(fixture.channel.ID), fixture.channelRow(fixture.channel.ID).Seq; got != rows || at != seq {
		t.Errorf("refused closing rows left %d rows at seq %d, want %d at %d", got, at, rows, seq)
	}
	// The one thing it takes: a closed poll here.
	if err := record(closed.Id); err != nil {
		t.Errorf("a closing row about a closed poll: %v", err)
	}
}

// In a group conversation, as in a direct message, only the poll's
// author closes it: another participant is refused.
func TestOtherParticipantCannotCloseAGroupPoll(t *testing.T) {
	fixture := newSystemRows(t)
	group := fixture.conversation(fixture.ada, fixture.bea, fixture.cat)
	poll := fixture.poll(fixture.bea, &chatv1.CreatePollRequest{ChannelId: group.ID, Question: "Lunch?", Options: yesNo})
	for name, other := range map[string]context.Context{"the opener": fixture.ada, "another participant": fixture.cat} {
		if _, err := fixture.closePoll(other, poll.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s closing someone else's poll in a group: err = %v, want PermissionDenied", name, err)
		}
	}
	if fixture.load(poll.Id).Event.GetPoll().GetClosedAt() != nil || fixture.closingRows(group.ID) != 0 {
		t.Error("a refused close in a group went through")
	}
	if _, err := fixture.closePoll(fixture.bea, poll.Id); err != nil {
		t.Errorf("the author closing their poll in a group: %v", err)
	}
}

// messages.moderate does not reach into a private channel its holder is
// not in: an admin outside one neither closes nor deletes a poll there,
// and is told it is not found, as anyone outside is.
func TestAdminOutsideAPrivateChannelCannotCloseOrDeleteItsPoll(t *testing.T) {
	fixture := newSystemRows(t)
	if _, err := fixture.svc.SetMemberRole(fixture.ada, connect.NewRequest(&chatv1.SetMemberRoleRequest{
		SpaceId: fixture.spaceID, UserId: authctx.UserID(fixture.bea), Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN,
	})); err != nil {
		t.Fatal(err)
	}
	private, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "back-room", Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	backRoom := private.Msg.Channel.Id
	if _, err := fixture.svc.AddChannelMembers(fixture.ada, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: backRoom, UserIds: []string{authctx.UserID(fixture.cat)},
	})); err != nil {
		t.Fatal(err)
	}
	poll := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{ChannelId: backRoom, Question: "Friday?", Options: yesNo})
	// The same admin closes a member's poll where she can read it.
	public := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	if _, err := fixture.closePoll(fixture.bea, public.Id); err != nil {
		t.Fatalf("an admin closing a member's poll in a public channel: %v", err)
	}

	if _, err := fixture.closePoll(fixture.bea, poll.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("an admin outside a private channel closing its poll: err = %v, want NotFound", err)
	}
	if _, err := fixture.svc.DeleteMessage(fixture.bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: poll.Id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("an admin outside a private channel deleting its poll: err = %v, want NotFound", err)
	}
	after, err := fixture.svc.loadMessage(context.Background(), poll.Id, fixture.spaceID)
	if err != nil || after.Deleted || after.Event.GetPoll().GetClosedAt() != nil {
		t.Errorf("the poll after the refusals = %v, %v; want it open and there", after, err)
	}
}
