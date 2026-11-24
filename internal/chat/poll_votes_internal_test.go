package chat

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// Voting on a poll (docs/architecture/messaging.md → Polls).

// setVote is voter setting their whole selection on a poll.
func (f *systemRows) setVote(voter context.Context, pollID string, optionIDs ...int32) (*chatv1.Message, error) {
	res, err := f.svc.SetPollVote(voter, connect.NewRequest(&chatv1.SetPollVoteRequest{MessageId: pollID, OptionIds: optionIDs}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Message, nil
}

// voted is setVote that must succeed.
func (f *systemRows) voted(voter context.Context, pollID string, optionIDs ...int32) *chatv1.Message {
	f.t.Helper()
	message, err := f.setVote(voter, pollID, optionIDs...)
	if err != nil {
		f.t.Fatal(err)
	}
	return message
}

// tally is a poll's voters by option, as "1:bea,cat 2: 3:ada", and how
// many people it says voted.
func tally(message *chatv1.Message) string {
	poll := message.GetEvent().GetPoll()
	var options []string
	for _, option := range poll.GetOptions() {
		var names []string
		for _, voter := range option.Voters {
			names = append(names, voter.Username)
		}
		options = append(options, fmt.Sprintf("%d:%s", option.Id, strings.Join(names, ",")))
	}
	return fmt.Sprintf("%s of %d", strings.Join(options, " "), poll.GetVoterCount())
}

// rowEvent is one message event a subscription received.
type rowEvent struct {
	kind    string // message_created, message_updated, message_deleted or other
	id      string
	seq     int64
	message *chatv1.Message
}

// heardRows is what a subscription receives within a moment.
func heardRows(sub *events.Subscription) []rowEvent {
	var got []rowEvent
	for _, event := range everyEvent(sub) {
		switch payload := event.Payload.(type) {
		case *realtimev1.ServerEvent_MessageCreated:
			got = append(got, rowEvent{"message_created", payload.MessageCreated.Id, payload.MessageCreated.Seq, payload.MessageCreated})
		case *realtimev1.ServerEvent_MessageUpdated:
			got = append(got, rowEvent{"message_updated", payload.MessageUpdated.Id, payload.MessageUpdated.Seq, payload.MessageUpdated})
		case *realtimev1.ServerEvent_MessageDeleted:
			got = append(got, rowEvent{"message_deleted", payload.MessageDeleted.MessageId, payload.MessageDeleted.Seq, nil})
		default:
			got = append(got, rowEvent{kind: "other"})
		}
	}
	return got
}

func (f *systemRows) subscribeSpace() *events.Subscription {
	sub := f.svc.bus.(*events.InProcBus).Subscribe(events.SpaceTopic(f.spaceID))
	f.t.Cleanup(sub.Close)
	return sub
}

func (f *systemRows) subscribeUser(person context.Context) *events.Subscription {
	sub := f.svc.bus.(*events.InProcBus).Subscribe(events.UserTopic(authctx.UserID(person)))
	f.t.Cleanup(sub.Close)
	return sub
}

// On a poll of one choice a vote is one option: choosing another swaps
// it, and an empty selection takes it back. Each change is one new seq
// and one message_updated carrying the poll as a fresh read has it.
func TestVoteOnOneChoice(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	space := fixture.subscribeSpace()
	steps := []struct {
		name      string
		selection []int32
		want      string
		rows      int
	}{
		{"a first vote", []int32{1}, "1:bea 2: of 1", 1},
		{"a swap", []int32{2}, "1: 2:bea of 1", 1},
		{"taken back", nil, "1: 2: of 0", 0},
		{"voted again", []int32{2}, "1: 2:bea of 1", 1},
	}
	for _, step := range steps {
		before := fixture.channelRow(fixture.channel.ID).Seq
		answered := fixture.voted(fixture.bea, poll.Id, step.selection...)
		if got := tally(answered); got != step.want {
			t.Errorf("%s: answered %q, want %q", step.name, got, step.want)
		}
		if got := fixture.votesOn(poll.Id); got != step.rows {
			t.Errorf("%s: %d vote rows, want %d", step.name, got, step.rows)
		}
		if answered.Seq != before+1 || fixture.channelRow(fixture.channel.ID).Seq != before+1 {
			t.Errorf("%s: the poll's seq = %d, want the channel's next after %d", step.name, answered.Seq, before)
		}
		heard := heardRows(space)
		if len(heard) != 1 || heard[0].kind != "message_updated" || !proto.Equal(heard[0].message, answered) {
			t.Errorf("%s: published %v, want the poll once as answered", step.name, heard)
		}
		if loaded := fixture.load(poll.Id); !proto.Equal(loaded, answered) {
			t.Errorf("%s: answered %v, a fresh read has %v", step.name, answered, loaded)
		}
	}
}

// On a poll of several choices a selection is a set: what is in it and
// was not is added, what was and is not is removed, and an option kept
// keeps its place. Voters are listed by option in the order they chose
// it, and the count is of people.
func TestVoteOnSeveralChoices(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{
		Question: "Which nights?", Options: []string{"Friday", "Saturday", "Sunday"}, Multiple: true,
	})
	steps := []struct {
		name      string
		voter     context.Context
		selection []int32
		want      string
	}{
		{"bea picks two", fixture.bea, []int32{1, 2}, "1:bea 2:bea 3: of 1"},
		{"cat picks one", fixture.cat, []int32{2}, "1:bea 2:bea,cat 3: of 2"},
		{"ada picks two, in any order", fixture.ada, []int32{2, 1}, "1:bea,ada 2:bea,cat,ada 3: of 3"},
		{"bea drops one and adds one", fixture.bea, []int32{2, 3}, "1:ada 2:bea,cat,ada 3:bea of 3"},
		{"bea takes everything back", fixture.bea, nil, "1:ada 2:cat,ada 3: of 2"},
		{"bea votes again, last in line", fixture.bea, []int32{2}, "1:ada 2:cat,ada,bea 3: of 3"},
	}
	for _, step := range steps {
		if got := tally(fixture.voted(step.voter, poll.Id, step.selection...)); got != step.want {
			t.Errorf("%s: %q, want %q", step.name, got, step.want)
		}
	}
	if got := tally(fixture.listed(fixture.cat)[0]); got != steps[len(steps)-1].want {
		t.Errorf("history has %q, want %q", got, steps[len(steps)-1].want)
	}
}

// A selection equal to what is stored answers with the poll and changes
// nothing: no seq is spent, the row keeps its own, and nothing is
// published.
func TestUnchangedVotePublishesNothing(t *testing.T) {
	fixture := newSystemRows(t)
	single := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	several := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Which?", Options: []string{"A", "B", "C"}, Multiple: true})
	fixture.voted(fixture.bea, single.Id, 1)
	fixture.voted(fixture.bea, several.Id, 1, 3)
	space := fixture.subscribeSpace()
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq
	repeats := []struct {
		name      string
		voter     context.Context
		pollID    string
		selection []int32
		want      string
	}{
		{"the same choice", fixture.bea, single.Id, []int32{1}, "1:bea 2: of 1"},
		{"the same set, reordered", fixture.bea, several.Id, []int32{3, 1}, "1:bea 2: 3:bea of 1"},
		{"nothing, from someone who had not voted", fixture.cat, single.Id, nil, "1:bea 2: of 1"},
	}
	for _, repeat := range repeats {
		before := fixture.load(repeat.pollID)
		answered, err := fixture.setVote(repeat.voter, repeat.pollID, repeat.selection...)
		if err != nil {
			t.Errorf("%s: %v", repeat.name, err)
			continue
		}
		if tally(answered) != repeat.want || !proto.Equal(answered, before) {
			t.Errorf("%s: answered %v, want the poll as it was, %q", repeat.name, answered, repeat.want)
		}
	}
	if got := fixture.channelRow(fixture.channel.ID).Seq; got != channelSeq {
		t.Errorf("unchanged votes moved the channel seq from %d to %d", channelSeq, got)
	}
	if heard := heardRows(space); len(heard) != 0 {
		t.Errorf("unchanged votes published %v", heard)
	}
}

// A vote is refused, and stores and spends nothing, when its selection
// is not one the poll takes or when what it names is not an open poll.
func TestRefusedVotes(t *testing.T) {
	fixture := newSystemRows(t)
	single := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	several := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Which?", Options: []string{"A", "B", "C"}, Multiple: true})
	closed := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Done?", Options: yesNo})
	closing := fixture.closing(fixture.ada, closed)
	deleted := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Gone?", Options: yesNo})
	if _, err := fixture.svc.DeleteMessage(fixture.ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: deleted.Id})); err != nil {
		t.Fatal(err)
	}
	plain := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "hello"})
	renamed := fixture.record(fixture.ada, fixture.channel, channelRenamed{OldName: "general", NewName: "porch"})
	tooMany := make([]int32, maxPollOptions+1)
	for index := range tooMany {
		tooMany[index] = 1
	}
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq

	refused := []struct {
		name      string
		pollID    string
		selection []int32
		code      connect.Code
		is        error
	}{
		{"an option the poll does not have", single.Id, []int32{3}, connect.CodeInvalidArgument, nil},
		{"option zero", single.Id, []int32{0}, connect.CodeInvalidArgument, nil},
		{"a negative option", single.Id, []int32{-1}, connect.CodeInvalidArgument, nil},
		// 65537 is 1 once cut to the stored width.
		{"an option past the stored width", single.Id, []int32{65537}, connect.CodeInvalidArgument, nil},
		{"two options on one choice", single.Id, []int32{1, 2}, connect.CodeInvalidArgument, nil},
		{"an option twice", several.Id, []int32{2, 2}, connect.CodeInvalidArgument, nil},
		{"an unknown option among known ones", several.Id, []int32{1, 4}, connect.CodeInvalidArgument, nil},
		{"more options than a poll holds", several.Id, tooMany, connect.CodeInvalidArgument, nil},
		// Refused on the count alone, before the message is looked up.
		{"more options than a poll holds, on no message", "00000000-0000-7000-8000-000000000000", tooMany, connect.CodeInvalidArgument, nil},
		{"a closed poll", closed.Id, []int32{1}, connect.CodeFailedPrecondition, errPollClosed},
		{"a closed poll, taking back", closed.Id, nil, connect.CodeFailedPrecondition, errPollClosed},
		{"a deleted poll", deleted.Id, []int32{1}, connect.CodeNotFound, nil},
		{"a message", plain.Id, []int32{1}, connect.CodeFailedPrecondition, errNotAPoll},
		{"a closing row", closing.ID, []int32{1}, connect.CodeFailedPrecondition, errNotAPoll},
		{"another system row", renamed.ID, nil, connect.CodeFailedPrecondition, errNotAPoll},
		{"no such message", "00000000-0000-7000-8000-000000000000", []int32{1}, connect.CodeNotFound, nil},
	}
	for _, attempt := range refused {
		_, err := fixture.setVote(fixture.bea, attempt.pollID, attempt.selection...)
		if connect.CodeOf(err) != attempt.code || (attempt.is != nil && !errors.Is(err, attempt.is)) {
			t.Errorf("%s: err = %v, want %v %v", attempt.name, err, attempt.code, attempt.is)
		}
	}
	var votes int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM poll_votes`).Scan(&votes); err != nil {
		t.Fatal(err)
	}
	if votes != 0 {
		t.Errorf("refused votes stored %d rows", votes)
	}
	if got := fixture.channelRow(fixture.channel.ID).Seq; got != channelSeq {
		t.Errorf("refused votes moved the channel seq from %d to %d", channelSeq, got)
	}
}

// Whoever may react may vote: a member of an announcement channel, who
// may not post there or ask a poll of their own.
func TestMemberVotesInAnAnnouncementChannel(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if _, err := fixture.svc.UpdateChannel(fixture.ada, connect.NewRequest(&chatv1.UpdateChannelRequest{
		ChannelId: fixture.channel.ID, PostPolicy: &policy,
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.SendMessage(fixture.cat, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.channel.ID, Content: "me too",
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a member posting in an announcement channel: err = %v, want PermissionDenied", err)
	}
	if got := tally(fixture.voted(fixture.cat, poll.Id, 2)); got != "1: 2:cat of 1" {
		t.Errorf("a member's vote in an announcement channel = %q, want it counted", got)
	}
}

// A vote is refused wherever the voter's reaction would be, with the
// same code: outside a private channel, outside a conversation, and in a
// direct message with a block in it.
func TestVoteWhereAReactionIsRefused(t *testing.T) {
	fixture := newSystemRows(t)
	private, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "back-room", Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	pair := fixture.conversation(fixture.ada, fixture.bea)
	blocked := fixture.conversation(fixture.ada, fixture.cat)
	type place struct {
		poll, message *chatv1.Message
	}
	in := func(channelID string) place {
		return place{
			poll:    fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: channelID, Question: "Friday?", Options: yesNo}),
			message: fixture.send(fixture.ada, &chatv1.SendMessageRequest{ChannelId: channelID, Content: "hello"}),
		}
	}
	backRoom, between, withBlock := in(private.Msg.Channel.Id), in(pair.ID), in(blocked.ID)
	if _, err := fixture.svc.BlockUser(fixture.cat, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(fixture.ada)})); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		voter context.Context
		where place
		want  connect.Code
	}{
		{"a member outside a private channel", fixture.bea, backRoom, connect.CodeNotFound},
		{"someone outside a conversation", fixture.cat, between, connect.CodePermissionDenied},
		{"the blocked person in a direct message", fixture.ada, withBlock, connect.CodePermissionDenied},
		{"the blocker in a direct message", fixture.cat, withBlock, connect.CodePermissionDenied},
	}
	for _, refused := range cases {
		_, err := fixture.setVote(refused.voter, refused.where.poll.Id, 1)
		if connect.CodeOf(err) != refused.want {
			t.Errorf("%s: err = %v, want %v", refused.name, err, refused.want)
		}
		_, reaction := fixture.svc.ToggleReaction(refused.voter, connect.NewRequest(&chatv1.ToggleReactionRequest{
			MessageId: refused.where.message.Id, Emoji: "👍",
		}))
		if reaction == nil || connect.CodeOf(reaction) != connect.CodeOf(err) {
			t.Errorf("%s: a vote answers %v where a reaction answers %v", refused.name, err, reaction)
		}
		// Nor does the refusal say whether the selection was a good one.
		if _, bad := fixture.setVote(refused.voter, refused.where.poll.Id, 9); connect.CodeOf(bad) != refused.want {
			t.Errorf("%s, an unknown option: err = %v, want %v", refused.name, bad, refused.want)
		}
	}
	var votes int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM poll_votes`).Scan(&votes); err != nil {
		t.Fatal(err)
	}
	if votes != 0 {
		t.Errorf("refused votes stored %d rows", votes)
	}
	if got := tally(fixture.voted(fixture.bea, between.poll.Id, 1)); got != "1:bea 2: of 1" {
		t.Errorf("a participant's vote = %q, want it counted", got)
	}
}

