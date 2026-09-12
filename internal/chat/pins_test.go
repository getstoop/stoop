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

func TestPins(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	outsider := newUser(t, pool, "outsider", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	drain := func() {
		for {
			select {
			case <-sub.Events():
			default:
				return
			}
		}
	}

	send := func(ctx context.Context, content string) string {
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content,
		}))
		if err != nil {
			t.Fatalf("send %q: %v", content, err)
		}
		return res.Msg.Message.Id
	}
	setPinned := func(ctx context.Context, id string, pinned bool) (*chatv1.SetMessagePinnedResponse, error) {
		res, err := svc.SetMessagePinned(ctx, connect.NewRequest(&chatv1.SetMessagePinnedRequest{
			MessageId: id, Pinned: pinned,
		}))
		if err != nil {
			return nil, err
		}
		return res.Msg, nil
	}
	list := func(ctx context.Context) []*chatv1.PinnedMessage {
		res, err := svc.ListPinnedMessages(ctx, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{
			ChannelId: channelID,
		}))
		if err != nil {
			t.Fatalf("list pins: %v", err)
		}
		return res.Msg.Pins
	}

	rules := send(owner, "be decent")
	address := send(owner, "stoop.example.net:25565")
	drain()

	// An admin pins: the pin comes back with who made it, and the space
	// hears a MessagePinned carrying the change.
	res, err := setPinned(owner, rules, true)
	if err != nil {
		t.Fatalf("pin: %v", err)
	}
	if res.Pin == nil || res.Pin.Message.Id != rules || !res.Pin.Message.Pinned {
		t.Fatalf("pin response: %+v", res.Pin)
	}
	if res.Pin.PinnedBy == nil || res.Pin.PinnedBy.Id != authctx.UserID(owner) {
		t.Errorf("pinned_by: %+v", res.Pin.PinnedBy)
	}
	ev := (<-sub.Events()).GetMessagePinned()
	if ev == nil || ev.MessageId != rules || ev.ChannelId != channelID || ev.SpaceId != spaceID || !ev.Pinned {
		t.Fatalf("expected MessagePinned, got %+v", ev)
	}
	if ev.PinnedBy == nil || ev.PinnedBy.Id != authctx.UserID(owner) {
		t.Errorf("event pinned_by: %+v", ev.PinnedBy)
	}

	// Pinning again is a no-op: the same pin back, and nothing broadcast.
	again, err := setPinned(owner, rules, true)
	if err != nil {
		t.Fatalf("pin twice: %v", err)
	}
	if again.Pin == nil || again.Pin.PinnedAt.AsTime() != res.Pin.PinnedAt.AsTime() {
		t.Errorf("second pin changed the pin: %+v", again.Pin)
	}
	select {
	case e := <-sub.Events():
		t.Errorf("second pin broadcast %T", e.Payload)
	default:
	}

	// Every member reads the list; the newest pin leads it.
	if _, err := setPinned(owner, address, true); err != nil {
		t.Fatalf("pin second: %v", err)
	}
	drain()
	pins := list(bea)
	if len(pins) != 2 || pins[0].Message.Id != address || pins[1].Message.Id != rules {
		t.Fatalf("expected [address rules], got %v", pinIDs(pins))
	}

	// A member without manage_channels can read but not pin.
	third := send(bea, "map seed?")
	if _, err := setPinned(bea, third, true); code(err) != connect.CodePermissionDenied {
		t.Errorf("member pinning: want PermissionDenied, got %v", err)
	}
	if _, err := svc.ListPinnedMessages(outsider, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{
		ChannelId: channelID,
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider listing: want PermissionDenied, got %v", err)
	}

	// The timeline carries the flag, so a reader sees the marker without
	// asking for the pin list.
	msgs, err := svc.ListMessages(bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range msgs.Msg.Messages {
		want := m.Id == rules || m.Id == address
		if m.Pinned != want {
			t.Errorf("message %q pinned=%v, want %v", m.Content, m.Pinned, want)
		}
	}

	// Unpinning drops it from the list and broadcasts the other way.
	drain()
	if _, err := setPinned(owner, rules, false); err != nil {
		t.Fatalf("unpin: %v", err)
	}
	ev = (<-sub.Events()).GetMessagePinned()
	if ev == nil || ev.MessageId != rules || ev.Pinned {
		t.Fatalf("expected an unpin event, got %+v", ev)
	}
	if pins := list(owner); len(pins) != 1 || pins[0].Message.Id != address {
		t.Errorf("after unpin: %v", pinIDs(pins))
	}

	// Unpinning what isn't pinned is a no-op, not an error.
	if _, err := setPinned(owner, rules, false); err != nil {
		t.Errorf("unpin twice: %v", err)
	}

	// Deleting a pinned message takes its pin with it (the cascade).
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: address})); err != nil {
		t.Fatalf("delete pinned: %v", err)
	}
	if pins := list(owner); len(pins) != 0 {
		t.Errorf("pins survived the message: %v", pinIDs(pins))
	}
}

// pinCap mirrors maxChannelPins in pins.go; raising one should fail here
// until the other follows.
const pinCap = 50

func TestPinCap(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	channelID := sp.Msg.DefaultChannel.Id

	pin := func(id string) error {
		_, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{
			MessageId: id, Pinned: true,
		}))
		return err
	}
	var last string
	for i := 0; i <= pinCap; i++ {
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: "keep me",
		}))
		if err != nil {
			t.Fatal(err)
		}
		last = res.Msg.Message.Id
		if i == pinCap {
			break
		}
		if err := pin(last); err != nil {
			t.Fatalf("pin %d: %v", i, err)
		}
	}
	// The one past the cap is refused, and nothing fell off to make room.
	if err := pin(last); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("pin at the cap: want FailedPrecondition, got %v", err)
	}
	res, err := svc.ListPinnedMessages(owner, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{
		ChannelId: channelID,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Msg.Pins) != pinCap {
		t.Errorf("pins after the refusal: %d, want %d", len(res.Msg.Pins), pinCap)
	}
}

func TestPinsAreNotForDMs(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: []string{authctx.UserID(bea)},
	}))
	if err != nil {
		t.Fatal(err)
	}
	msg, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: dm.Msg.DirectMessage.Channel.Id, Content: "just us",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{
		MessageId: msg.Msg.Message.Id, Pinned: true,
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("pinning in a DM: want InvalidArgument, got %v", err)
	}
}

func pinIDs(pins []*chatv1.PinnedMessage) []string {
	out := make([]string, len(pins))
	for i, p := range pins {
		out[i] = p.Message.Id
	}
	return out
}
