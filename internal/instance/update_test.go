package instance_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

type fixedUpdate instance.Update

func (f fixedUpdate) LatestRelease(context.Context) instance.Update { return instance.Update(f) }

func TestGetUpdate(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers())
	admin, member := as("a", authctx.RoleAdmin), as("m", authctx.RoleMember)
	req := connect.NewRequest(&instancev1.GetUpdateRequest{})

	if _, err := svc.GetUpdate(member, req); code(err) != connect.CodePermissionDenied {
		t.Errorf("member GetUpdate: %v", err)
	}

	res, err := svc.GetUpdate(admin, req)
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Latest != "" || res.Msg.Available {
		t.Errorf("with the check off: %+v", res.Msg)
	}

	svc.UseUpdateChecker(fixedUpdate{Latest: "0.3.0", Available: true, Outdated: true})
	res, err = svc.GetUpdate(admin, req)
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Latest != "0.3.0" || !res.Msg.Available || !res.Msg.Outdated {
		t.Errorf("update = %+v", res.Msg)
	}
}
