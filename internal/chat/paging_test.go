package chat_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

// TestListMessagesModes covers the three ways to page a channel: backwards
// from the newest (before_id), forwards (after_id) and a window centred on
// one message (around_id), plus the has_older/has_newer hints the client's
// window model relies on.
func TestListMessagesModes(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	channelID := sp.Msg.DefaultChannel.Id
	other, _ := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: sp.Msg.Space.Id, Name: "other"}))

	ids := make([]string, 0, 12)
	for i := range 12 {
		content := fmt.Sprintf("m%d", i)
		var reply string
		if i == 11 {
			reply = ids[1] // the newest message quotes an early one
		}
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content, ReplyToMessageId: reply,
		}))
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, res.Msg.Message.Id)
	}
	elsewhere, _ := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: other.Msg.Channel.Id, Content: "not here"}))

	list := func(req *chatv1.ListMessagesRequest) *chatv1.ListMessagesResponse {
		t.Helper()
		req.ChannelId = channelID
		res, err := svc.ListMessages(owner, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("ListMessages(%+v): %v", req, err)
		}
		return res.Msg
	}
	contents := func(msgs []*chatv1.Message) []string {
		out := make([]string, len(msgs))
		for i, m := range msgs {
			out[i] = m.Content
		}
		return out
	}
	expect := func(name string, got *chatv1.ListMessagesResponse, want []string, older, newer bool) {
		t.Helper()
		if g := contents(got.Messages); fmt.Sprint(g) != fmt.Sprint(want) {
			t.Errorf("%s: messages = %v, want %v", name, g, want)
		}
		if got.HasOlder != older || got.HasNewer != newer {
			t.Errorf("%s: has_older=%v has_newer=%v, want %v/%v", name, got.HasOlder, got.HasNewer, older, newer)
		}
	}

	// Newest page: the page realtime extends, so has_newer is false.
	expect("newest", list(&chatv1.ListMessagesRequest{Limit: 4}), []string{"m8", "m9", "m10", "m11"}, true, false)
	// Backwards from m8; a short final page reports no older messages.
	expect("before", list(&chatv1.ListMessagesRequest{Limit: 4, BeforeId: ids[8]}), []string{"m4", "m5", "m6", "m7"}, true, true)
	expect("before-end", list(&chatv1.ListMessagesRequest{Limit: 5, BeforeId: ids[4]}), []string{"m0", "m1", "m2", "m3"}, false, true)

	// Forwards from m3: strictly newer, oldest-first; a full page may have more.
	expect("after", list(&chatv1.ListMessagesRequest{Limit: 4, AfterId: ids[3]}), []string{"m4", "m5", "m6", "m7"}, true, true)
	expect("after-end", list(&chatv1.ListMessagesRequest{Limit: 4, AfterId: ids[9]}), []string{"m10", "m11"}, true, false)

	// Around m6 with limit 5: two older, the target, two newer.
	expect("around", list(&chatv1.ListMessagesRequest{Limit: 5, AroundId: ids[6]}), []string{"m4", "m5", "m6", "m7", "m8"}, true, true)
	// Around the first message: nothing older, so has_older is false.
	expect("around-start", list(&chatv1.ListMessagesRequest{Limit: 5, AroundId: ids[0]}), []string{"m0", "m1", "m2"}, false, true)
	// Around the newest: the window reaches the live end.
	expect("around-end", list(&chatv1.ListMessagesRequest{Limit: 5, AroundId: ids[11]}), []string{"m9", "m10", "m11"}, true, false)
	// The window is fully hydrated: the quoted message travels with the row.
	if last := list(&chatv1.ListMessagesRequest{Limit: 5, AroundId: ids[11]}).Messages[2]; last.ReplyTo == nil || last.ReplyTo.Preview != "m1" {
		t.Errorf("around window lost the reply quote: %+v", last.ReplyTo)
	}

	// A message from another channel (or a bogus id) is NotFound, not a leak.
	for _, id := range []string{elsewhere.Msg.Message.Id, "00000000-0000-7000-8000-000000000000"} {
		_, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID, AroundId: id}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("around %s: err = %v, want NotFound", id, err)
		}
	}
	// The modes don't combine.
	_, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID, BeforeId: ids[5], AfterId: ids[2]}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("before+after: err = %v, want InvalidArgument", err)
	}
}
