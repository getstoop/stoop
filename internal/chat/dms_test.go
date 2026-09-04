package chat_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

// nextEvent waits briefly for one event on a subscription.
func nextEvent(t *testing.T, sub *events.Subscription) *realtimev1.ServerEvent {
	t.Helper()
	select {
	case ev := <-sub.Events():
		return ev
	case <-time.After(2 * time.Second):
		t.Fatal("no event within 2s")
		return nil
	}
}

func noEvent(t *testing.T, sub *events.Subscription) {
	t.Helper()
	select {
	case ev := <-sub.Events():
		t.Fatalf("unexpected event: %v", ev.Payload)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestDirectMessages(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	stranger := newUser(t, pool, "stranger", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)
	aliceID, bobID := authctx.UserID(alice), authctx.UserID(bob)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	inv, err := svc.CreateInvite(alice, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bob, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}

	// ---- opening ----
	_, err = svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: aliceID}))
	if code(err) != connect.CodeInvalidArgument {
		t.Errorf("DM with self: want invalid_argument, got %v", err)
	}
	_, err = svc.OpenDirectMessage(stranger, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: aliceID}))
	if code(err) != connect.CodePermissionDenied {
		t.Errorf("DM without a shared space: want permission_denied, got %v", err)
	}
	_, err = svc.OpenDirectMessage(operator, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: uuid.NewString()}))
	if code(err) != connect.CodeNotFound {
		t.Errorf("DM with unknown user: want not_found, got %v", err)
	}

	aliceSub := bus.Subscribe("user:" + aliceID)
	defer aliceSub.Close()
	bobSub := bus.Subscribe("user:" + bobID)
	defer bobSub.Close()

	opened, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: bobID}))
	if err != nil {
		t.Fatalf("alice opens DM with bob: %v", err)
	}
	dm := opened.Msg.DirectMessage
	if dm.Channel.Kind != chatv1.ChannelKind_CHANNEL_KIND_DM || dm.Channel.SpaceId != "" {
		t.Errorf("DM channel: got kind %v space %q", dm.Channel.Kind, dm.Channel.SpaceId)
	}
	if len(dm.Participants) != 2 {
		t.Errorf("participants: got %d, want 2", len(dm.Participants))
	}
	for _, sub := range []*events.Subscription{aliceSub, bobSub} {
		ev := nextEvent(t, sub)
		if c := ev.GetChannelCreated(); c == nil || c.Id != dm.Channel.Id {
			t.Errorf("want ChannelCreated for the DM on both personal topics, got %v", ev.Payload)
		}
	}
	// Idempotent from either side.
	again, err := svc.OpenDirectMessage(bob, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: aliceID}))
	if err != nil {
		t.Fatal(err)
	}
	if again.Msg.DirectMessage.Channel.Id != dm.Channel.Id {
		t.Errorf("reopening from the other side made a new channel")
	}
	noEvent(t, aliceSub)
	// An instance admin may open one without a shared space.
	if _, err := svc.OpenDirectMessage(operator, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: bobID})); err != nil {
		t.Errorf("admin opens DM: %v", err)
	}
	nextEvent(t, bobSub) // its ChannelCreated

	// ---- not a space channel ----
	if _, err := svc.CreateChannel(alice, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "x", Kind: chatv1.ChannelKind_CHANNEL_KIND_DM})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("CreateChannel kind DM: want invalid_argument, got %v", err)
	}
	name := "renamed"
	if _, err := svc.UpdateChannel(alice, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: dm.Channel.Id, Name: &name})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("rename DM: want invalid_argument, got %v", err)
	}
	if _, err := svc.DeleteChannel(alice, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: dm.Channel.Id})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("delete DM: want invalid_argument, got %v", err)
	}
	chans, err := svc.ListChannels(alice, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range chans.Msg.Channels {
		if c.Id == dm.Channel.Id {
			t.Errorf("the DM shows up in the space's channel list")
		}
	}

	// ---- messaging ----
	sent, err := svc.SendMessage(alice, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dm.Channel.Id, Content: "hi bob"}))
	if err != nil {
		t.Fatalf("alice sends: %v", err)
	}
	if sent.Msg.Message.SpaceId != "" {
		t.Errorf("DM message carries space %q", sent.Msg.Message.SpaceId)
	}
	// Bob: the message on his topic, and a dm activity item.
	var gotMessage, gotActivity bool
	for i := 0; i < 2; i++ {
		ev := nextEvent(t, bobSub)
		if m := ev.GetMessageCreated(); m != nil && m.Id == sent.Msg.Message.Id {
			gotMessage = true
		}
		if n := ev.GetActivityItemCreated(); n != nil && n.Item.Kind == chatv1.ActivityKind_ACTIVITY_KIND_DM &&
			n.Item.ChannelId == dm.Channel.Id && n.Item.SpaceId == "" {
			gotActivity = true
		}
	}
	if !gotMessage || !gotActivity {
		t.Errorf("bob: message %v, dm activity %v", gotMessage, gotActivity)
	}
	// Alice: her own message, no activity item.
	if ev := nextEvent(t, aliceSub); ev.GetMessageCreated() == nil {
		t.Errorf("alice: want her own MessageCreated, got %v", ev.Payload)
	}
	noEvent(t, aliceSub)

	// A second message before bob reads: the same feed entry, refreshed
	// (one row, newest message), but the event still goes out.
	second, err := svc.SendMessage(alice, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dm.Channel.Id, Content: "you there?"}))
	if err != nil {
		t.Fatal(err)
	}
	var refreshed *chatv1.ActivityItem
	for i := 0; i < 2; i++ {
		if n := nextEvent(t, bobSub).GetActivityItemCreated(); n != nil {
			refreshed = n.Item
		}
	}
	if refreshed == nil || refreshed.MessageId != second.Msg.Message.Id || refreshed.Preview != "you there?" {
		t.Errorf("second DM: want the refreshed activity event, got %v", refreshed)
	}
	drainEvents(aliceSub)
	bobNotes, err := svc.ListActivity(bob, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if n := bobNotes.Msg.Items; len(n) != 1 || n[0].MessageId != second.Msg.Message.Id || bobNotes.Msg.UnreadCount != 1 {
		t.Errorf("bob's feed after two DMs: want one entry at the newest message, got %d (unread %d)", len(n), bobNotes.Msg.UnreadCount)
	}

	if _, err := svc.ListMessages(stranger, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: dm.Channel.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("stranger reads DM: want permission_denied, got %v", err)
	}
	if _, err := svc.SendMessage(stranger, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dm.Channel.Id, Content: "hey"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("stranger writes DM: want permission_denied, got %v", err)
	}
	// The operator is not a participant either; an admin has no way in.
	if _, err := svc.ListMessages(operator, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: dm.Channel.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("admin reads a DM they're not in: want permission_denied, got %v", err)
	}

	list, err := svc.ListMessages(bob, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: dm.Channel.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Messages) != 2 || list.Msg.Messages[0].Content != "hi bob" {
		t.Errorf("bob's view: %v", list.Msg.Messages)
	}

	// ---- list, unread, read marker ----
	bobs, err := svc.ListDirectMessages(bob, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(bobs.Msg.DirectMessages) != 2 { // alice, operator
		t.Fatalf("bob's DM list: got %d, want 2", len(bobs.Msg.DirectMessages))
	}
	first := bobs.Msg.DirectMessages[0]
	if first.Channel.Id != dm.Channel.Id {
		t.Errorf("the DM with activity should list first")
	}
	if first.Channel.UnreadCount != 2 || first.Channel.LastMessageId != second.Msg.Message.Id {
		t.Errorf("bob's unread: count %d last %q", first.Channel.UnreadCount, first.Channel.LastMessageId)
	}
	if _, err := svc.MarkChannelRead(bob, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: dm.Channel.Id})); err != nil {
		t.Fatal(err)
	}
	if ev := nextEvent(t, bobSub); ev.GetChannelRead() == nil || ev.GetChannelRead().SpaceId != "" {
		t.Errorf("want ChannelRead with empty space, got %v", ev.Payload)
	}
	bobs, _ = svc.ListDirectMessages(bob, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if bobs.Msg.DirectMessages[0].Channel.UnreadCount != 0 {
		t.Errorf("after MarkChannelRead: unread %d", bobs.Msg.DirectMessages[0].Channel.UnreadCount)
	}

	// ---- mentions and replies in a DM: one alert, not two ----
	reply, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: dm.Channel.Id, Content: "@alice hi back @everyone", ReplyToMessageId: sent.Msg.Message.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if reply.Msg.Message.MentionsEveryone || len(reply.Msg.Message.MentionUserIds) != 1 {
		t.Errorf("DM mentions: everyone=%v ids=%v", reply.Msg.Message.MentionsEveryone, reply.Msg.Message.MentionUserIds)
	}
	notes, err := svc.ListActivity(alice, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(notes.Msg.Items) != 1 || notes.Msg.Items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION {
		t.Errorf("alice's activity: want one mention, got %v", notes.Msg.Items)
	}

	// ---- deleting: own only ----
	if _, err := svc.DeleteMessage(alice, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: reply.Msg.Message.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("delete the other's DM message: want permission_denied, got %v", err)
	}
	if _, err := svc.DeleteMessage(bob, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: reply.Msg.Message.Id})); err != nil {
		t.Errorf("delete own DM message: %v", err)
	}

	// ---- reactions fan out on personal topics ----
	drainEvents(aliceSub)
	if _, err := svc.ToggleReaction(bob, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: sent.Msg.Message.Id, Emoji: "👍"})); err != nil {
		t.Fatal(err)
	}
	if ev := nextEvent(t, aliceSub); ev.GetReactionsChanged() == nil {
		t.Errorf("alice: want ReactionsChanged, got %v", ev.Payload)
	}

	// The port the files module and gateway use.
	ids, err := svc.DMParticipants(context.Background(), dm.Channel.Id)
	if err != nil || len(ids) != 2 {
		t.Errorf("DMParticipants: %v %v", ids, err)
	}
	if ok, _ := svc.IsChannelMember(context.Background(), aliceID, dm.Channel.Id); !ok {
		t.Errorf("IsChannelMember(alice, dm) = false")
	}
	if sp, err := svc.ChannelSpaceForMember(context.Background(), bobID, dm.Channel.Id); err != nil || sp != "" {
		t.Errorf("ChannelSpaceForMember(dm) = %q, %v", sp, err)
	}
}

func drainEvents(sub *events.Subscription) {
	for {
		select {
		case <-sub.Events():
		default:
			return
		}
	}
}
