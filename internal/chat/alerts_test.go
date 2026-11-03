package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
)

// alertsFixture is a space with three people and its default channel,
// with readers for the counts the badges show.
type alertsFixture struct {
	t                *testing.T
	pool             *pgxpool.Pool
	svc              *chat.Service
	owner, bea, cass context.Context
	spaceID          string
	channelID        string
}

func newAlertsFixture(t *testing.T) *alertsFixture {
	t.Helper()
	pool, _, svc := newTestService(t)
	fixture := &alertsFixture{
		t: t, pool: pool, svc: svc,
		owner: newUser(t, pool, "ada", authctx.RoleMember),
		bea:   newUser(t, pool, "bea", authctx.RoleMember),
		cass:  newUser(t, pool, "cass", authctx.RoleMember),
	}
	sp, err := svc.CreateSpace(fixture.owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	fixture.spaceID, fixture.channelID = sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, err := svc.CreateInvite(fixture.owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: fixture.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, person := range []context.Context{fixture.bea, fixture.cass} {
		if _, err := svc.JoinSpace(person, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	return fixture
}

// send posts in the default channel unless the request names another.
func (f *alertsFixture) send(ctx context.Context, req *chatv1.SendMessageRequest) *chatv1.Message {
	f.t.Helper()
	if req.ChannelId == "" {
		req.ChannelId = f.channelID
	}
	res, err := f.svc.SendMessage(ctx, connect.NewRequest(req))
	if err != nil {
		f.t.Fatal(err)
	}
	return res.Msg.Message
}

// channelAlerts is a channel's alert_count as ctx lists it.
func (f *alertsFixture) channelAlerts(ctx context.Context, channelID string) int32 {
	f.t.Helper()
	res, err := f.svc.ListChannels(ctx, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: f.spaceID}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, channel := range res.Msg.Channels {
		if channel.Id == channelID {
			return channel.AlertCount
		}
	}
	f.t.Fatalf("channel %s not listed", channelID)
	return 0
}

// spaceAlerts is the space's alert_count as ctx lists it.
func (f *alertsFixture) spaceAlerts(ctx context.Context) int32 {
	f.t.Helper()
	res, err := f.svc.ListSpaces(ctx, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, space := range res.Msg.Spaces {
		if space.Id == f.spaceID {
			return space.AlertCount
		}
	}
	f.t.Fatalf("space %s not listed", f.spaceID)
	return 0
}

// expect checks the default channel's and the space's counts for ctx.
func (f *alertsFixture) expect(ctx context.Context, who string, channel, space int32) {
	f.t.Helper()
	if got := f.channelAlerts(ctx, f.channelID); got != channel {
		f.t.Errorf("%s: channel alert_count = %d, want %d", who, got, channel)
	}
	if got := f.spaceAlerts(ctx); got != space {
		f.t.Errorf("%s: space alert_count = %d, want %d", who, got, space)
	}
}

func (f *alertsFixture) markChannelRead(ctx context.Context, messageID string) {
	f.t.Helper()
	if _, err := f.svc.MarkChannelRead(ctx, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: f.channelID, MessageId: messageID})); err != nil {
		f.t.Fatal(err)
	}
}

// A mention lights the channel and its space for the person mentioned;
// mentioning yourself lights nothing; @channel lights it for everyone
// else; and the author's own message, which moves their marker, clears
// what came before it.
func TestAlertCountsMentions(t *testing.T) {
	fixture := newAlertsFixture(t)
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " the gate is open"})
	fixture.expect(fixture.bea, "bea after a mention", 1, 1)
	fixture.expect(fixture.cass, "cass, not mentioned", 0, 0)
	fixture.expect(fixture.owner, "the author", 0, 0)

	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.owner) + " note to self"})
	fixture.expect(fixture.owner, "self-mention", 0, 0)

	// Only the owner or an admin can mention the channel.
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: "@channel game night"})
	fixture.expect(fixture.bea, "bea after @channel", 2, 2)
	fixture.expect(fixture.cass, "cass after @channel", 1, 1)
	fixture.expect(fixture.owner, "owner after @channel", 0, 0)

	// Sending marks the channel read up to the new message.
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "on my way"})
	fixture.expect(fixture.bea, "bea after her own message", 0, 0)
	fixture.expect(fixture.cass, "cass after bea's message", 1, 1)
}

