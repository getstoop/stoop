package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Polls (docs/architecture/messaging.md → Polls). Nothing votes or closes
// a poll yet, so these tests write votes straight into poll_votes and
// record a closing row with recordEvent, as the RPCs will.

var yesNo = []string{"Yes", "No"}

// poll creates a poll, in the fixture's channel unless the request names
// another.
func (f *systemRows) poll(author context.Context, req *chatv1.CreatePollRequest) *chatv1.Message {
	f.t.Helper()
	if req.ChannelId == "" {
		req.ChannelId = f.channel.ID
	}
	res, err := f.svc.CreatePoll(author, connect.NewRequest(req))
	if err != nil {
		f.t.Fatal(err)
	}
	return res.Msg.Message
}

// vote is voter choosing an option at a moment.
func (f *systemRows) vote(pollID string, voter context.Context, optionID int, at time.Time) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(),
		`INSERT INTO poll_votes (message_id, user_id, option_id, created_at) VALUES ($1, $2, $3, $4)`,
		pollID, authctx.UserID(voter), optionID, at); err != nil {
		f.t.Fatal(err)
	}
}

// votesOn is how many vote rows a poll has.
func (f *systemRows) votesOn(pollID string) int {
	f.t.Helper()
	var count int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM poll_votes WHERE message_id = $1`, pollID).Scan(&count); err != nil {
		f.t.Fatal(err)
	}
	return count
}

// conversation opens the direct message or group conversation of opener
// and others.
func (f *systemRows) conversation(opener context.Context, others ...context.Context) dbgen.Channel {
	f.t.Helper()
	ids := make([]string, len(others))
	for index, other := range others {
		ids[index] = authctx.UserID(other)
	}
	opened, err := f.svc.OpenDirectMessage(opener, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: ids}))
	if err != nil {
		f.t.Fatal(err)
	}
	return f.channelRow(opened.Msg.DirectMessage.Channel.Id)
}

// listedConversation is a conversation as reader's list shows it.
func (f *systemRows) listedConversation(reader context.Context, channelID string) *chatv1.DirectMessage {
	f.t.Helper()
	list, err := f.svc.ListDirectMessages(reader, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, conversation := range list.Msg.DirectMessages {
		if conversation.Channel.Id == channelID {
			return conversation
		}
	}
	f.t.Fatalf("conversation %s is not on the list", channelID)
	return nil
}

func (f *systemRows) activity(reader context.Context) []*chatv1.ActivityItem {
	f.t.Helper()
	feed, err := f.svc.ListActivity(reader, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		f.t.Fatal(err)
	}
	return feed.Msg.Items
}

// everyEvent is every event a subscription receives within a moment.
func everyEvent(sub *events.Subscription) []*realtimev1.ServerEvent {
	var got []*realtimev1.ServerEvent
	for {
		select {
		case event := <-sub.Events():
			got = append(got, event)
		case <-time.After(300 * time.Millisecond):
			return got
		}
	}
}

// typedQuestion is a question that Markdown and the mention reader would
// both change: a preview must show it exactly as typed.
func typedQuestion(mentioned context.Context) string {
	return "*Friday* or _never_, <@u:" + authctx.UserID(mentioned) + ":someone>?"
}

// A poll in a channel is one row by its author: the definition in data,
// the question in content, not quiet. It is published as it is listed,
// becomes the channel's last message, and is unread for everyone but its
// author. Nobody is alerted.
func TestCreatePollInAChannel(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "hello"})
	for _, reader := range []context.Context{fixture.ada, fixture.bea} {
		if _, err := fixture.svc.MarkChannelRead(reader, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: fixture.channel.ID})); err != nil {
			t.Fatal(err)
		}
	}
	space := fixture.svc.bus.(*events.InProcBus).Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()

	const question = "What are we playing on Friday?"
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{
		Question: "  " + question + "\n", Options: []string{" The co-op campaign ", "", "Racing league", "   "},
	})
	wantEvent := &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Poll{Poll: &chatv1.Poll{
		Question: question,
		Options:  []*chatv1.PollOption{{Id: 1, Text: "The co-op campaign"}, {Id: 2, Text: "Racing league"}},
	}}}
	if !proto.Equal(poll.Event, wantEvent) {
		t.Errorf("event = %v, want %v", poll.Event, wantEvent)
	}
	if poll.Content != question || poll.Quiet || !poll.InChannel || poll.Author.GetId() != authctx.UserID(fixture.ada) ||
		poll.Reference != nil || len(poll.MentionUserIds) != 0 || poll.Seq == 0 {
		t.Errorf("poll row = %v, want ada's loud top-level row holding the question", poll)
	}

	var (
		kind    int16
		quiet   bool
		content string
		data    []byte
	)
	if err := fixture.pool.QueryRow(ctx, `SELECT kind, quiet, content, data FROM messages WHERE id = $1`, poll.Id).
		Scan(&kind, &quiet, &content, &data); err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	wantData := map[string]any{
		"question": question,
		"options": []any{
			map[string]any{"id": float64(1), "text": "The co-op campaign"},
			map[string]any{"id": float64(2), "text": "Racing league"},
		},
		"multiple": false, "closed_at": nil, "closed_by": nil,
	}
	if kind != kindPoll || quiet || content != question || !reflect.DeepEqual(stored, wantData) {
		t.Errorf("stored kind %d quiet %v content %q data %s, want kind 7, loud, the question and %v", kind, quiet, content, data, wantData)
	}

	var created []*chatv1.Message
	for _, event := range everyEvent(space) {
		if message := event.GetMessageCreated(); message != nil {
			created = append(created, message)
		}
	}
	if len(created) != 1 || !proto.Equal(created[0], poll) {
		t.Errorf("published %v, want the poll once, as answered", created)
	}
	if listed := fixture.listed(fixture.cat); !proto.Equal(listed[len(listed)-1], poll) {
		t.Errorf("listed %v, want the poll as answered", listed[len(listed)-1])
	}

	if got, want := fixture.state(fixture.bea), (readerState{unread: 1, lastMessageID: poll.Id, spaceHasUnread: true}); got != want {
		t.Errorf("bea after the poll = %+v, want %+v", got, want)
	}
	if got, want := fixture.state(fixture.ada), (readerState{lastMessageID: poll.Id}); got != want {
		t.Errorf("ada after her own poll = %+v, want %+v", got, want)
	}
	for name, reader := range map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea, "cat": fixture.cat} {
		if items := fixture.activity(reader); len(items) != 0 {
			t.Errorf("%s has activity from a poll in a channel: %v", name, items)
		}
	}
}

// The limits are counted in characters after trimming, and a request at
// each limit is stored.
func TestCreatePollAtItsLimits(t *testing.T) {
	fixture := newSystemRows(t)
	question := strings.Repeat("é", maxPollQuestionLen)
	options := make([]string, maxPollOptions)
	for index := range options {
		options[index] = fmt.Sprintf("%d%s", index, strings.Repeat("ü", maxPollOptionLen-1))
	}
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{
		Question: " " + question + " ", Options: append([]string{""}, options...), Multiple: true,
	}).Event.GetPoll()
	if poll.GetQuestion() != question || !poll.GetMultiple() || len(poll.GetOptions()) != maxPollOptions {
		t.Fatalf("poll = %v, want the question, several choices and %d options", poll, maxPollOptions)
	}
	for index, option := range poll.Options {
		if option.Id != int32(index+1) || option.Text != options[index] {
			t.Errorf("option %d = %d %q, want id %d and %q", index, option.Id, option.Text, index+1, options[index])
		}
	}
	// Options that differ by more than case are two options, and a joiner
	// inside an emoji is kept as typed.
	const family = "\U0001F468\u200d\U0001F469\u200d\U0001F467"
	again := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Again?", Options: []string{"Yes", "Yes!", family}})
	if got := again.Event.GetPoll().GetOptions()[2].GetText(); got != family {
		t.Errorf("an emoji option = %q, want it as typed", got)
	}
}

// Each rule refuses on its own, and a refused request stores nothing.
func TestCreatePollValidation(t *testing.T) {
	fixture := newSystemRows(t)
	eleven := make([]string, maxPollOptions+1)
	for index := range eleven {
		eleven[index] = fmt.Sprint("option ", index)
	}
	refused := map[string]*chatv1.CreatePollRequest{
		"no question":                {Question: "", Options: yesNo},
		"a blank question":           {Question: " \t ", Options: yesNo},
		"a question too long":        {Question: strings.Repeat("é", maxPollQuestionLen+1), Options: yesNo},
		"a NUL in the question":      {Question: "Fri\x00day?", Options: yesNo},
		"a line break in a question": {Question: "Friday\nor Saturday?", Options: yesNo},
		"a return in a question":     {Question: "Friday\ror Saturday?", Options: yesNo},
		"a tab in a question":        {Question: "Friday\tor Saturday?", Options: yesNo},
		"a next-line in a question":  {Question: "Friday\u0085or Saturday?", Options: yesNo},
		"a line separator":           {Question: "Friday\u2028or Saturday?", Options: yesNo},
		"a paragraph separator":      {Question: "Friday\u2029or Saturday?", Options: yesNo},
		"a C1 control":               {Question: "Friday\u009b?", Options: yesNo},
		"an escape in an option":     {Question: "Friday?", Options: []string{"Yes", "N\x1bo"}},
		"a direction override":       {Question: "Friday\u202e?", Options: yesNo},
		"a direction isolate":        {Question: "Friday?", Options: []string{"Yes", "\u2066No\u2069"}},
		"an invisible question":      {Question: "\u200b\u2060\ufeff", Options: yesNo},
		"an invisible option":        {Question: "Friday?", Options: []string{"Yes", "No", "\u200b"}},
		"an option of marks alone":   {Question: "Friday?", Options: []string{"Yes", "No", "\u200d\u0301"}},
		"options apart by a joiner":  {Question: "Friday?", Options: []string{"Yes", "No", "Y\u200bes"}},
		"options apart by a mark":    {Question: "Friday?", Options: []string{"Yes", "No", "\ufeffNO"}},
		"options apart by form":      {Question: "Friday?", Options: []string{"Caf\u00e9", "No", "CAFE\u0301"}},
		"no options":                 {Question: "Friday?"},
		"one option":                 {Question: "Friday?", Options: []string{"Yes"}},
		"one option and blanks":      {Question: "Friday?", Options: []string{"Yes", "", "  "}},
		"too many options":           {Question: "Friday?", Options: eleven},
		"an option too long":         {Question: "Friday?", Options: []string{"Yes", strings.Repeat("ü", maxPollOptionLen+1)}},
		"a NUL in an option":         {Question: "Friday?", Options: []string{"Yes", "N\x00o"}},
		"a line break in an option":  {Question: "Friday?", Options: []string{"Yes", "No\nMaybe"}},
		"the same option twice":      {Question: "Friday?", Options: []string{"Yes", "No", "Yes"}},
		"an option in another case":  {Question: "Friday?", Options: []string{"Yes", "No", "YES"}},
		"an option again, padded":    {Question: "Friday?", Options: []string{"Yes", "No", "  no "}},
	}
	for name, req := range refused {
		req.ChannelId = fixture.channel.ID
		if _, err := fixture.svc.CreatePoll(fixture.ada, connect.NewRequest(req)); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: err = %v, want InvalidArgument", name, err)
		}
	}
	if listed := fixture.listed(fixture.ada); len(listed) != 0 {
		t.Errorf("refused polls were stored: %v", listed)
	}
}

// Whoever may send a message may create a poll, and nobody else: a
// member of an announcement channel and someone outside the space are
// refused as their message would be.
func TestCreatePollNeedsToBeAbleToPost(t *testing.T) {
	fixture := newSystemRows(t)
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if _, err := fixture.svc.UpdateChannel(fixture.ada, connect.NewRequest(&chatv1.UpdateChannelRequest{
		ChannelId: fixture.channel.ID, PostPolicy: &policy,
	})); err != nil {
		t.Fatal(err)
	}
	create := func(author context.Context) error {
		_, err := fixture.svc.CreatePoll(author, connect.NewRequest(&chatv1.CreatePollRequest{
			ChannelId: fixture.channel.ID, Question: "Friday?", Options: yesNo,
		}))
		return err
	}
	if err := create(fixture.cat); connect.CodeOf(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "announcement channel") {
		t.Errorf("a member in an announcement channel: err = %v, want the announcement refusal", err)
	}
	if err := create(fixture.ada); err != nil {
		t.Errorf("the owner in an announcement channel: %v", err)
	}
	outsider := authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: newOutsider(t, fixture), Role: authctx.RoleMember,
	})
	if err := create(outsider); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("someone outside the space: err = %v, want PermissionDenied", err)
	}
	var polls int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE kind = $1`, kindPoll).Scan(&polls); err != nil {
		t.Fatal(err)
	}
	if polls != 1 {
		t.Errorf("%d polls stored, want the owner's alone", polls)
	}
}

