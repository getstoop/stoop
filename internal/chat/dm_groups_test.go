package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// Conversations with more than two people. There is no separate group
// concept: a conversation is its participants, so the same RPC opens one
// of any size and membership never changes afterwards.

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

func openDM(t *testing.T, svc *chat.Service, who context.Context, ids ...string) *chatv1.DirectMessage {
	t.Helper()
	res, err := svc.OpenDirectMessage(who, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: ids}))
	if err != nil {
		t.Fatalf("open conversation: %v", err)
	}
	return res.Msg.DirectMessage
}

func TestGroupDirectMessages(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	stranger := newUser(t, pool, "stranger", authctx.RoleMember)
	aliceID, bobID := authctx.UserID(alice), authctx.UserID(bob)
	caseyID, strangerID := authctx.UserID(casey), authctx.UserID(stranger)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, alice, sp.Msg.Space.Id, bob, casey)

	// ---- refusals ----
	for _, tc := range []struct {
		name string
		ids  []string
		want connect.Code
	}{
		{"nobody", nil, connect.CodeInvalidArgument},
		{"myself", []string{aliceID}, connect.CodeInvalidArgument},
		{"myself among others", []string{bobID, aliceID}, connect.CodeInvalidArgument},
		{"someone with no shared space", []string{bobID, strangerID}, connect.CodePermissionDenied},
	} {
		_, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: tc.ids}))
		if code(err) != tc.want {
			t.Errorf("%s: want %v, got %v", tc.name, tc.want, err)
		}
	}

	subs := map[string]*events.Subscription{}
	for _, id := range []string{aliceID, bobID, caseyID} {
		subs[id] = bus.Subscribe("user:" + id)
		defer subs[id].Close()
	}

	// ---- opening ----
	group := openDM(t, svc, alice, bobID, caseyID)
	if group.Channel.SpaceId != "" || group.Channel.Kind != chatv1.ChannelKind_CHANNEL_KIND_DM {
		t.Errorf("conversation channel: got kind %v space %q", group.Channel.Kind, group.Channel.SpaceId)
	}
	if len(group.Participants) != 3 {
		t.Fatalf("participants: got %d, want 3", len(group.Participants))
	}
	for _, id := range []string{aliceID, bobID, caseyID} {
		if ev := nextEvent(t, subs[id]); ev.GetChannelCreated() == nil || ev.GetChannelCreated().Id != group.Channel.Id {
			t.Errorf("%s was not told about the conversation: %v", id, ev.Payload)
		}
	}

	// ---- a conversation is its people ----
	// The same three again is the same conversation, whoever asks and in
	// whatever order, and nobody is told about it a second time.
	same := openDM(t, svc, casey, aliceID, bobID)
	if same.Channel.Id != group.Channel.Id {
		t.Errorf("the same three people got a second conversation")
	}
	if dup := openDM(t, svc, alice, bobID, bobID, caseyID); dup.Channel.Id != group.Channel.Id {
		t.Errorf("a repeated id made a different conversation")
	}
	for _, id := range []string{aliceID, bobID, caseyID} {
		noEvent(t, subs[id])
	}
	// A subset is a different conversation: alice and bob alone are not
	// the three of them.
	pair := openDM(t, svc, alice, bobID)
	if pair.Channel.Id == group.Channel.Id {
		t.Errorf("the pair conversation collided with the group")
	}
	if len(pair.Participants) != 2 {
		t.Errorf("pair participants: got %d, want 2", len(pair.Participants))
	}
	drainEvents(subs[aliceID])
	drainEvents(subs[bobID])
	drainEvents(subs[caseyID])

	// ---- it is a channel like any other ----
	sent, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: group.Channel.Id, Content: "saturday?"}))
	if err != nil {
		t.Fatalf("bob sends in the conversation: %v", err)
	}
	for _, who := range []context.Context{alice, casey} {
		got, err := svc.ListMessages(who, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id}))
		if err != nil || len(got.Msg.Messages) != 1 || got.Msg.Messages[0].Id != sent.Msg.Message.Id {
			t.Errorf("a participant cannot read the conversation: %v", err)
		}
	}
	if _, err := svc.ListMessages(stranger, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider reads the conversation: want permission_denied, got %v", err)
	}
	// It does not leak into the pair conversation beside it.
	if got, err := svc.ListMessages(alice, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: pair.Channel.Id})); err != nil || len(got.Msg.Messages) != 0 {
		t.Errorf("the pair conversation picked up the group's message: %v", err)
	}

	// Everyone in it is listed for everyone in it.
	listed, err := svc.ListDirectMessages(casey, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	var found *chatv1.DirectMessage
	for _, d := range listed.Msg.DirectMessages {
		if d.Channel.Id == group.Channel.Id {
			found = d
		}
	}
	if found == nil {
		t.Fatalf("casey's list is missing the conversation")
	}
	if ids := dmIDs(found); len(ids) != 3 || !ids[aliceID] || !ids[bobID] || !ids[caseyID] {
		t.Errorf("participants as listed: %v", ids)
	}
}

