package instance_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

// fakeUsers is an in-memory UserAdmin.
type fakeUsers struct {
	users map[string]*instance.UserSummary
}

func newFakeUsers(specs ...instance.UserSummary) *fakeUsers {
	f := &fakeUsers{users: map[string]*instance.UserSummary{}}
	for _, u := range specs {
		u := u
		f.users[u.ID] = &u
	}
	return f
}
func (f *fakeUsers) CountUsers(context.Context) (int64, error) { return int64(len(f.users)), nil }
func (f *fakeUsers) CountActiveAdmins(context.Context) (int64, error) {
	var n int64
	for _, u := range f.users {
		if u.Role == authctx.RoleAdmin && u.DeactivatedAt == nil {
			n++
		}
	}
	return n, nil
}
func (f *fakeUsers) ListUsers(context.Context) ([]instance.UserSummary, error) {
	out := []instance.UserSummary{}
	for _, u := range f.users {
		out = append(out, *u)
	}
	return out, nil
}
func (f *fakeUsers) SetUserRole(_ context.Context, id string, role authctx.Role) (instance.UserSummary, error) {
	u, ok := f.users[id]
	if !ok {
		return instance.UserSummary{}, errors.New("not found")
	}
	u.Role = role
	return *u, nil
}
func (f *fakeUsers) ResetUserPassword(_ context.Context, id string) (string, instance.UserSummary, error) {
	u, ok := f.users[id]
	if !ok {
		return "", instance.UserSummary{}, errors.New("not found")
	}
	return "temp-password", *u, nil
}
func (f *fakeUsers) SetUserActive(_ context.Context, id string, active bool) (instance.UserSummary, error) {
	u, ok := f.users[id]
	if !ok {
		return instance.UserSummary{}, errors.New("not found")
	}
	if active {
		u.DeactivatedAt = nil
	} else {
		now := time.Now()
		u.DeactivatedAt = &now
	}
	return *u, nil
}

func as(id string, role authctx.Role) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: id, Role: role})
}

func code(err error) connect.Code {
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return cerr.Code()
	}
	return 0
}

func TestStatusAndSettings(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers()
	svc := instance.New(pool, users)
	ctx := context.Background()

	// Before seeding, the default policy is invite; needs_setup with no users.
	st, err := svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if !st.Msg.NeedsSetup || st.Msg.RegistrationPolicy != instancev1.RegistrationPolicy_REGISTRATION_POLICY_INVITE {
		t.Errorf("fresh status = %+v", st.Msg)
	}

	// Seed from env ("open"), then seeding again with a different value is a no-op.
	if err := svc.Seed(ctx, instance.Defaults{RegistrationPolicy: instance.PolicyOpen}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Seed(ctx, instance.Defaults{RegistrationPolicy: instance.PolicyClosed}); err != nil {
		t.Fatal(err)
	}
	if p, _ := svc.RegistrationPolicy(ctx); p != "open" {
		t.Errorf("after seed, policy = %q, want open (second seed must not override)", p)
	}

	// Admin updates it; a member can't; a new Service on the same DB sees it (persistence).
	admin, member := as("a", authctx.RoleAdmin), as("m", authctx.RoleMember)
	closed := instancev1.RegistrationPolicy_REGISTRATION_POLICY_CLOSED
	if _, err := svc.UpdateSettings(member, connect.NewRequest(&instancev1.UpdateSettingsRequest{RegistrationPolicy: &closed})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member UpdateSettings: %v", err)
	}
	res, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{RegistrationPolicy: &closed}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Status.RegistrationPolicy != closed {
		t.Errorf("after update: %+v", res.Msg.Status)
	}
	if p, _ := instance.New(pool, users).RegistrationPolicy(ctx); p != "closed" {
		t.Errorf("persisted policy = %q", p)
	}
	// Space creation defaults to admins; admin can open it up.
	if ok, _ := svc.MembersMayCreateSpaces(ctx); ok {
		t.Error("space creation should default to admins only")
	}
	everyone := instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE
	res2, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{SpaceCreation: &everyone}))
	if err != nil || res2.Msg.Status.SpaceCreation != everyone {
		t.Errorf("space creation update: %v %v", res2, err)
	}
	if ok, _ := svc.MembersMayCreateSpaces(ctx); !ok {
		t.Error("members should be allowed after the update")
	}
	bad := instancev1.RegistrationPolicy_REGISTRATION_POLICY_UNSPECIFIED
	if _, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{RegistrationPolicy: &bad})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("unspecified policy: %v", err)
	}
}