// A vote tells nobody anything: unread counts, last messages, alert
// counts and activity are as they were, in a channel and in a
// conversation, and a conversation someone closed stays closed.
func TestVoteMarksNothingUnread(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	private := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: "Lunch?", Options: yesNo})
	for _, reader := range []context.Context{fixture.ada, fixture.bea, fixture.cat} {
		if _, err := fixture.svc.MarkChannelRead(reader, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: fixture.channel.ID})); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := fixture.svc.MarkChannelRead(fixture.bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: conversation.ID})); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.SetDirectMessageClosed(fixture.ada, connect.NewRequest(&chatv1.SetDirectMessageClosedRequest{
		ChannelId: conversation.ID, Closed: true,
	})); err != nil {
		t.Fatal(err)
	}
	readers := map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea, "cat": fixture.cat}
	type told struct {
		channel      readerState
		activity     int
		conversation string
	}
	snapshot := func(reader context.Context) told {
		out := told{channel: fixture.state(reader), activity: len(fixture.activity(reader))}
		if reader != fixture.cat {
			listed := fixture.listedConversation(reader, conversation.ID)
			out.conversation = fmt.Sprint(listed.Closed, listed.Channel.UnreadCount, listed.Channel.AlertCount, listed.LastMessage.GetMessageId())
		}
		return out
	}
	before := map[string]told{}
	for name, reader := range readers {
		before[name] = snapshot(reader)
	}
	ada := fixture.subscribeUser(fixture.ada)

	fixture.voted(fixture.bea, poll.Id, 1)
	fixture.voted(fixture.cat, poll.Id, 2)
	fixture.voted(fixture.bea, poll.Id, 2)
	fixture.voted(fixture.bea, private.Id, 1)
	fixture.voted(fixture.bea, private.Id)

	for name, reader := range readers {
		if got := snapshot(reader); got != before[name] {
			t.Errorf("%s after the votes = %+v, want %+v as before", name, got, before[name])
		}
	}
	// The conversation's votes reach ada as the poll and nothing else: no
	// alert, and no reopening of the conversation she closed.
	for _, heard := range heardRows(ada) {
		if heard.kind != "message_updated" || heard.id != private.Id {
			t.Errorf("ada heard %+v, want only the conversation's poll updated", heard)
		}
	}
}