func TestDirectMessageCapAndBlocks(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}

	others := make([]context.Context, 0, 10)
	ids := make([]string, 0, 10)
	for i := 0; i < 10; i++ {
		u := newUser(t, pool, string(rune('b'+i))+"user", authctx.RoleMember)
		joinSpace(t, svc, alice, sp.Msg.Space.Id, u)
		others = append(others, u)
		ids = append(ids, authctx.UserID(u))
	}

	// ---- the cap ----
	if _, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: ids,
	})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("eleven people: want failed_precondition, got %v", err)
	}
	full := openDM(t, svc, alice, ids[:9]...)
	if len(full.Participants) != 10 {
		t.Errorf("a conversation of ten: got %d participants", len(full.Participants))
	}

	// ---- blocks ----
	// Nobody can be put in a conversation with somebody they blocked, or
	// who blocked them, whichever way round and whoever is asking.
	bob, casey := others[0], others[1]
	bobID, caseyID := ids[0], ids[1]
	if _, err := svc.BlockUser(bob, connect.NewRequest(&chatv1.BlockUserRequest{UserId: caseyID})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: []string{bobID, caseyID},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a conversation holding a blocked pair: want permission_denied, got %v", err)
	}
	if _, err := svc.OpenDirectMessage(casey, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: []string{bobID},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("the blocked person opening it: want permission_denied, got %v", err)
	}

	// A block after the fact stops both of them writing — but only the
	// blocker's own list loses the conversation. Vanishing it for the
	// blocked person would tell them they had been blocked, which a block
	// deliberately never does.
	group := openDM(t, svc, alice, ids[2], ids[3])
	third, fourth := others[2], others[3]
	if _, err := svc.SendMessage(third, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: group.Channel.Id, Content: "before",
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BlockUser(third, connect.NewRequest(&chatv1.BlockUserRequest{UserId: ids[3]})); err != nil {
		t.Fatal(err)
	}
	for _, who := range []context.Context{third, fourth} {
		if _, err := svc.SendMessage(who, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: group.Channel.Id, Content: "after",
		})); code(err) != connect.CodePermissionDenied {
			t.Errorf("writing across a block: want permission_denied, got %v", err)
		}
	}
	for _, tc := range []struct {
		name string
		who  context.Context
		want bool
	}{
		{"the blocker's list drops it", third, false},
		{"the blocked person's list keeps it", fourth, true},
		{"a bystander's list keeps it", alice, true},
	} {
		listed, err := svc.ListDirectMessages(tc.who, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		var listedIt bool
		for _, dm := range listed.Msg.DirectMessages {
			if dm.Channel.Id == group.Channel.Id {
				listedIt = true
			}
		}
		if listedIt != tc.want {
			t.Errorf("%s: listed %v, want %v", tc.name, listedIt, tc.want)
		}
	}
	// Alice blocked nobody, so it is still hers.
	stillHers, err := svc.ListMessages(alice, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: group.Channel.Id}))
	if err != nil || len(stillHers.Msg.Messages) != 1 {
		t.Errorf("somebody else's block took the conversation from alice: %v", err)
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

// The refusals a block produces have to fit the conversation: "this
// person" means nothing in a group, where the block may be with any of
// several and naming which would be naming them.
func TestBlockRefusalWording(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})

	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	aliceID, bobID := authctx.UserID(alice), authctx.UserID(bob)
	caseyID := authctx.UserID(casey)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, alice, sp.Msg.Space.Id, bob, casey)

	group := openDM(t, svc, alice, bobID, caseyID)
	if _, err := svc.BlockUser(bob, connect.NewRequest(&chatv1.BlockUserRequest{UserId: caseyID})); err != nil {
		t.Fatal(err)
	}

	// Sending into a group: the wording cannot single anybody out.
	_, err = svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: group.Channel.Id, Content: "hello",
	}))
	if got := connect.CodeOf(err); got != connect.CodePermissionDenied {
		t.Fatalf("sending across a block in a group: got %v", got)
	}
	if msg := err.Error(); !strings.Contains(msg, "this conversation") {
		t.Errorf("group send refusal should not single anybody out: %q", msg)
	}

	// Opening a group the block forbids says "these people".
	_, err = svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: []string{bobID, caseyID, aliceID},
	}))
	if err == nil {
		t.Fatal("opening a group holding a blocked pair should be refused")
	}

	// A 1:1 keeps the wording that is true there.
	if _, err := svc.BlockUser(alice, connect.NewRequest(&chatv1.BlockUserRequest{UserId: bobID})); err != nil {
		t.Fatal(err)
	}
	_, err = svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: []string{bobID},
	}))
	if msg := err.Error(); !strings.Contains(msg, "this person") {
		t.Errorf("a 1:1 refusal should still name the shape it has: %q", msg)
	}
}