func TestInstanceName(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers()
	admin := as("a", authctx.RoleAdmin)
	ctx := context.Background()

	// Nothing saved and no env (a wiped database under a running server):
	// "Stoop", never blank.
	svc := instance.New(pool, users)
	if got, _ := svc.InstanceName(ctx); got != "Stoop" {
		t.Errorf("unseeded name = %q, want Stoop", got)
	}

	// No env fallback: Seed picks a random "Adjective Noun" name, and a
	// second Seed call (a restart) must not pick a different one.
	if err := svc.Seed(ctx, instance.Defaults{}); err != nil {
		t.Fatal(err)
	}
	first, err := svc.InstanceName(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first == "" || first == "Stoop" {
		t.Errorf("random instance name = %q", first)
	}
	if err := svc.Seed(ctx, instance.Defaults{}); err != nil {
		t.Fatal(err)
	}
	if again, _ := svc.InstanceName(ctx); again != first {
		t.Errorf("second seed changed the name: %q -> %q", first, again)
	}

	// An admin can rename it; a member can't; blank and over-length are
	// refused.
	name := "The Bramblewood"
	res, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{InstanceName: &name}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Status.InstanceName != name {
		t.Errorf("after rename, status name = %q", res.Msg.Status.InstanceName)
	}
	member := as("m", authctx.RoleMember)
	if _, err := svc.UpdateSettings(member, connect.NewRequest(&instancev1.UpdateSettingsRequest{InstanceName: &name})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member rename: %v", err)
	}
	blank := "   "
	if _, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{InstanceName: &blank})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("blank name: %v", err)
	}
	tooLong := strings.Repeat("x", 101)
	if _, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{InstanceName: &tooLong})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("over-length name: %v", err)
	}

	// STOOP_INSTANCE_NAME fallback: never seeded, so it stays live until
	// an admin saves something through the UI.
	envSvc := instance.New(dbtest.New(t), users)
	if err := envSvc.Seed(ctx, instance.Defaults{InstanceNameEnv: "Env Instance"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := envSvc.InstanceName(ctx); got != "Env Instance" {
		t.Errorf("env fallback = %q", got)
	}
}

func TestUserAdministration(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(
		instance.UserSummary{ID: "a", Username: "alice", Role: authctx.RoleAdmin},
		instance.UserSummary{ID: "b", Username: "bob", Role: authctx.RoleMember},
	)
	svc := instance.New(pool, users)
	admin, member := as("a", authctx.RoleAdmin), as("b", authctx.RoleMember)
	ADMIN, MEMBER := authv1.InstanceRole_INSTANCE_ROLE_ADMIN, authv1.InstanceRole_INSTANCE_ROLE_MEMBER

	if _, err := svc.ListUsers(member, connect.NewRequest(&instancev1.ListUsersRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member ListUsers: %v", err)
	}
	if res, err := svc.ListUsers(admin, connect.NewRequest(&instancev1.ListUsersRequest{})); err != nil || len(res.Msg.Users) != 2 {
		t.Errorf("admin ListUsers: %v %v", res, err)
	}
	// Self-changes and last-admin protections.
	if _, err := svc.SetUserRole(admin, connect.NewRequest(&instancev1.SetUserRoleRequest{UserId: "a", Role: MEMBER})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("own role: %v", err)
	}
	if _, err := svc.ResetUserPassword(member, connect.NewRequest(&instancev1.ResetUserPasswordRequest{UserId: "a"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member ResetUserPassword: %v", err)
	}
	if _, err := svc.ResetUserPassword(admin, connect.NewRequest(&instancev1.ResetUserPasswordRequest{UserId: "a"})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("reset own password: want invalid_argument, got %v", err)
	}
	if res, err := svc.ResetUserPassword(admin, connect.NewRequest(&instancev1.ResetUserPasswordRequest{UserId: "b"})); err != nil || res.Msg.TemporaryPassword != "temp-password" || res.Msg.User.Username != "bob" {
		t.Errorf("admin resets bob: %v %v", res, err)
	}
	if _, err := svc.SetUserActive(admin, connect.NewRequest(&instancev1.SetUserActiveRequest{UserId: "a", Active: false})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("deactivate self: %v", err)
	}
	// Promote bob, then alice can be demoted; demote bob again → alice is last admin → protected.
	if _, err := svc.SetUserRole(admin, connect.NewRequest(&instancev1.SetUserRoleRequest{UserId: "b", Role: ADMIN})); err != nil {
		t.Fatal(err)
	}
	bobAdmin := as("b", authctx.RoleAdmin)
	if _, err := svc.SetUserRole(bobAdmin, connect.NewRequest(&instancev1.SetUserRoleRequest{UserId: "a", Role: MEMBER})); err != nil {
		t.Errorf("demoting alice with two admins: %v", err)
	}
	if _, err := svc.SetUserRole(bobAdmin, connect.NewRequest(&instancev1.SetUserRoleRequest{UserId: "a", Role: ADMIN})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetUserRole(admin, connect.NewRequest(&instancev1.SetUserRoleRequest{UserId: "b", Role: MEMBER})); err != nil {
		t.Fatal(err)
	}
	// bob is a member again; nobody but alice is admin.
	if _, err := svc.SetUserActive(bobAdmin, connect.NewRequest(&instancev1.SetUserActiveRequest{UserId: "a", Active: false})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("deactivating the last admin: want failed_precondition, got %v", err)
	}
	// Deactivate / reactivate a member.
	res, err := svc.SetUserActive(admin, connect.NewRequest(&instancev1.SetUserActiveRequest{UserId: "b", Active: false}))
	if err != nil || res.Msg.User.DeactivatedAt == nil {
		t.Errorf("deactivate bob: %v %v", res, err)
	}
	res, err = svc.SetUserActive(admin, connect.NewRequest(&instancev1.SetUserActiveRequest{UserId: "b", Active: true}))
	if err != nil || res.Msg.User.DeactivatedAt != nil {
		t.Errorf("reactivate bob: %v %v", res, err)
	}
}

func (f *fakeUsers) RenameUser(_ context.Context, userID string, username, displayName *string) (instance.UserSummary, error) {
	u, ok := f.users[userID]
	if !ok {
		return instance.UserSummary{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	if username != nil {
		u.Username = *username
	}
	if displayName != nil {
		u.DisplayName = *displayName
	}
	return *u, nil
}

func (f *fakeUsers) SetUsernameFrozen(_ context.Context, userID string, frozen bool) (instance.UserSummary, error) {
	u, ok := f.users[userID]
	if !ok {
		return instance.UserSummary{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	u.UsernameFrozen = frozen
	return *u, nil
}

func (f *fakeUsers) ClearUserProfile(_ context.Context, userID string, pronouns, bio bool) (instance.UserSummary, error) {
	u, ok := f.users[userID]
	if !ok {
		return instance.UserSummary{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	if pronouns {
		u.Pronouns = ""
	}
	if bio {
		u.Bio = ""
	}
	return *u, nil
}

func TestClearUserProfile(t *testing.T) {
	users := newFakeUsers(
		instance.UserSummary{ID: "a1", Username: "casey", Role: authctx.RoleAdmin},
		instance.UserSummary{ID: "m1", Username: "robin", Role: authctx.RoleMember,
			Pronouns: "any", Bio: "Something to take down."},
	)
	svc := instance.New(dbtest.New(t), users)
	admin, member := as("a1", authctx.RoleAdmin), as("m1", authctx.RoleMember)

	// Moderation is admins only, and a member can't clear their own this
	// way either — that is the profile page's job.
	_, err := svc.ClearUserProfile(member, connect.NewRequest(&instancev1.ClearUserProfileRequest{
		UserId: "m1", Bio: true,
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("member clearing a profile: want permission_denied, got %v", err)
	}
	// Asking for nothing is a mistake worth naming, not a silent no-op.
	_, err = svc.ClearUserProfile(admin, connect.NewRequest(&instancev1.ClearUserProfileRequest{UserId: "m1"}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("clearing neither field: want invalid_argument, got %v", err)
	}
	res, err := svc.ClearUserProfile(admin, connect.NewRequest(&instancev1.ClearUserProfileRequest{
		UserId: "m1", Bio: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.User.Bio != "" || res.Msg.User.Pronouns != "any" {
		t.Errorf("cleared the wrong field: %+v", res.Msg.User)
	}
}

func TestSetUsernameFrozen(t *testing.T) {
	users := newFakeUsers(
		instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin},
		instance.UserSummary{ID: "m1", Username: "loud", Role: authctx.RoleMember},
	)
	svc := instance.New(dbtest.New(t), users)
	admin, member := as("a1", authctx.RoleAdmin), as("m1", authctx.RoleMember)

	freeze := func(ctx context.Context, id string, frozen bool) error {
		_, err := svc.SetUsernameFrozen(ctx, connect.NewRequest(&instancev1.SetUsernameFrozenRequest{
			UserId: id, Frozen: frozen,
		}))
		return err
	}
	if err := freeze(member, "m1", true); code(err) != connect.CodePermissionDenied {
		t.Errorf("member freezing: want permission_denied, got %v", err)
	}
	if err := freeze(admin, "a1", true); code(err) != connect.CodeInvalidArgument {
		t.Errorf("freezing an admin: want invalid_argument, got %v", err)
	}
	if err := freeze(admin, "m1", true); err != nil {
		t.Fatalf("freeze member: %v", err)
	}
	if !users.users["m1"].UsernameFrozen {
		t.Error("member not frozen")
	}
	if err := freeze(admin, "m1", false); err != nil || users.users["m1"].UsernameFrozen {
		t.Errorf("unfreeze: %v, frozen=%v", err, users.users["m1"].UsernameFrozen)
	}
}

// The per-file upload cap: reported as the effective number (the ceiling
// until an operator lowers it), refused above the ceiling, and cleared
// back to the ceiling by 0.
func TestMaxUploadBytes(t *testing.T) {
	pool := dbtest.New(t)
	svc := instance.New(pool, newFakeUsers())
	const ceiling = 100 << 20
	svc.UseUploadCeiling(ceiling)
	ctx, admin := context.Background(), as("a", authctx.RoleAdmin)

	st, err := svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if st.Msg.MaxUploadBytes != ceiling {
		t.Errorf("unset status = %d, want the ceiling %d", st.Msg.MaxUploadBytes, ceiling)
	}

	set := func(n int64) (*connect.Response[instancev1.UpdateSettingsResponse], error) {
		return svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{MaxUploadBytes: &n}))
	}
	res, err := set(8 << 20)
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Status.MaxUploadBytes != 8<<20 {
		t.Errorf("after update = %d, want %d", res.Msg.Status.MaxUploadBytes, 8<<20)
	}
	// files reads the operator's raw setting through the port.
	if n, _ := svc.MaxUploadBytes(ctx); n != 8<<20 {
		t.Errorf("port = %d, want %d", n, 8<<20)
	}
	if _, err := set(ceiling + 1); code(err) != connect.CodeInvalidArgument {
		t.Errorf("above the ceiling: %v", err)
	}
	// Nor above the total storage limit: a per-file cap bigger than the
	// whole disk allowance could never be reached.
	quota := int64(16 << 20)
	if _, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{StorageQuotaBytes: &quota})); err != nil {
		t.Fatal(err)
	}
	if _, err := set(32 << 20); code(err) != connect.CodeInvalidArgument {
		t.Errorf("above the storage limit: %v", err)
	}
	if _, err := set(12 << 20); err != nil {
		t.Errorf("under the storage limit: %v", err)
	}
	// Both in one call are judged against the new total, not the old one.
	bigger, perFile := int64(64<<20), int64(32<<20)
	if _, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{
		StorageQuotaBytes: &bigger, MaxUploadBytes: &perFile,
	})); err != nil {
		t.Errorf("raising both together: %v", err)
	}
	if _, err := set(-1); code(err) != connect.CodeInvalidArgument {
		t.Errorf("negative: %v", err)
	}
	res, err = set(0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Status.MaxUploadBytes != ceiling {
		t.Errorf("after clearing = %d, want the ceiling %d", res.Msg.Status.MaxUploadBytes, ceiling)
	}
}