// A reply to your message counts; a reply to someone else's does not,
// and neither does replying to yourself.
func TestAlertCountsReplies(t *testing.T) {
	fixture := newAlertsFixture(t)
	beas := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "anyone around?"})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: "here", ReplyToMessageId: beas.Id})
	fixture.expect(fixture.bea, "bea, replied to", 1, 1)
	fixture.expect(fixture.cass, "cass, a bystander", 0, 0)
	fixture.expect(fixture.owner, "the replier", 0, 0)

	mine := fixture.send(fixture.cass, &chatv1.SendMessageRequest{Content: "me too"})
	fixture.send(fixture.cass, &chatv1.SendMessageRequest{Content: "(and again)", ReplyToMessageId: mine.Id})
	// Cass's marker moved with her own messages; the reply to bea is older.
	fixture.expect(fixture.cass, "cass replying to herself", 0, 0)

	// A reply that also mentions the person it answers is one alert.
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " still here", ReplyToMessageId: beas.Id})
	fixture.expect(fixture.bea, "bea, replied to with a mention", 2, 2)
}

// Reading the channel clears it; reading up to an earlier message leaves
// what came after.
func TestAlertCountsFollowTheChannelMarker(t *testing.T) {
	fixture := newAlertsFixture(t)
	first := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " one"})
	second := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " two"})
	fixture.expect(fixture.bea, "two mentions", 2, 2)

	fixture.markChannelRead(fixture.bea, first.Id)
	fixture.expect(fixture.bea, "read up to the first", 1, 1)

	fixture.markChannelRead(fixture.bea, second.Id)
	fixture.expect(fixture.bea, "read to the end", 0, 0)

	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " three"})
	fixture.expect(fixture.bea, "a mention after the read", 1, 1)
	fixture.markChannelRead(fixture.bea, "")
	fixture.expect(fixture.bea, "read to the newest", 0, 0)
}

// A mention in a reply only its thread shows counts against the thread's
// marker: a channel read leaves it, a thread read clears it. A reply also
// sent to the channel counts against the channel's marker only.
func TestAlertCountsInThreads(t *testing.T) {
	fixture := newAlertsFixture(t)
	root := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: "thread starts here"})
	inThread := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " in the thread", ThreadRootId: root.Id})
	fixture.expect(fixture.bea, "mention in a thread-only reply", 1, 1)

	fixture.markChannelRead(fixture.bea, "")
	fixture.expect(fixture.bea, "after reading the channel", 1, 1)

	if _, err := fixture.svc.MarkThreadRead(fixture.bea, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id, ReplyId: inThread.Id})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "after reading the thread", 0, 0)

	// A reply to bea's own reply in the thread counts the same way.
	beas := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "noted", ThreadRootId: root.Id})
	fixture.send(fixture.cass, &chatv1.SendMessageRequest{Content: "good", ThreadRootId: root.Id, ReplyToMessageId: beas.Id})
	fixture.expect(fixture.bea, "reply to her thread reply", 1, 1)
	if _, err := fixture.svc.MarkThreadRead(fixture.bea, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "thread read again", 0, 0)

	// Also sent to the channel: the channel's marker is the one that counts.
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " for everyone", ThreadRootId: root.Id, AlsoSendToChannel: true})
	fixture.expect(fixture.bea, "mention in a reply also sent to the channel", 1, 1)
	if _, err := fixture.svc.MarkThreadRead(fixture.bea, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "thread read leaves an also-sent reply", 1, 1)
	fixture.markChannelRead(fixture.bea, "")
	fixture.expect(fixture.bea, "channel read clears an also-sent reply", 0, 0)
}

// A deleted message stops counting, and a blocked author never counts.
func TestAlertCountsSkipDeletedAndBlocked(t *testing.T) {
	fixture := newAlertsFixture(t)
	beas := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "a question"})
	mention := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " one"})
	reply := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: "an answer", ReplyToMessageId: beas.Id})
	fixture.expect(fixture.bea, "a mention and a reply", 2, 2)

	for _, id := range []string{mention.Id, reply.Id} {
		if _, err := fixture.svc.DeleteMessage(fixture.owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
			t.Fatal(err)
		}
	}
	fixture.expect(fixture.bea, "both deleted", 0, 0)

	fixture.send(fixture.cass, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " from cass"})
	fixture.send(fixture.cass, &chatv1.SendMessageRequest{Content: "also from cass", ReplyToMessageId: beas.Id})
	fixture.expect(fixture.bea, "before the block", 2, 2)
	if _, err := fixture.svc.BlockUser(fixture.bea, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(fixture.cass)})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "after blocking cass", 0, 0)
	// The other way round silences nothing: cass being blocked by someone
	// else is not bea's business.
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " from ada"})
	fixture.expect(fixture.bea, "a mention by someone unblocked", 1, 1)
}

