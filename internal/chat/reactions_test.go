package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

func TestReactions(t *testing.T) {
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
	toggle := func(ctx context.Context, id, emoji string) (*chatv1.Message, error) {
		res, err := svc.ToggleReaction(ctx, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: id, Emoji: emoji}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	reactions := func(m *chatv1.Message) map[string][]string {
		out := map[string][]string{}
		for _, r := range m.Reactions {
			out[r.Emoji] = r.UserIds
		}
		return out
	}

	msg, _ := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hello"}))
	if len(msg.Msg.Message.Reactions) != 0 {
		t.Errorf("fresh message has reactions: %+v", msg.Msg.Message.Reactions)
	}
	id := msg.Msg.Message.Id
	drain()

	// Toggle on: one group with bea; ReactionsChanged broadcast to the space.
	m, err := toggle(bea, id, "👍")
	if err != nil {
		t.Fatalf("toggle on: %v", err)
	}
	if got := reactions(m)["👍"]; len(got) != 1 || got[0] != authctx.UserID(bea) {
		t.Errorf("after bea toggles: %v", reactions(m))
	}
	ev := (<-sub.Events()).GetReactionsChanged()
	if ev == nil || ev.MessageId != id || ev.ChannelId != channelID || ev.SpaceId != spaceID || len(ev.Reactions) != 1 {
		t.Errorf("expected ReactionsChanged for the message, got %+v", ev)
	}

	// Two users, same emoji: one group of two, in reaction order; a second
	// emoji sorts by emoji, not arrival.
	m, _ = toggle(owner, id, "👍")
	if got := reactions(m)["👍"]; len(got) != 2 || got[0] != authctx.UserID(bea) || got[1] != authctx.UserID(owner) {
		t.Errorf("two users same emoji: %v", got)
	}
	m, _ = toggle(owner, id, "🎉")
	if len(m.Reactions) != 2 || m.Reactions[0].Emoji != "🎉" || m.Reactions[1].Emoji != "👍" {
		t.Errorf("groups should be ordered by emoji: %+v", m.Reactions)
	}
	drain()

	// Toggle off removes only the caller's row; the last one drops the group.
	m, _ = toggle(bea, id, "👍")
	if got := reactions(m)["👍"]; len(got) != 1 || got[0] != authctx.UserID(owner) {
		t.Errorf("after bea toggles off: %v", reactions(m))
	}
	if ev := (<-sub.Events()).GetReactionsChanged(); ev == nil || len(ev.Reactions) != 2 || len(ev.Reactions[1].UserIds) != 1 {
		t.Errorf("ReactionsChanged after bea's removal: %+v", ev)
	}
	m, _ = toggle(owner, id, "🎉")
	if _, ok := reactions(m)["🎉"]; ok || len(m.Reactions) != 1 {
		t.Errorf("empty group should disappear: %+v", m.Reactions)
	}
	if ev := (<-sub.Events()).GetReactionsChanged(); ev == nil || len(ev.Reactions) != 1 {
		t.Errorf("ReactionsChanged after removal should carry the remaining group: %+v", ev)
	}
	drain()

	// Skin tones and flags are single graphemes; text and pairs are not.
	var last *chatv1.Message
	for _, ok := range []string{"👍🏽", "🇨🇦", "❤️", "1️⃣", "x"} {
		if last, err = toggle(owner, id, ok); err != nil {
			t.Errorf("%q should be accepted: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "ab", "👍👍", "👨‍👩‍👧‍👦👍", "thumbsup"} {
		if _, err := toggle(owner, id, bad); code(err) != connect.CodeInvalidArgument {
			t.Errorf("%q: want invalid_argument, got %v", bad, err)
		}
	}
	drain()

	// Only channel members may react; unknown messages are not found.
	if _, err := toggle(outsider, id, "👍"); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider: want permission_denied, got %v", err)
	}
	if _, err := toggle(bea, "00000000-0000-7000-8000-000000000000", "👍"); code(err) != connect.CodeNotFound {
		t.Errorf("missing message: want not_found, got %v", err)
	}
	select {
	case e := <-sub.Events():
		t.Errorf("denied toggles must not broadcast: %+v", e)
	default:
	}

	// Reactions never notify anyone.
	var items int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM activity_items`).Scan(&items); err != nil {
		t.Fatal(err)
	}
	if items != 0 {
		t.Errorf("reactions created %d activity items", items)
	}

	// List round-trip: groups and order survive a fresh page load, and a
	// second message on the page gets its own (empty) list.
	m2, _ := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "second"}))
	list, err := svc.ListMessages(bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil || len(list.Msg.Messages) != 2 {
		t.Fatalf("list: %v %+v", err, list)
	}
	first, second := list.Msg.Messages[0], list.Msg.Messages[1]
	if first.Id != id || second.Id != m2.Msg.Message.Id {
		t.Fatalf("unexpected order: %s %s", first.Id, second.Id)
	}
	// Six distinct groups (skin tone ≠ plain), each with one reactor, in
	// exactly the order the toggle response used — chips must not jump
	// between a toggle and the next page load.
	want := last.Reactions
	if len(want) != 6 || len(first.Reactions) != len(want) {
		t.Fatalf("listed reactions: %+v (toggle said %+v)", first.Reactions, want)
	}
	for i, r := range first.Reactions {
		if r.Emoji != want[i].Emoji || len(r.UserIds) != 1 {
			t.Errorf("reaction %d = %q x%d, want %q x1", i, r.Emoji, len(r.UserIds), want[i].Emoji)
		}
	}
	if len(second.Reactions) != 0 {
		t.Errorf("second message should have no reactions: %+v", second.Reactions)
	}
	// Edit keeps them too.
	ed, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: id, Content: "hello!"}))
	if err != nil || len(ed.Msg.Message.Reactions) != len(want) {
		t.Errorf("edit should return reactions: %v %+v", err, ed)
	}

	// Deleting the message cascades its reactions away.
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM message_reactions WHERE message_id = $1`, id).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d reactions survived the message's deletion", left)
	}
}
