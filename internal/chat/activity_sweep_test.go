package chat_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

func TestSweepActivity(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	// Three mentions of bea: one read long ago, one read just now, one unread.
	ch := sp.Msg.DefaultChannel.Id
	for i := 0; i < 3; i++ {
		if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: ch, Content: "@bea hi"})); err != nil {
			t.Fatal(err)
		}
	}
	list, _ := svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if len(list.Msg.Items) != 3 {
		t.Fatalf("want 3 activity items, got %d", len(list.Msg.Items))
	}
	old, recent := list.Msg.Items[2].Id, list.Msg.Items[1].Id
	if _, err := svc.MarkActivityRead(bea, connect.NewRequest(&chatv1.MarkActivityReadRequest{Ids: []string{old, recent}})); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE activity_items SET read_at = now() - interval '40 days' WHERE id = $1`, old); err != nil {
		t.Fatal(err)
	}

	n, err := svc.SweepActivity(context.Background(), 30*24*time.Hour)
	if err != nil || n != 1 {
		t.Fatalf("sweep removed %d (%v), want 1", n, err)
	}
	list, _ = svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	ids := map[string]bool{}
	for _, x := range list.Msg.Items {
		ids[x.Id] = true
	}
	if ids[old] || !ids[recent] || len(list.Msg.Items) != 2 || list.Msg.UnreadCount != 1 {
		t.Errorf("after sweep: %d left (unread %d), old present %v, recent present %v", len(list.Msg.Items), list.Msg.UnreadCount, ids[old], ids[recent])
	}
	// A zero retention is "keep everything".
	if n, _ := svc.SweepActivity(context.Background(), 0); n != 0 {
		t.Errorf("retention 0 removed %d", n)
	}
}
