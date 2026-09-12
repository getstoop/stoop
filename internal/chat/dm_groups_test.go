package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// joinSpace puts a user in a space through an invite, the way a person does.
func joinSpace(t *testing.T, svc *chat.Service, owner context.Context, spaceID string, members ...context.Context) {
	t.Helper()
	for _, m := range members {
		inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.JoinSpace(m, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
}

func dmIDs(dm *chatv1.DirectMessage) map[string]bool {
	out := map[string]bool{}
	for _, p := range dm.Participants {
		out[p.Id] = true
	}
	return out
}

func TestGroupDirectMessages(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	dana := newUser(t, pool, "dana", authctx.RoleMember)
	stranger := newUser(t, pool, "stranger", authctx.RoleMember)
	aliceID, bobID := authctx.UserID(alice), authctx.UserID(bob)
	caseyID, danaID := authctx.UserID(casey), authctx.UserID(dana)
	strangerID := authctx.UserID(stranger)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	joinSpace(t, svc, alice, spaceID, bob, casey, dana)

	// ---- creating ----
	if _, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{bobID},
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("group of two: want invalid_argument, got %v", err)
	}
	if _, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{bobID, strangerID},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("group holding someone with no shared space: want permission_denied, got %v", err)
	}

	subs := map[string]*events.Subscription{}
	for _, id := range []string{aliceID, bobID, caseyID, danaID} {
		subs[id] = bus.Subscribe("user:" + id)
		defer subs[id].Close()
	}

	created, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{bobID, caseyID},
	}))
	if err != nil {
		t.Fatalf("alice starts a group: %v", err)
	}
	group := created.Msg.DirectMessage
	if group.Channel.SpaceId != "" || group.Channel.Kind != chatv1.ChannelKind_CHANNEL_KIND_DM {
		t.Errorf("group channel: got kind %v space %q", group.Channel.Kind, group.Channel.SpaceId)
	}
	if len(group.Participants) != 3 {
		t.Fatalf("participants: got %d, want 3", len(group.Participants))
	}
	if !group.Group {
		t.Errorf("a group conversation is not marked as one")
	}
	// Everyone in it hears about it: the membership list, and the channel
	// itself since it is new for all three.
	for _, id := range []string{aliceID, bobID, caseyID} {
		var members, channel bool
		for i := 0; i < 2; i++ {
			ev := nextEvent(t, subs[id])
			if m := ev.GetDirectMessageMembersChanged(); m != nil && m.ChannelId == group.Channel.Id && len(m.Participants) == 3 {
				members = true
			}
			if c := ev.GetChannelCreated(); c != nil && c.Id == group.Channel.Id {
				channel = true
			}
		}
		if !members || !channel {
			t.Errorf("%s: members event %v, channel event %v", id, members, channel)
		}
	}

	// The same three people again is a second conversation: a group is not
	// identified by who is in it.
	twin, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{bobID, caseyID},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if twin.Msg.DirectMessage.Channel.Id == group.Channel.Id {
		t.Errorf("starting the same group twice reused the conversation")
	}
	for _, id := range []string{aliceID, bobID, caseyID} {
		drainEvents(subs[id])
	}

	// ---- it is a channel like any other ----
	sent, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: group.Channel.Id, Content: "saturday?"}))
	if err != nil {
		t.Fatalf("bob sends in the group: %v", err)
	}
	if _, err := svc.ListMessages(stranger, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider reads the group: want permission_denied, got %v", err)
	}
	for _, who := range []context.Context{alice, bob, casey} {
		drainEvents(subs[authctx.UserID(who)])
	}

	// ---- adding ----
	if _, err := svc.AddDirectMessageMembers(stranger, connect.NewRequest(&chatv1.AddDirectMessageMembersRequest{
		ChannelId: group.Channel.Id, UserIds: []string{danaID},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider adds: want permission_denied, got %v", err)
	}
	if _, err := svc.AddDirectMessageMembers(casey, connect.NewRequest(&chatv1.AddDirectMessageMembersRequest{
		ChannelId: group.Channel.Id, UserIds: []string{bobID},
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("adding someone already there: want invalid_argument, got %v", err)
	}
	added, err := svc.AddDirectMessageMembers(casey, connect.NewRequest(&chatv1.AddDirectMessageMembersRequest{
		ChannelId: group.Channel.Id, UserIds: []string{danaID},
	}))
	if err != nil {
		t.Fatalf("casey adds dana: %v", err)
	}
	if added.Msg.DirectMessage.Channel.Id != group.Channel.Id || len(added.Msg.DirectMessage.Participants) != 4 {
		t.Errorf("after the add: channel %q with %d participants",
			added.Msg.DirectMessage.Channel.Id, len(added.Msg.DirectMessage.Participants))
	}
	// Dana joins and reads everything said before she arrived.
	danaList, err := svc.ListMessages(dana, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id}))
	if err != nil {
		t.Fatalf("dana reads the group: %v", err)
	}
	if len(danaList.Msg.Messages) != 1 || danaList.Msg.Messages[0].Id != sent.Msg.Message.Id {
		t.Errorf("a newcomer reads the history: got %d messages", len(danaList.Msg.Messages))
	}
	danaDMs, err := svc.ListDirectMessages(dana, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(danaDMs.Msg.DirectMessages) != 1 {
		t.Errorf("dana's DM list: got %d conversations, want 1", len(danaDMs.Msg.DirectMessages))
	}

	// ---- leaving ----
	if _, err := svc.LeaveDirectMessage(stranger, connect.NewRequest(&chatv1.LeaveDirectMessageRequest{
		ChannelId: group.Channel.Id,
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider leaves: want permission_denied, got %v", err)
	}
	for _, id := range []string{aliceID, bobID, caseyID, danaID} {
		drainEvents(subs[id])
	}
	if _, err := svc.LeaveDirectMessage(dana, connect.NewRequest(&chatv1.LeaveDirectMessageRequest{
		ChannelId: group.Channel.Id,
	})); err != nil {
		t.Fatalf("dana leaves: %v", err)
	}
	if ev := nextEvent(t, subs[danaID]); ev.GetDirectMessageMembersChanged() == nil && ev.GetChannelDeleted() == nil {
		t.Errorf("the leaver hears nothing useful: %v", ev.Payload)
	}
	if _, err := svc.ListMessages(dana, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("after leaving, dana can still read: %v", err)
	}
	stillThere, err := svc.ListMessages(alice, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id}))
	if err != nil || len(stillThere.Msg.Messages) != 1 {
		t.Errorf("a departure took the conversation with it: %v", err)
	}
	// It never becomes the pair conversation, however small it gets.
	aliceDMs, err := svc.ListDirectMessages(alice, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range aliceDMs.Msg.DirectMessages {
		if d.Channel.Id == group.Channel.Id && !d.Group {
			t.Errorf("a group that lost someone stopped being a group")
		}
	}

	// ---- a 1:1's members can't be changed ----
	pair, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: bobID}))
	if err != nil {
		t.Fatal(err)
	}
	pairID := pair.Msg.DirectMessage.Channel.Id
	if pair.Msg.DirectMessage.Group {
		t.Errorf("a 1:1 is marked as a group")
	}
	if _, err := svc.SendMessage(alice, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: pairID, Content: "just between us",
	})); err != nil {
		t.Fatal(err)
	}
	for _, err := range []error{
		errOf(svc.LeaveDirectMessage(alice, connect.NewRequest(&chatv1.LeaveDirectMessageRequest{ChannelId: pairID}))),
		errOf(svc.AddDirectMessageMembers(alice, connect.NewRequest(&chatv1.AddDirectMessageMembersRequest{
			ChannelId: pairID, UserIds: []string{caseyID},
		}))),
	} {
		if code(err) != connect.CodeInvalidArgument {
			t.Errorf("changing a 1:1's members: want invalid_argument, got %v", err)
		}
	}

	// Bringing casey in is a new conversation with all three, and it
	// carries none of what the two of them said.
	three, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{bobID, caseyID},
	}))
	if err != nil {
		t.Fatalf("alice starts a group with bob and casey: %v", err)
	}
	if ids := dmIDs(three.Msg.DirectMessage); len(ids) != 3 || !ids[aliceID] || !ids[bobID] || !ids[caseyID] {
		t.Errorf("the new conversation holds the wrong people: %v", ids)
	}
	caseySees, err := svc.ListMessages(casey, connect.NewRequest(&chatv1.ListMessagesRequest{
		ChannelId: three.Msg.DirectMessage.Channel.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(caseySees.Msg.Messages) != 0 {
		t.Errorf("the new conversation carried the pair's history: %d messages", len(caseySees.Msg.Messages))
	}
	if _, err := svc.ListMessages(casey, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: pairID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("the pair conversation is no longer private: %v", err)
	}
	stillPrivate, err := svc.ListMessages(bob, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: pairID}))
	if err != nil || len(stillPrivate.Msg.Messages) != 1 {
		t.Errorf("the 1:1 lost its message: %v", err)
	}
}