// A channel mute, a space mute and a thread mute each zero what they
// cover and nothing else.
func TestAlertCountsHonourMutes(t *testing.T) {
	fixture := newAlertsFixture(t)
	side, err := fixture.svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: fixture.spaceID, Name: "side"}))
	if err != nil {
		t.Fatal(err)
	}
	sideID := side.Msg.Channel.Id
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " in general"})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{ChannelId: sideID, Content: mentionOf(fixture.bea) + " on the side"})
	fixture.expect(fixture.bea, "two channels", 1, 2)

	if _, err := fixture.svc.SetChannelMuted(fixture.bea, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: sideID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "side muted", 1, 1)
	if got := fixture.channelAlerts(fixture.bea, sideID); got != 0 {
		t.Errorf("muted channel alert_count = %d, want 0", got)
	}

	if _, err := fixture.svc.SetSpaceMuted(fixture.bea, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: fixture.spaceID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "space muted", 0, 0)
	if _, err := fixture.svc.SetSpaceMuted(fixture.bea, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: fixture.spaceID, Muted: false})); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.SetChannelMuted(fixture.bea, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: sideID, Muted: false})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "unmuted again", 1, 2)

	root := fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: "a thread"})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.bea) + " in it", ThreadRootId: root.Id})
	fixture.expect(fixture.bea, "mention in a thread", 2, 3)
	if _, err := fixture.svc.SetThreadMuted(fixture.bea, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id, Muted: true})); err != nil {
		t.Fatal(err)
	}
	fixture.expect(fixture.bea, "thread muted", 1, 2)
}

// A direct message's alert_count is always 0: unread_count is the number
// that matters there.
func TestAlertCountsLeaveDirectMessagesToUnread(t *testing.T) {
	fixture := newAlertsFixture(t)
	dm, err := fixture.svc.OpenDirectMessage(fixture.owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{authctx.UserID(fixture.bea)}}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "psst"})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{ChannelId: dmID, Content: mentionOf(fixture.bea) + " you there?"})
	list, err := fixture.svc.ListDirectMessages(fixture.bea, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.DirectMessages) != 1 {
		t.Fatalf("bea's conversations: %d, want 1", len(list.Msg.DirectMessages))
	}
	channel := list.Msg.DirectMessages[0].Channel
	if channel.UnreadCount != 2 || channel.AlertCount != 0 {
		t.Errorf("DM unread_count = %d, alert_count = %d; want 2 and 0", channel.UnreadCount, channel.AlertCount)
	}
	// Nor does the conversation reach any space's count.
	fixture.expect(fixture.bea, "after two DMs", 0, 0)
}

// A space's count is the sum over its channels, and a private channel
// the person is not in contributes nothing, whoever was named in it.
func TestAlertCountsSumOverTheSpace(t *testing.T) {
	fixture := newAlertsFixture(t)
	side, err := fixture.svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: fixture.spaceID, Name: "side"}))
	if err != nil {
		t.Fatal(err)
	}
	secret, err := fixture.svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: fixture.spaceID, Name: "secret", Private: true}))
	if err != nil {
		t.Fatal(err)
	}
	sideID, secretID := side.Msg.Channel.Id, secret.Msg.Channel.Id
	if _, err := fixture.svc.AddChannelMembers(fixture.owner, connect.NewRequest(&chatv1.AddChannelMembersRequest{ChannelId: secretID, UserIds: []string{authctx.UserID(fixture.cass)}})); err != nil {
		t.Fatal(err)
	}
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{Content: mentionOf(fixture.cass) + " in general"})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{ChannelId: sideID, Content: mentionOf(fixture.cass) + " on the side, twice " + mentionOf(fixture.cass)})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{ChannelId: sideID, Content: "@channel on the side"})
	fixture.send(fixture.owner, &chatv1.SendMessageRequest{ChannelId: secretID, Content: mentionOf(fixture.cass) + " " + mentionOf(fixture.bea) + " in secret"})

	if got := fixture.channelAlerts(fixture.cass, fixture.channelID); got != 1 {
		t.Errorf("cass in general = %d, want 1", got)
	}
	if got := fixture.channelAlerts(fixture.cass, sideID); got != 2 {
		t.Errorf("cass on the side = %d, want 2", got)
	}
	if got := fixture.channelAlerts(fixture.cass, secretID); got != 1 {
		t.Errorf("cass in secret = %d, want 1", got)
	}
	if got := fixture.spaceAlerts(fixture.cass); got != 4 {
		t.Errorf("cass's space = %d, want 4", got)
	}
	// Bea is not in secret: only the @channel on the side reaches her.
	if got := fixture.channelAlerts(fixture.bea, sideID); got != 1 {
		t.Errorf("bea on the side = %d, want 1", got)
	}
	if got := fixture.spaceAlerts(fixture.bea); got != 1 {
		t.Errorf("bea's space = %d, want 1", got)
	}
}
