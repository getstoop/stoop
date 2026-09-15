package auth_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func TestSetDoNotDisturb(t *testing.T) {
	bus := events.NewInProcBus()
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseBus(bus)
	ctx, _ := signIn(t, svc, "ada", "correct horse battery")
	userID := authctx.UserID(ctx)
	sub := bus.Subscribe("user:" + userID)
	defer sub.Close()

	// Every device follows it, so every change is published to the
	// person's own topic.
	next := func(t *testing.T) *realtimev1.DoNotDisturbChanged {
		t.Helper()
		select {
		case ev := <-sub.Events():
			changed := ev.GetDoNotDisturbChanged()
			if changed == nil || changed.UserId != userID {
				t.Fatalf("published %v, want DoNotDisturbChanged for %s", ev, userID)
			}
			return changed
		case <-time.After(2 * time.Second):
			t.Fatal("nothing published")
			return nil
		}
	}
	set := func(t *testing.T, req *authv1.SetDoNotDisturbRequest) *authv1.User {
		t.Helper()
		res, err := svc.SetDoNotDisturb(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.User
	}

	t.Run("on until turned off", func(t *testing.T) {
		if u := set(t, &authv1.SetDoNotDisturbRequest{On: true}); !u.Dnd || u.DndUntil != nil {
			t.Errorf("user = dnd %v until %v, want on with no end", u.Dnd, u.DndUntil)
		}
		if c := next(t); !c.Dnd || c.Until != nil {
			t.Errorf("event = dnd %v until %v, want on with no end", c.Dnd, c.Until)
		}
		on, until, err := svc.DoNotDisturb(context.Background(), userID)
		if err != nil || !on || until != nil {
			t.Errorf("lookup = %v %v %v, want on with no end", on, until, err)
		}
	})

	t.Run("on until a time", func(t *testing.T) {
		end := time.Now().Add(time.Hour).Truncate(time.Microsecond)
		u := set(t, &authv1.SetDoNotDisturbRequest{On: true, Until: timestamppb.New(end)})
		if !u.Dnd || u.DndUntil == nil || !u.DndUntil.AsTime().Equal(end) {
			t.Errorf("user = dnd %v until %v, want on until %v", u.Dnd, u.DndUntil, end)
		}
		if c := next(t); !c.Dnd || c.Until == nil || !c.Until.AsTime().Equal(end) {
			t.Errorf("event = dnd %v until %v, want on until %v", c.Dnd, c.Until, end)
		}
		me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
		if err != nil || !me.Msg.User.Dnd {
			t.Errorf("GetMe dnd = %v (%v), want true", me.Msg.GetUser().GetDnd(), err)
		}
	})

	// Off clears the end as well, even when one is sent.
	t.Run("off", func(t *testing.T) {
		end := timestamppb.New(time.Now().Add(time.Hour))
		if u := set(t, &authv1.SetDoNotDisturbRequest{On: false, Until: end}); u.Dnd || u.DndUntil != nil {
			t.Errorf("user = dnd %v until %v, want off", u.Dnd, u.DndUntil)
		}
		if c := next(t); c.Dnd || c.Until != nil {
			t.Errorf("event = dnd %v until %v, want off", c.Dnd, c.Until)
		}
	})

	t.Run("an end in the past is refused", func(t *testing.T) {
		past := timestamppb.New(time.Now().Add(-time.Minute))
		_, err := svc.SetDoNotDisturb(ctx, connect.NewRequest(&authv1.SetDoNotDisturbRequest{On: true, Until: past}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("err = %v, want invalid_argument", err)
		}
	})
}

// Nothing sweeps an ended do not disturb: every read decides it against
// the clock.
func TestDoNotDisturbPastItsEndReadsOff(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, _ := signIn(t, svc, "ada", "correct horse battery")
	userID := authctx.UserID(ctx)
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET dnd = true, dnd_until = now() - interval '1 minute' WHERE id = $1`, userID); err != nil {
		t.Fatal(err)
	}

	on, until, err := svc.DoNotDisturb(context.Background(), userID)
	if err != nil || on || until != nil {
		t.Errorf("lookup = %v %v %v, want off", on, until, err)
	}
	me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if err != nil || me.Msg.User.Dnd || me.Msg.User.DndUntil != nil {
		t.Errorf("GetMe = dnd %v until %v (%v), want off", me.Msg.GetUser().GetDnd(), me.Msg.GetUser().GetDndUntil(), err)
	}
	card, err := svc.GetUserProfile(ctx, connect.NewRequest(&authv1.GetUserProfileRequest{UserId: userID}))
	if err != nil || card.Msg.Profile.Dnd {
		t.Errorf("profile dnd = %v (%v), want false", card.Msg.GetProfile().GetDnd(), err)
	}
}