// errOf drops a Connect response and keeps the error, so a table of calls
// that should all be refused reads as one.
func errOf[T any](_ *connect.Response[T], err error) error { return err }

func TestGroupDirectMessageLimitsAndBlocks(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id

	// Eleven people in the space: alice plus ten.
	others := make([]context.Context, 0, 10)
	ids := make([]string, 0, 10)
	for i := 0; i < 10; i++ {
		u := newUser(t, pool, string(rune('b'+i))+"user", authctx.RoleMember)
		joinSpace(t, svc, alice, spaceID, u)
		others = append(others, u)
		ids = append(ids, authctx.UserID(u))
	}

	// ---- the cap ----
	if _, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: ids,
	})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("eleven people: want failed_precondition, got %v", err)
	}
	full, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: ids[:9],
	}))
	if err != nil {
		t.Fatalf("a group of ten: %v", err)
	}
	if _, err := svc.AddDirectMessageMembers(alice, connect.NewRequest(&chatv1.AddDirectMessageMembersRequest{
		ChannelId: full.Msg.DirectMessage.Channel.Id, UserIds: []string{ids[9]},
	})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("the eleventh add: want failed_precondition, got %v", err)
	}

	// ---- blocks ----
	bob := others[0]
	bobID, caseyID := ids[0], ids[1]
	if _, err := svc.BlockUser(bob, connect.NewRequest(&chatv1.BlockUserRequest{UserId: caseyID})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{bobID, caseyID},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a group holding a blocked pair: want permission_denied, got %v", err)
	}

	// A block made afterwards does not gag the group: the room is shared,
	// and the way out of one is to leave.
	group, err := svc.CreateGroupDirectMessage(alice, connect.NewRequest(&chatv1.CreateGroupDirectMessageRequest{
		UserIds: []string{ids[2], ids[3]},
	}))
	if err != nil {
		t.Fatal(err)
	}
	third, fourth := others[2], others[3]
	if _, err := svc.BlockUser(third, connect.NewRequest(&chatv1.BlockUserRequest{UserId: ids[3]})); err != nil {
		t.Fatal(err)
	}
	for _, who := range []context.Context{third, fourth} {
		if _, err := svc.SendMessage(who, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: group.Msg.DirectMessage.Channel.Id, Content: "still here",
		})); err != nil {
			t.Errorf("a later block stopped a group message: %v", err)
		}
	}
	listed, err := svc.ListDirectMessages(third, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, dm := range listed.Msg.DirectMessages {
		if dm.Channel.Id == group.Msg.DirectMessage.Channel.Id {
			found = true
		}
	}
	if !found {
		t.Errorf("a block hid a group conversation from the person who made it")
	}
}

