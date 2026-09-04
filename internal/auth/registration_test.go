package auth_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/Jhut89/stoop/gen/stoop/auth/v1"
	"github.com/Jhut89/stoop/internal/auth"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/db/dbtest"
)

type fakePolicy struct{ policy string }

func (p *fakePolicy) RegistrationPolicy(context.Context) (string, error) { return p.policy, nil }

// fakeInvites accepts one code; redeems join "space-1" and count down uses.
type fakeInvites struct {
	code     string
	uses     int
	redeemed []string
}

func (f *fakeInvites) ValidateInvite(_ context.Context, code string) error {
	if code != f.code {
		return connect.NewError(connect.CodeNotFound, errors.New("invite not found"))
	}
	if f.uses <= 0 {
		return connect.NewError(connect.CodeResourceExhausted, errors.New("this invite has reached its maximum number of uses"))
	}
	return nil
}

func (f *fakeInvites) RedeemInvite(_ context.Context, code, userID string) (string, error) {
	if err := f.ValidateInvite(context.Background(), code); err != nil {
		return "", err
	}
	f.uses--
	f.redeemed = append(f.redeemed, userID)
	return "space-1", nil
}

func register(svc *auth.Service, ctx context.Context, user, code string) (*authv1.RegisterResponse, error) {
	res, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Username: user, Password: "correct horse battery", InviteCode: code,
	}))
	if err != nil {
		return nil, err
	}
	return res.Msg, nil
}

func TestRegistrationPolicies(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	policy := &fakePolicy{policy: auth.PolicyInvite}
	invites := &fakeInvites{code: "GOODCODE12", uses: 2}
	svc.UseRegistrationPorts(policy, invites)
	ctx := context.Background()

	// Bootstrap: first account needs no code even under invite policy.
	first, err := register(svc, ctx, "founder", "")
	if err != nil {
		t.Fatalf("bootstrap registration: %v", err)
	}
	if first.User.Role != authv1.InstanceRole_INSTANCE_ROLE_ADMIN {
		t.Errorf("first user role = %v", first.User.Role)
	}

	// invite: no code → denied; bad code → not found; good code → joined.
	if _, err := register(svc, ctx, "nocode", ""); codeOf(err) != connect.CodePermissionDenied {
		t.Errorf("invite policy without code: want permission_denied, got %v", err)
	}
	if _, err := register(svc, ctx, "badcode", "nope"); codeOf(err) != connect.CodeNotFound {
		t.Errorf("invite policy with bad code: want not_found, got %v", err)
	}
	res, err := register(svc, ctx, "invited", "GOODCODE12")
	if err != nil {
		t.Fatalf("invite policy with good code: %v", err)
	}
	if res.JoinedSpaceId != "space-1" || len(invites.redeemed) != 1 || invites.redeemed[0] != res.User.Id {
		t.Errorf("redeem: joined=%q redeemed=%v", res.JoinedSpaceId, invites.redeemed)
	}
	// An admin may create accounts without a code under the invite policy.
	adminCtx := authctx.WithIdentity(ctx, authctx.Identity{UserID: first.User.Id, Role: authctx.RoleAdmin})
	if _, err := register(svc, adminCtx, "seeded_by_admin", ""); err != nil {
		t.Errorf("invite policy as admin without code: %v", err)
	}

	// Exhausted code is rejected before the account is created.
	invites.uses = 0
	if _, err := register(svc, ctx, "late", "GOODCODE12"); codeOf(err) != connect.CodeResourceExhausted {
		t.Errorf("exhausted code: want resource_exhausted, got %v", err)
	}
	if _, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "late", Password: "correct horse battery"})); err == nil {
		t.Error("account must not exist after a rejected registration")
	}

	// closed: anonymous denied; an admin session may create accounts.
	policy.policy = auth.PolicyClosed
	if _, err := register(svc, ctx, "walkin", ""); codeOf(err) != connect.CodePermissionDenied {
		t.Errorf("closed policy anonymous: want permission_denied, got %v", err)
	}
	if _, err := register(svc, adminCtx, "created_by_admin", ""); err != nil {
		t.Errorf("closed policy as admin: %v", err)
	}

	// open: no code needed; a code is still honoured.
	policy.policy = auth.PolicyOpen
	invites.uses = 1
	if _, err := register(svc, ctx, "anyone", ""); err != nil {
		t.Errorf("open policy: %v", err)
	}
	res, err = register(svc, ctx, "anyone_with_code", "GOODCODE12")
	if err != nil || res.JoinedSpaceId != "space-1" {
		t.Errorf("open policy with code: %v %v", res, err)
	}
}

func TestDeactivatedUserLockedOut(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	if _, err := register(svc, ctx, "operator", ""); err != nil {
		t.Fatal(err)
	}
	res, err := register(svc, ctx, "victim", "")
	if err != nil {
		t.Fatal(err)
	}
	login, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "victim", Password: "correct horse battery"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetAccountActive(ctx, res.User.Id, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(ctx, login.Msg.Token); err == nil {
		t.Error("existing session should be revoked on deactivation")
	}
	if _, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "victim", Password: "correct horse battery"})); codeOf(err) != connect.CodePermissionDenied {
		t.Errorf("deactivated login: want permission_denied, got %v", err)
	}
	if _, err := svc.SetAccountActive(ctx, res.User.Id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "victim", Password: "correct horse battery"})); err != nil {
		t.Errorf("reactivated login: %v", err)
	}
}

func TestSetRoleByUsername(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	for _, u := range []string{"founder", "friend"} {
		if _, err := register(svc, ctx, u, ""); err != nil {
			t.Fatal(err)
		}
	}
	// founder is the only admin: demotion refused.
	if _, err := svc.SetRoleByUsername(ctx, "founder", authctx.RoleMember); err == nil {
		t.Error("demoting the last admin should be refused")
	}
	if _, err := svc.SetRoleByUsername(ctx, "nobody", authctx.RoleAdmin); codeOf(err) != connect.CodeNotFound {
		t.Errorf("unknown user: want not_found, got %v", err)
	}
	a, err := svc.SetRoleByUsername(ctx, "friend", authctx.RoleAdmin)
	if err != nil || a.Role != authctx.RoleAdmin {
		t.Fatalf("promote friend: %v %v", a, err)
	}
	a, err = svc.SetRoleByUsername(ctx, "founder", authctx.RoleMember)
	if err != nil || a.Role != authctx.RoleMember {
		t.Errorf("demote founder with another admin present: %v %v", a, err)
	}
}

func TestReservedUsernames(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	if _, err := register(svc, ctx, "everyone", ""); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("reserved username: want invalid_argument, got %v", err)
	}
	if _, err := register(svc, ctx, "Here", ""); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("reserved username (case-insensitive): want invalid_argument, got %v", err)
	}
}
