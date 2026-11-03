package chat

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
)

// Two coalescing writes for one recipient and conversation at once: the
// second must wait for the first (LockActivityPlace), then refresh the
// entry under the id the first gave it, rather than re-checking the id
// its snapshot read and writing nothing. The first write is held open
// by hand, as the real path, and the second goes through notify.
func TestConcurrentRefreshesBothLand(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	bus := events.NewInProcBus()
	svc := New(pool, bus, poolUsers{pool})
	person := func(name string) context.Context {
		return authctx.WithIdentity(ctx, authctx.Identity{UserID: dbtest.NewUser(t, pool, name, "member"), Role: authctx.RoleMember})
	}
	owner, bea := person("ada"), person("bea")
	beaID := authctx.UserID(bea)
	space, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	invite, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: space.Msg.Space.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{beaID}}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id
	send := func(content string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmID, Content: content}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	send("one")
	second := send("two")
	third := send("three")
	sub := bus.Subscribe("user:" + beaID)
	defer sub.Close()

	// The first write: the lock, then the refresh to "two", left open.
	first, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback(ctx) //nolint:errcheck // a no-op after the commit below
	firstQ := dbgen.New(first)
	if err := firstQ.LockActivityPlace(ctx, dmID); err != nil {
		t.Fatal(err)
	}
	held, err := firstQ.UpsertUnreadActivityItems(ctx, dbgen.UpsertUnreadActivityItemsParams{
		Ids: []string{rowid.New()}, UserIds: []string{beaID}, Kind: activityKindDM,
		ChannelID: dmID, MessageID: second.Id, ActorID: authctx.UserID(owner),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 1 {
		t.Fatalf("first write refreshed %d rows, want 1", len(held))
	}

	// The second, as SendMessage records it, must wait for the first.
	done := make(chan error, 1)
	go func() {
		row := messageRow{ID: third.Id, ChannelID: dmID, AuthorID: authctx.UserID(owner), Content: third.Content, InChannel: true}
		done <- svc.notify(ctx, []string{beaID}, alert{kind: activityKindDM, msg: row, coalesce: true})
	}()
	select {
	case err := <-done:
		t.Fatalf("the second write did not wait for the first: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	if err := first.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}

	// The second won: its event names "three" under an id after the
	// first's, and the feed has the one entry, pointing there.
	item := nextItemCreated(t, sub).Item
	if item.MessageId != third.Id || item.Id <= held[0].ID || item.ReadAt != nil {
		t.Errorf("second write's event = %+v, want an unread entry at %s with an id after %s", item, third.Id, held[0].ID)
	}
	var entries int
	var at string
	if err := pool.QueryRow(ctx, `SELECT count(*), max(message_id::text) FROM activity_items WHERE user_id = $1 AND kind = 'dm' AND read_at IS NULL`, beaID).Scan(&entries, &at); err != nil {
		t.Fatal(err)
	}
	if entries != 1 || at != third.Id {
		t.Errorf("bea has %d unread dm entries, newest at %s; want 1 at %s", entries, at, third.Id)
	}
}

// nextItemCreated is the next activity item on a personal topic,
// skipping anything else published there (chat_test has its own).
func nextItemCreated(t *testing.T, sub *events.Subscription) *realtimev1.ActivityItemCreated {
	t.Helper()
	for {
		select {
		case event := <-sub.Events():
			if item := event.GetActivityItemCreated(); item != nil {
				return item
			}
		case <-time.After(5 * time.Second):
			t.Fatal("no activity item arrived")
		}
	}
}