// Two selections from one person at once are let in one after the other:
// each is a whole selection, so a poll of one choice ends with one vote.
func TestConcurrentVotesFromOnePerson(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Which?", Options: []string{"A", "B", "C", "D"}})
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq
	const votes = 4
	errs := make([]error, votes)
	seqs := make([]int64, votes)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for index := range votes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			answered, err := fixture.setVote(fixture.bea, poll.Id, int32(index+1))
			errs[index] = err
			seqs[index] = answered.GetSeq()
		}()
	}
	close(start)
	wg.Wait()
	for index, err := range errs {
		if err != nil {
			t.Fatalf("vote %d: %v", index, err)
		}
	}
	if got := fixture.votesOn(poll.Id); got != 1 {
		t.Errorf("%d vote rows after %d racing swaps, want one", got, votes)
	}
	final := fixture.load(poll.Id)
	if final.Event.GetPoll().GetVoterCount() != 1 || final.Seq != channelSeq+votes {
		t.Errorf("the poll = %v at seq %d, want one voter and seq %d", tally(final), final.Seq, channelSeq+votes)
	}
	// Each answer carries the seq its own vote took, so together they are
	// the next four, and the vote that stands is the one let in last.
	sorted := slices.Sorted(slices.Values(seqs))
	if want := []int64{channelSeq + 1, channelSeq + 2, channelSeq + 3, channelSeq + 4}; !slices.Equal(sorted, want) {
		t.Fatalf("the votes answered with seqs %v, want each its own of %v", seqs, want)
	}
	last := slices.Index(seqs, final.Seq)
	if len(final.Event.GetPoll().GetOptions()[last].GetVoters()) != 1 {
		t.Errorf("the last vote in was for option %d, but the poll reads %s", last+1, tally(final))
	}
}

