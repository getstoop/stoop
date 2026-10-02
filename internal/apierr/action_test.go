package apierr

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/authctx"
)

func callerContext(role authctx.Role, credential authctx.Credential) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: "casey", Role: role, Credential: credential,
	})
}

func TestRequireActionRoleDoesNotHold(t *testing.T) {
	ctx := callerContext(authctx.RoleMember, authctx.Credential{})
	err := RequireAction(ctx, authctx.InstanceUsersManage)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want permission denied", connect.CodeOf(err))
	}
	if got := err.(*connect.Error).Message(); got != "instance admin role required" {
		t.Errorf("message = %q", got)
	}
}

func TestRequireActionCredentialDoesNotCover(t *testing.T) {
	credential := authctx.Credential{Grants: []authctx.Action{authctx.InstanceRead}}
	ctx := callerContext(authctx.RoleAdmin, credential)
	err := RequireAction(ctx, authctx.InstanceUsersManage)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want permission denied", connect.CodeOf(err))
	}
	want := authctx.Refusal(ctx, authctx.InstanceUsersManage).Error()
	if got := err.(*connect.Error).Message(); got != want {
		t.Errorf("message = %q, want %q", got, want)
	}
}

func TestRequireActionPasses(t *testing.T) {
	if err := RequireAction(callerContext(authctx.RoleAdmin, authctx.Credential{}), authctx.InstanceUsersManage); err != nil {
		t.Errorf("admin session refused: %v", err)
	}
	credential := authctx.Credential{Grants: []authctx.Action{authctx.InstanceUsersManage}}
	if err := RequireAction(callerContext(authctx.RoleAdmin, credential), authctx.InstanceUsersManage); err != nil {
		t.Errorf("admin with a covering grant refused: %v", err)
	}
}
