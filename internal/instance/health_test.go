package instance_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

// Checks answer in registration order, each answer is cached for a
// moment, and a probe that hangs is reported rather than waited for.
func TestGetHealth(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers())
	var runs atomic.Int32
	svc.UseStartedAt(time.Now().Add(-time.Hour))
	svc.UseHealthChecks(
		instance.HealthCheck{Name: "one", Run: func(context.Context) (instance.CheckState, string) {
			runs.Add(1)
			return instance.CheckOK, "fine"
		}},
		instance.HealthCheck{Name: "two", FixTab: "hosting", Run: func(context.Context) (instance.CheckState, string) {
			return instance.CheckOff, "not configured"
		}},
	)
	admin, member := as("a", authctx.RoleAdmin), as("m", authctx.RoleMember)

	if _, err := svc.GetHealth(member, connect.NewRequest(&instancev1.GetHealthRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member GetHealth: %v", err)
	}
	res, err := svc.GetHealth(admin, connect.NewRequest(&instancev1.GetHealthRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	c := res.Msg.Checks
	if len(c) != 2 || c[0].Name != "one" || c[0].State != instancev1.CheckState_CHECK_STATE_OK || c[0].Detail != "fine" ||
		c[1].Name != "two" || c[1].State != instancev1.CheckState_CHECK_STATE_OFF || c[1].FixTab != "hosting" || c[1].CheckedAt == nil {
		t.Errorf("checks = %v", c)
	}
	if res.Msg.ServerStartedAt == nil {
		t.Error("no server_started_at")
	}
	for range 3 {
		if _, err := svc.GetHealth(admin, connect.NewRequest(&instancev1.GetHealthRequest{})); err != nil {
			t.Fatal(err)
		}
	}
	if n := runs.Load(); n != 1 {
		t.Errorf("a check ran %d times within one cache window, want 1", n)
	}
}

func TestGetHealthTimeout(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers())
	svc.UseHealthChecks(instance.HealthCheck{Name: "hung", Run: func(ctx context.Context) (instance.CheckState, string) {
		<-ctx.Done()
		time.Sleep(time.Hour)
		return instance.CheckOK, "never"
	}})
	ctx, cancel := context.WithTimeout(as("a", authctx.RoleAdmin), 200*time.Millisecond)
	defer cancel()
	res, err := svc.GetHealth(ctx, connect.NewRequest(&instancev1.GetHealthRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if c := res.Msg.Checks[0]; c.Name != "hung" || c.State != instancev1.CheckState_CHECK_STATE_DANGER || c.Detail != "no answer in 3s" {
		t.Errorf("hung check = %v", c)
	}
}