func TestDirectMessageCandidates(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	stranger := newUser(t, pool, "stranger", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)
	bobID, caseyID := authctx.UserID(bob), authctx.UserID(casey)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, alice, sp.Msg.Space.Id, bob, casey)

	got, err := svc.ListDirectMessageCandidates(alice, connect.NewRequest(&chatv1.ListDirectMessageCandidatesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if ids := authorIDs(got.Msg.Users); len(ids) != 2 || !ids[bobID] || !ids[caseyID] {
		t.Errorf("candidates: want bob and casey, got %v", ids)
	}

	// A block removes the person, whichever way round it was made.
	if _, err := svc.BlockUser(casey, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(alice)})); err != nil {
		t.Fatal(err)
	}
	got, err = svc.ListDirectMessageCandidates(alice, connect.NewRequest(&chatv1.ListDirectMessageCandidatesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if ids := authorIDs(got.Msg.Users); len(ids) != 1 || !ids[bobID] {
		t.Errorf("after a block: want bob alone, got %v", ids)
	}

	// Nobody in a space with you: nobody to message. An instance admin gets
	// the same answer, not every account.
	for _, who := range []context.Context{stranger, operator} {
		got, err := svc.ListDirectMessageCandidates(who, connect.NewRequest(&chatv1.ListDirectMessageCandidatesRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Msg.Users) != 0 {
			t.Errorf("candidates for someone in no space: got %d", len(got.Msg.Users))
		}
	}
}

func authorIDs(authors []*chatv1.MessageAuthor) map[string]bool {
	out := map[string]bool{}
	for _, a := range authors {
		out[a.Id] = true
	}
	return out
}