// holdReloads keeps every read of a message through the view waiting
// until the returned release is called, while writes go through: it
// holds a table only the view reads. It is how a test makes a write's
// reload run after a later write has committed.
func (f *systemRows) holdReloads() (release func()) {
	f.t.Helper()
	ctx := context.Background()
	held, err := f.pool.Begin(ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := held.Exec(ctx, `LOCK TABLE message_attachments IN ACCESS EXCLUSIVE MODE`); err != nil {
		f.t.Fatal(err)
	}
	var once sync.Once
	release = func() {
		once.Do(func() {
			if err := held.Rollback(ctx); err != nil {
				f.t.Error(err)
			}
		})
	}
	f.t.Cleanup(release)
	return release
}

// waitForSeq waits until the channel's seq is want: the writes a test
// started have committed.
func (f *systemRows) waitForSeq(want int64) {
	f.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for f.channelRow(f.channel.ID).Seq != want {
		if time.Now().After(deadline) {
			f.t.Fatalf("the channel's seq is %d, want %d", f.channelRow(f.channel.ID).Seq, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// Two votes whose reloads both run after both have committed are still
// published one per seq: each event and answer carries the seq its own
// transaction took, not the row's newest. Both at the newer seq would
// leave the older one unsent, and every client catching up.
func TestOverlappingVotesPublishTheirOwnSeqs(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	space := fixture.subscribeSpace()
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq
	release := fixture.holdReloads()
	voters := []context.Context{fixture.bea, fixture.cat}
	answers := make([]*chatv1.Message, len(voters))
	errs := make([]error, len(voters))
	var wg sync.WaitGroup
	for index, voter := range voters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			answers[index], errs[index] = fixture.setVote(voter, poll.Id, 1)
		}()
		// Committed, and waiting to reload, before the next begins.
		fixture.waitForSeq(channelSeq + int64(index) + 1)
	}
	release()
	wg.Wait()
	for index, err := range errs {
		if err != nil {
			t.Fatalf("vote %d: %v", index, err)
		}
		if answers[index].Seq != channelSeq+int64(index)+1 {
			t.Errorf("vote %d answered at seq %d, want its own, %d", index, answers[index].Seq, channelSeq+int64(index)+1)
		}
	}
	var published []int64
	for _, heard := range heardRows(space) {
		if heard.kind != "message_updated" || heard.id != poll.Id {
			t.Errorf("heard %+v, want only the poll updated", heard)
		}
		published = append(published, heard.seq)
	}
	slices.Sort(published)
	if want := []int64{channelSeq + 1, channelSeq + 2}; !slices.Equal(published, want) {
		t.Errorf("published seqs %v, want one event at each of %v", published, want)
	}
}

// A close whose reloads run after a later write to the poll has
// committed still publishes the poll at the close's seq and the closing
// row at the next.
func TestCloseIsPublishedAtItsOwnSeqs(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	space := fixture.subscribeSpace()
	channelSeq := fixture.channelRow(fixture.channel.ID).Seq
	release := fixture.holdReloads()
	var answered *chatv1.Message
	var closeErr, pinErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		answered, closeErr = fixture.closePoll(fixture.ada, poll.Id)
	}()
	fixture.waitForSeq(channelSeq + 2)
	// A pin stamps the poll again, and records its own row.
	go func() {
		defer wg.Done()
		pinErr = fixture.setPinned(fixture.ada, poll.Id, true)
	}()
	fixture.waitForSeq(channelSeq + 4)
	release()
	wg.Wait()
	if closeErr != nil || pinErr != nil {
		t.Fatalf("close: %v, pin: %v", closeErr, pinErr)
	}
	if answered.Seq != channelSeq+1 {
		t.Errorf("the close answered the poll at seq %d, want its own, %d", answered.Seq, channelSeq+1)
	}
	closingID := fixture.closingRowOf(poll.Id).ID
	seqs := map[string]int64{}
	for _, heard := range heardRows(space) {
		switch {
		case heard.kind == "message_updated" && heard.id == poll.Id:
			seqs["poll"] = heard.seq
		case heard.kind == "message_created" && heard.id == closingID:
			seqs["closing row"] = heard.seq
		}
	}
	if seqs["poll"] != channelSeq+1 || seqs["closing row"] != channelSeq+2 {
		t.Errorf("published %v, want the poll at %d and its closing row at %d", seqs, channelSeq+1, channelSeq+2)
	}
}

// A vote racing a close is either counted in the outcome or refused,
// never stored after the snapshot.
func TestVoteRacingClose(t *testing.T) {
	fixture := newSystemRows(t)
	counted, refused := 0, 0
	for round := range 12 {
		poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: fmt.Sprint("Round ", round, "?"), Options: yesNo})
		fixture.voted(fixture.cat, poll.Id, 2)
		var voteErr, closeErr error
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, voteErr = fixture.setVote(fixture.bea, poll.Id, 1)
		}()
		go func() {
			defer wg.Done()
			<-start
			_, closeErr = fixture.svc.ClosePoll(fixture.ada, connect.NewRequest(&chatv1.ClosePollRequest{MessageId: poll.Id}))
		}()
		close(start)
		wg.Wait()
		if closeErr != nil {
			t.Fatalf("round %d: close: %v", round, closeErr)
		}
		outcome := fixture.load(fixture.closingRowOf(poll.Id).ID).Event.GetPollClosed()
		stored := fixture.votesOn(poll.Id)
		switch {
		case voteErr == nil:
			counted++
			if outcome.VoterCount != 2 || stored != 2 || len(outcome.Winners) != 2 {
				t.Errorf("round %d: the vote was accepted, but the outcome is %v over %d stored votes", round, outcome, stored)
			}
		case connect.CodeOf(voteErr) == connect.CodeFailedPrecondition && errors.Is(voteErr, errPollClosed):
			refused++
			if outcome.VoterCount != 1 || stored != 1 || len(outcome.Winners) != 1 {
				t.Errorf("round %d: the vote was refused, but the outcome is %v over %d stored votes", round, outcome, stored)
			}
		default:
			t.Errorf("round %d: vote: %v, want it counted or refused as closed", round, voteErr)
		}
	}
	t.Logf("%d votes counted, %d refused", counted, refused)
}
