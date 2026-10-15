package chat_test

import (
	"context"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// A rename tells each of the person's spaces and their own devices.
func TestAnnounceRename(t *testing.T) {
	fixture := newPrivateFixture(t)
	beaID := authctx.UserID(fixture.bea)
	space := fixture.bus.Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()
	own := fixture.bus.Subscribe(events.UserTopic(beaID))
	defer own.Close()

	fixture.svc.AnnounceRename(context.Background(), beaID)

	for name, sub := range map[string]*events.Subscription{"space": space, "own devices": own} {
		select {
		case ev := <-sub.Events():
			updated := ev.GetMemberUpdated()
			if updated == nil || updated.UserId != beaID {
				t.Errorf("%s heard %v, want member_updated for bea", name, ev)
			}
		case <-time.After(2 * time.Second):
			t.Errorf("%s heard nothing", name)
		}
	}
}