func newOutsider(t *testing.T, fixture *systemRows) string {
	t.Helper()
	var id string
	if err := fixture.pool.QueryRow(context.Background(),
		`INSERT INTO users (id, username, password_hash, role) VALUES (gen_random_uuid(), 'dan', '', 'member') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// In a direct message and in a group conversation a poll behaves as a
// message does: it puts a closed conversation back on the others' lists,
// is their unread last message, and alerts each of them once, previewed
// by its question exactly as typed. Its author is told nothing.
func TestCreatePollInAConversation(t *testing.T) {
	for name, size := range map[string]int{"direct message": 1, "group conversation": 2} {
		t.Run(name, func(t *testing.T) {
			fixture := newSystemRows(t)
			others := []context.Context{fixture.bea, fixture.cat}[:size]
			conversation := fixture.conversation(fixture.ada, others...)
			for _, other := range others {
				if _, err := fixture.svc.SetDirectMessageClosed(other, connect.NewRequest(&chatv1.SetDirectMessageClosedRequest{
					ChannelId: conversation.ID, Closed: true,
				})); err != nil {
					t.Fatal(err)
				}
			}
			bea := fixture.svc.bus.(*events.InProcBus).Subscribe(events.UserTopic(authctx.UserID(fixture.bea)))
			defer bea.Close()

			question := typedQuestion(fixture.bea)
			want := "Poll: " + question
			poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: question, Options: yesNo})
			if poll.Event.GetPoll().GetQuestion() != question || len(poll.MentionUserIds) != 0 {
				t.Errorf("poll = %v, want the question as typed and nobody mentioned", poll)
			}

			for _, other := range others {
				listed := fixture.listedConversation(other, conversation.ID)
				if listed.Closed || listed.Channel.UnreadCount != 1 || listed.LastMessage.GetMessageId() != poll.Id ||
					listed.LastMessage.GetPreview() != want || listed.LastMessage.GetAuthor().GetId() != authctx.UserID(fixture.ada) {
					t.Errorf("the conversation for someone else = %v, want it reopened, one unread, last message %q", listed, want)
				}
				items := fixture.activity(other)
				if len(items) != 1 || items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_DM || items[0].MessageId != poll.Id ||
					items[0].ChannelId != conversation.ID || items[0].Preview != want || items[0].ReadAt != nil {
					t.Fatalf("activity for someone else = %v, want one unread dm item previewed %q", items, want)
				}
				// What push reads before it sends.
				pending, err := fixture.svc.PendingActivity(context.Background(), authctx.UserID(other), items[0].Id)
				if err != nil || pending.GetPreview() != want {
					t.Errorf("pending activity = %v, %v; want it previewed %q", pending, err, want)
				}
			}
			mine := fixture.listedConversation(fixture.ada, conversation.ID)
			if mine.Channel.UnreadCount != 0 || mine.LastMessage.GetMessageId() != poll.Id {
				t.Errorf("the conversation for the author = %v, want it read up to the poll", mine)
			}
			if items := fixture.activity(fixture.ada); len(items) != 0 {
				t.Errorf("the author has activity for their own poll: %v", items)
			}

			var reopened, created, alerted int
			for _, event := range everyEvent(bea) {
				switch {
				case event.GetChannelCreated().GetId() == conversation.ID:
					reopened++
				case proto.Equal(event.GetMessageCreated(), poll):
					created++
				case event.GetActivityItemCreated().GetItem().GetPreview() == want:
					alerted++
				}
			}
			if reopened != 1 || created != 1 || alerted != 1 {
				t.Errorf("bea heard %d reopen, %d poll, %d alert previewed %q; want one of each", reopened, created, alerted, want)
			}
		})
	}
}

// closing records a poll's closing row by closer, as closing it will.
func (f *systemRows) closing(closer context.Context, channel dbgen.Channel, poll *chatv1.Message) messageRow {
	f.t.Helper()
	return f.record(closer, channel, pollClosed{
		PollID: poll.Id, Question: poll.Content,
		Winners: []pollWinner{{Text: "Yes", Votes: 2}}, Voters: 3,
	})
}

// A closing row reads back as its snapshot and refers to its poll. It is
// loud, and wherever it is previewed it reads "Poll closed:" and the
// question as typed; its excerpt of the poll reads "Poll:".
func TestClosingRowAndItsPreviews(t *testing.T) {
	fixture := newSystemRows(t)
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	question := typedQuestion(fixture.bea)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: question, Options: yesNo})
	row := fixture.closing(fixture.ada, conversation, poll)

	closed := fixture.load(row.ID)
	wantEvent := &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_PollClosed{PollClosed: &chatv1.PollClosed{
		Question: question, Winners: []*chatv1.PollWinner{{Text: "Yes", Votes: 2}}, VoterCount: 3,
	}}}
	if !proto.Equal(closed.Event, wantEvent) || closed.Content != question || closed.Quiet {
		t.Errorf("closing row = %v, want the snapshot, the question in content, loud", closed)
	}
	if reference := closed.Reference; reference.GetMessageId() != poll.Id || reference.GetAuthor().GetId() != authctx.UserID(fixture.ada) ||
		reference.GetPreview() != "Poll: "+question {
		t.Errorf("closing row's reference = %v, want the live poll excerpted as %q", reference, "Poll: "+question)
	}

	want := "Poll closed: " + question
	listed := fixture.listedConversation(fixture.bea, conversation.ID)
	if listed.Channel.UnreadCount != 2 || listed.LastMessage.GetMessageId() != row.ID || listed.LastMessage.GetPreview() != want {
		t.Errorf("the conversation = %v, want two unread and last message %q", listed, want)
	}
	// The alert a close will raise, through the same step a message's takes.
	participants, err := fixture.svc.people(context.Background(), conversation)
	if err != nil {
		t.Fatal(err)
	}
	fixture.svc.recordActivity(context.Background(), row, conversation, participants, nil, nil, closed.Author, nil)
	items := fixture.activity(fixture.bea)
	if len(items) != 1 || items[0].MessageId != row.ID || items[0].Preview != want {
		t.Fatalf("activity = %v, want the one dm item moved to the closing row, previewed %q", items, want)
	}
	pending, err := fixture.svc.PendingActivity(context.Background(), authctx.UserID(fixture.bea), items[0].Id)
	if err != nil || pending.GetPreview() != want {
		t.Errorf("pending activity = %v, %v; want it previewed %q", pending, err, want)
	}
	if items := fixture.activity(fixture.ada); len(items) != 0 {
		t.Errorf("the closer has activity for their own close: %v", items)
	}
}

// A message's own preview is untouched by the poll wording: the same
// words sent as a message are excerpted as Markdown with current names.
func TestMessagePreviewsStillReadMarkdown(t *testing.T) {
	fixture := newSystemRows(t)
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	fixture.send(fixture.ada, &chatv1.SendMessageRequest{ChannelId: conversation.ID, Content: typedQuestion(fixture.bea)})
	// As plainText reads it: the asterisks gone, the mention by its name.
	const want = "Friday or _never_, @bea?"
	if got := fixture.listedConversation(fixture.bea, conversation.ID).LastMessage.GetPreview(); got != want {
		t.Errorf("a message's conversation preview = %q, want %q", got, want)
	}
	if items := fixture.activity(fixture.bea); len(items) != 1 || items[0].Preview != want {
		t.Errorf("a message's activity = %v, want it previewed %q", items, want)
	}
}

// A poll's votes come with it wherever it is read, as people: by option
// in the order they voted, someone who has left the space since still
// named, and the count is of people, not of choices.
func TestPollIsReadWithItsVoters(t *testing.T) {
	fixture := newSystemRows(t)
	plain := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "hello"})
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{
		Question: "Which nights?", Options: []string{"Friday", "Saturday", "Sunday"}, Multiple: true,
	})
	other := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Snacks?", Options: yesNo})
	at := time.Now().Add(-time.Hour)
	fixture.vote(poll.Id, fixture.cat, 1, at.Add(2*time.Minute))
	fixture.vote(poll.Id, fixture.bea, 1, at.Add(time.Minute))
	fixture.vote(poll.Id, fixture.cat, 2, at.Add(2*time.Minute))
	fixture.vote(poll.Id, fixture.ada, 2, at.Add(3*time.Minute))
	fixture.vote(other.Id, fixture.bea, 2, at)
	if _, err := fixture.svc.LeaveSpace(fixture.cat, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: fixture.spaceID})); err != nil {
		t.Fatal(err)
	}

	names := func(option *chatv1.PollOption) string {
		var voters []string
		for _, voter := range option.Voters {
			voters = append(voters, voter.Username)
		}
		return strings.Join(voters, ",")
	}
	check := func(where string, message *chatv1.Message) {
		t.Helper()
		got := message.GetEvent().GetPoll()
		if got == nil || len(got.Options) != 3 {
			t.Fatalf("%s: poll = %v, want its three options", where, message)
		}
		if names(got.Options[0]) != "bea,cat" || names(got.Options[1]) != "cat,ada" || names(got.Options[2]) != "" || got.VoterCount != 3 {
			t.Errorf("%s: voters = %q, %q, %q of %d people; want bea,cat / cat,ada / none of 3",
				where, names(got.Options[0]), names(got.Options[1]), names(got.Options[2]), got.VoterCount)
		}
		if voter := got.Options[1].Voters[0]; voter.Id != authctx.UserID(fixture.cat) {
			t.Errorf("%s: a voter = %v, want cat by id", where, voter)
		}
	}
	listed := fixture.listed(fixture.bea)
	if got := messageIDs(listed); fmt.Sprint(got) != fmt.Sprint([]string{plain.Id, poll.Id, other.Id}) {
		t.Fatalf("listed %v, want the message and both polls", got)
	}
	check("history", listed[1])
	if snacks := listed[2].Event.GetPoll(); names(snacks.Options[0]) != "" || names(snacks.Options[1]) != "bea" || snacks.VoterCount != 1 {
		t.Errorf("the other poll on the page = %v, want only its own vote", snacks)
	}
	if listed[0].Event != nil {
		t.Errorf("a message beside a poll got an event: %v", listed[0])
	}
	check("one message", fixture.load(poll.Id))
	changes, err := fixture.svc.ListChanges(fixture.bea, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: fixture.channel.ID, SinceSeq: plain.Seq}))
	if err != nil {
		t.Fatal(err)
	}
	check("changes", changes.Msg.Messages[0])
}

// Search finds a poll by its question, with its votes, and nothing else
// of it: not an option, and not its closing row, which repeats the
// question.
func TestSearchFindsAPollByItsQuestion(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{
		Question: "Who is bringing the zanzibar board?", Options: []string{"Quokka", "No"},
	})
	fixture.vote(poll.Id, fixture.cat, 1, time.Now())
	fixture.closing(fixture.ada, fixture.channel, poll)
	search := func(query string) []*chatv1.Message {
		t.Helper()
		found, err := fixture.svc.SearchMessages(fixture.bea, connect.NewRequest(&chatv1.SearchMessagesRequest{
			Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: fixture.spaceID}, Query: query,
		}))
		if err != nil {
			t.Fatalf("search %q: %v", query, err)
		}
		return found.Msg.Messages
	}
	found := search("zanzibar")
	if got := messageIDs(found); fmt.Sprint(got) != fmt.Sprint([]string{poll.Id}) {
		t.Fatalf("search for the question = %v, want only the poll %s", got, poll.Id)
	}
	if option := found[0].Event.GetPoll().GetOptions()[0]; len(option.Voters) != 1 || option.Voters[0].Username != "cat" {
		t.Errorf("the hit's first option = %v, want cat's vote", option)
	}
	if got := search("quokka"); len(got) != 0 {
		t.Errorf("search for an option = %v, want nothing", messageIDs(got))
	}
}

// The registry's flags: only a poll is pinnable and its author's to
// delete, and neither poll kind is quiet.
func TestPollKindFlags(t *testing.T) {
	for kind, registered := range systemKinds {
		want := systemKind{quiet: true}
		switch kind {
		case kindPoll:
			want = systemKind{pinnable: true, authorDeletes: true}
		case kindPollClosed:
			want = systemKind{}
		}
		if registered.quiet != want.quiet || registered.pinnable != want.pinnable || registered.authorDeletes != want.authorDeletes {
			t.Errorf("kind %d: quiet %v pinnable %v authorDeletes %v, want %v %v %v", kind,
				registered.quiet, registered.pinnable, registered.authorDeletes, want.quiet, want.pinnable, want.authorDeletes)
		}
	}
}

// A poll is pinned by whoever may pin a message, and the pin's row
// excerpts it by its question as typed. Its closing row is not pinnable,
// and a conversation has no pins for either.
func TestPinningAPoll(t *testing.T) {
	fixture := newSystemRows(t)
	question := typedQuestion(fixture.bea)
	poll := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: question, Options: yesNo})
	fixture.vote(poll.Id, fixture.bea, 1, time.Now())
	closing := fixture.closing(fixture.cat, fixture.channel, poll)

	if err := fixture.setPinned(fixture.cat, poll.Id, true); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member pinning their own poll: err = %v, want PermissionDenied", err)
	}
	if err := fixture.setPinned(fixture.ada, poll.Id, true); err != nil {
		t.Fatalf("the owner pinning a poll: %v", err)
	}
	if err := fixture.setPinned(fixture.ada, closing.ID, true); connect.CodeOf(err) != connect.CodeFailedPrecondition || !errors.Is(err, errSystemMessage) {
		t.Errorf("pinning a closing row: err = %v, want the system-message refusal", err)
	}
	listed := fixture.listed(fixture.bea)
	pinRow := listed[len(listed)-1]
	if pinRow.Event.GetPin() == nil || pinRow.Reference.GetMessageId() != poll.Id || pinRow.Reference.GetPreview() != "Poll: "+question {
		t.Errorf("the pin's row = %v, want it about the poll, excerpted %q", pinRow, "Poll: "+question)
	}
	pins, err := fixture.svc.ListPinnedMessages(fixture.bea, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{ChannelId: fixture.channel.ID}))
	if err != nil {
		t.Fatal(err)
	}
	if len(pins.Msg.Pins) != 1 || pins.Msg.Pins[0].Message.Id != poll.Id || !pins.Msg.Pins[0].Message.Pinned ||
		len(pins.Msg.Pins[0].Message.Event.GetPoll().GetOptions()[0].GetVoters()) != 1 {
		t.Errorf("pins = %v, want the poll alone, with its vote", pins.Msg.Pins)
	}

	conversation := fixture.conversation(fixture.ada, fixture.bea)
	private := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: "Friday?", Options: yesNo})
	if err := fixture.setPinned(fixture.ada, private.Id, true); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("pinning a poll in a conversation: err = %v, want InvalidArgument", err)
	}
}

// A poll is deleted as a message is: by its author, or by a moderator in
// a space. Its closing row is moderation's alone, like any system row.
func TestDeletingAPoll(t *testing.T) {
	fixture := newSystemRows(t)
	remove := func(person context.Context, messageID string) error {
		_, err := fixture.svc.DeleteMessage(person, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: messageID}))
		return err
	}
	ask := func(author context.Context, channelID string) *chatv1.Message {
		return fixture.poll(author, &chatv1.CreatePollRequest{ChannelId: channelID, Question: "Friday?", Options: yesNo})
	}

	own := ask(fixture.cat, "")
	if err := remove(fixture.bea, own.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member deleting someone else's poll: err = %v, want PermissionDenied", err)
	}
	if fixture.load(own.Id).Deleted {
		t.Fatal("the refused delete went through")
	}
	if err := remove(fixture.cat, own.Id); err != nil {
		t.Errorf("a member deleting their own poll: %v", err)
	}
	if err := remove(fixture.ada, ask(fixture.cat, "").Id); err != nil {
		t.Errorf("the owner deleting a member's poll: %v", err)
	}

	kept := ask(fixture.cat, "")
	closing := fixture.closing(fixture.cat, fixture.channel, kept)
	if err := remove(fixture.cat, closing.ID); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member deleting the closing row they caused: err = %v, want PermissionDenied", err)
	}
	if err := remove(fixture.ada, closing.ID); err != nil {
		t.Errorf("the owner deleting a closing row: %v", err)
	}
	if fixture.load(kept.Id).Deleted {
		t.Error("deleting a closing row deleted its poll")
	}

	// A conversation has no moderator: the author, and nobody else.
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	theirs := ask(fixture.bea, conversation.ID)
	theirClosing := fixture.closing(fixture.bea, conversation, theirs)
	for name, person := range map[string]context.Context{"its author": fixture.bea, "the other person": fixture.ada} {
		if err := remove(person, theirClosing.ID); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s deleting a closing row in a conversation: err = %v, want PermissionDenied", name, err)
		}
	}
	if err := remove(fixture.ada, theirs.Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("the other person deleting a poll in a conversation: err = %v, want PermissionDenied", err)
	}
	if err := remove(fixture.bea, theirs.Id); err != nil {
		t.Errorf("the author deleting their poll in a conversation: %v", err)
	}
}

// Deleting a poll takes its votes and its question, and the channel's
// last message goes back to what is left.
func TestDeletedPollLosesItsVotes(t *testing.T) {
	fixture := newSystemRows(t)
	before := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "hello"})
	poll := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: "Secret plans?", Options: yesNo, Multiple: true})
	spared := fixture.poll(fixture.cat, &chatv1.CreatePollRequest{Question: "Snacks?", Options: yesNo})
	fixture.vote(poll.Id, fixture.bea, 1, time.Now())
	fixture.vote(poll.Id, fixture.bea, 2, time.Now())
	fixture.vote(poll.Id, fixture.ada, 2, time.Now())
	fixture.vote(spared.Id, fixture.ada, 1, time.Now())
	if _, err := fixture.svc.DeleteMessage(fixture.cat, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: poll.Id})); err != nil {
		t.Fatal(err)
	}
	if left, others := fixture.votesOn(poll.Id), fixture.votesOn(spared.Id); left != 0 || others != 1 {
		t.Errorf("after the delete: %d votes on the poll, %d on another; want 0 and 1", left, others)
	}
	var (
		kind    int16
		data    string
		content string
	)
	if err := fixture.pool.QueryRow(context.Background(), `SELECT kind, data::text, content FROM messages WHERE id = $1`, poll.Id).
		Scan(&kind, &data, &content); err != nil {
		t.Fatal(err)
	}
	if kind != kindPoll || data != "{}" || content != "" {
		t.Errorf("the tombstone = kind %d data %s content %q, want its kind, {} and no question", kind, data, content)
	}
	if got := messageIDs(fixture.listed(fixture.bea)); fmt.Sprint(got) != fmt.Sprint([]string{before.Id, spared.Id}) {
		t.Errorf("history after the delete = %v, want the message and the other poll", got)
	}
	changes, err := fixture.svc.ListChanges(fixture.bea, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: fixture.channel.ID, SinceSeq: spared.Seq}))
	if err != nil {
		t.Fatal(err)
	}
	if rows := changes.Msg.Messages; len(rows) != 1 || rows[0].Id != poll.Id || !rows[0].Deleted || strings.Contains(rows[0].String(), "Secret") ||
		len(rows[0].Event.GetPoll().GetOptions()) != 0 {
		t.Errorf("ListChanges = %v, want the poll deleted with nothing of it", rows)
	}
	if _, err := fixture.svc.DeleteMessage(fixture.cat, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: spared.Id})); err != nil {
		t.Fatal(err)
	}
	if got := fixture.state(fixture.bea).lastMessageID; got != before.Id {
		t.Errorf("last message after both polls went = %s, want the message %s", got, before.Id)
	}
}

// A poll and its closing row still refuse what only a message someone
// wrote takes: an edit, a reaction, a thread, a quote, a dismissed
// preview. Pinning is the one write a poll lets through.
func TestPollRowsRefuseWhatAPersonWrote(t *testing.T) {
	fixture := newSystemRows(t)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{Question: "Friday?", Options: yesNo})
	closing := fixture.closing(fixture.ada, fixture.channel, poll)
	for name, messageID := range map[string]string{"poll": poll.Id, "closing row": closing.ID} {
		for write, err := range fixture.guardedWrites(fixture.ada, messageID) {
			if write == "pin" && messageID == poll.Id {
				if err != nil {
					t.Errorf("%s, %s: err = %v, want it pinned", name, write, err)
				}
				continue
			}
			if connect.CodeOf(err) != connect.CodeFailedPrecondition || !errors.Is(err, errSystemMessage) {
				t.Errorf("%s, %s: err = %v, want the system-message refusal", name, write, err)
			}
		}
		message := fixture.load(messageID)
		if message.Deleted || len(message.Reactions) > 0 || message.Thread != nil || message.EditedAt != nil || message.Content != "Friday?" {
			t.Errorf("%s after the refusals = %v, want it as it was", name, message)
		}
	}
	for _, message := range fixture.listed(fixture.ada) {
		if message.Content == "in a thread" || message.Content == "quoting" {
			t.Errorf("a refused send was stored: %v", message)
		}
	}
}

// Validation runs before the caller's access is known, so a flood of
// options is refused at the first one past the limit, with none of the
// rest read or compared.
func TestCreatePollRefusesAFloodOfOptions(t *testing.T) {
	flood := make([]string, 200_000)
	for index := range flood {
		flood[index] = fmt.Sprint("option ", index)
	}
	// Past the limit only: a refusal for any of these would mean it was read.
	for index := maxPollOptions + 1; index < len(flood); index += 1000 {
		flood[index] = "line\nbreak"
	}
	flood[maxPollOptions+1] = flood[0]
	started := time.Now()
	_, err := newPoll("Friday?", flood, false)
	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "2 to 10 options") {
		t.Errorf("err = %v, want the option count refusal", err)
	}
	if took := time.Since(started); took > 100*time.Millisecond {
		t.Errorf("refusing %d options took %v", len(flood), took)
	}
	// Blank options are dropped, however many: they are not options.
	blanks := append(make([]string, 50_000), yesNo...)
	if poll, err := newPoll("Friday?", blanks, false); err != nil || len(poll.Options) != 2 {
		t.Errorf("a poll among blanks = %v, %v; want its two options", poll.Options, err)
	}
}

// A poll is refused wherever its author's message would be: outside a
// private channel, outside a conversation, and in a direct message with
// a block in it.
func TestCreatePollWhereAMessageIsRefused(t *testing.T) {
	fixture := newSystemRows(t)
	create := func(author context.Context, channelID string) error {
		_, err := fixture.svc.CreatePoll(author, connect.NewRequest(&chatv1.CreatePollRequest{
			ChannelId: channelID, Question: "Friday?", Options: yesNo,
		}))
		return err
	}
	send := func(author context.Context, channelID string) error {
		_, err := fixture.svc.SendMessage(author, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "Friday?"}))
		return err
	}
	private, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "back-room", Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	pair := fixture.conversation(fixture.ada, fixture.bea)
	blocked := fixture.conversation(fixture.ada, fixture.cat)
	if _, err := fixture.svc.BlockUser(fixture.cat, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(fixture.ada)})); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name      string
		author    context.Context
		channelID string
		want      connect.Code
	}{
		{"a member outside a private channel", fixture.bea, private.Msg.Channel.Id, connect.CodeNotFound},
		{"someone outside a conversation", fixture.cat, pair.ID, connect.CodePermissionDenied},
		{"the blocked person in a direct message", fixture.ada, blocked.ID, connect.CodePermissionDenied},
		{"the blocker in a direct message", fixture.cat, blocked.ID, connect.CodePermissionDenied},
	}
	for _, refused := range cases {
		err := create(refused.author, refused.channelID)
		if connect.CodeOf(err) != refused.want {
			t.Errorf("%s: err = %v, want %v", refused.name, err, refused.want)
		}
		// The same answer a message gets there.
		if sent := send(refused.author, refused.channelID); connect.CodeOf(sent) != connect.CodeOf(err) {
			t.Errorf("%s: a poll answers %v where a message answers %v", refused.name, err, sent)
		}
	}
	if err := create(fixture.ada, private.Msg.Channel.Id); err != nil {
		t.Errorf("someone in the private channel: %v", err)
	}
	var polls int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE kind = $1`, kindPoll).Scan(&polls); err != nil {
		t.Fatal(err)
	}
	if polls != 1 {
		t.Errorf("%d polls stored, want the one allowed", polls)
	}
}

// A long question is cut to the preview length with its wording first,
// as any preview is.
func TestLongPollQuestionIsCutInPreviews(t *testing.T) {
	fixture := newSystemRows(t)
	conversation := fixture.conversation(fixture.ada, fixture.bea)
	question := strings.Repeat("é", maxPollQuestionLen)
	poll := fixture.poll(fixture.ada, &chatv1.CreatePollRequest{ChannelId: conversation.ID, Question: question, Options: yesNo})
	want := "Poll: " + strings.Repeat("é", previewLen-len("Poll: ")-1) + "…"
	if got := fixture.listedConversation(fixture.bea, conversation.ID).LastMessage.GetPreview(); got != want {
		t.Errorf("the conversation's preview = %q, want %q", got, want)
	}
	if items := fixture.activity(fixture.bea); len(items) != 1 || items[0].Preview != want {
		t.Errorf("activity = %v, want it previewed %q", items, want)
	}
	// The poll itself keeps the whole question.
	if got := fixture.load(poll.Id).Event.GetPoll().GetQuestion(); got != question {
		t.Errorf("the poll's question was cut to %d characters", len([]rune(got)))
	}
}
