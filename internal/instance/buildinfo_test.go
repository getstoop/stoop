package instance_test

import (
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

func TestGetBuildInfo(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers())
	svc.UseBuildInfo(instance.BuildInfo{Version: "0.1.0", Commit: "abc1234", BuiltAt: "2026-09-04T00:00:00Z", GoVersion: "go1.25"})
	admin, member := as("a", authctx.RoleAdmin), as("m", authctx.RoleMember)

	if _, err := svc.GetBuildInfo(member, connect.NewRequest(&instancev1.GetBuildInfoRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member GetBuildInfo: %v", err)
	}
	res, err := svc.GetBuildInfo(admin, connect.NewRequest(&instancev1.GetBuildInfoRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Version != "0.1.0" || res.Msg.Commit != "abc1234" || res.Msg.GoVersion != "go1.25" {
		t.Errorf("build info = %+v", res.Msg)
	}
}
