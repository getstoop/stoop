package auth_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/jackc/pgx/v5/pgxpool"
)

// socialUser inserts a provider-created account the way the OIDC callback
// will: no password, a pending username, and one linked identity. Returns
// an identity-bearing context for it.
func socialUser(t *testing.T, pool *pgxpool.Pool, username, provider string) (context.Context, string) {
	t.Helper()
	q := dbgen.New(pool)
	ctx := context.Background()
	user, err := q.CreateUser(ctx, dbgen.CreateUserParams{
		ID: uuid.NewString(), Username: username, DisplayName: username,
		PasswordHash: nil, Role: "member", UsernamePending: true,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := q.CreateIdentity(ctx, dbgen.CreateIdentityParams{
		Provider: provider, Subject: "sub-" + username, UserID: user.ID, Email: username + "@example.com",
	}); err != nil {
		t.Fatalf("create identity: %v", err)
	}
	id := authctx.Identity{UserID: user.ID, SessionID: uuid.NewString(), Role: authctx.RoleMember}
	return authctx.WithIdentity(ctx, id), user.ID
}

func TestSetFirstPassword(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, _ := socialUser(t, pool, "sasha", "sso")

	// No password yet: GetMe says so, and login with any password fails.
	me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if me.Msg.User.HasPassword {
		t.Error("HasPassword = true before a password is set")
	}
	if _, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{
		Username: "sasha", Password: "anything at all",
	})); codeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("login without a password: want unauthenticated, got %v", err)
	}

	// The first password needs no current password.
	if _, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		NewPassword: "correct horse battery",
	})); err != nil {
		t.Fatalf("set first password: %v", err)
	}
	me, _ = svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if !me.Msg.User.HasPassword {
		t.Error("HasPassword = false after setting one")
	}
	if _, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{
		Username: "sasha", Password: "correct horse battery",
	})); err != nil {
		t.Errorf("login with the new password: %v", err)
	}

	// From here on the current password is required again.
	if _, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: "wrong", NewPassword: "another fine password",
	})); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("change with wrong current: want invalid_argument, got %v", err)
	}
}

func TestUnlinkIdentityGuard(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, _ := socialUser(t, pool, "quinn", "sso")

	list, err := svc.ListIdentities(ctx, connect.NewRequest(&authv1.ListIdentitiesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Identities) != 1 || list.Msg.Identities[0].Provider != "sso" {
		t.Fatalf("identities = %v, want one 'sso'", list.Msg.Identities)
	}

	// The only sign-in method can't be removed.
	if _, err := svc.UnlinkIdentity(ctx, connect.NewRequest(&authv1.UnlinkIdentityRequest{
		Provider: "sso",
	})); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("unlink last identity: want failed_precondition, got %v", err)
	}

	// With a password set, unlinking works; a second unlink is not found.
	if _, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		NewPassword: "correct horse battery",
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UnlinkIdentity(ctx, connect.NewRequest(&authv1.UnlinkIdentityRequest{Provider: "sso"})); err != nil {
		t.Fatalf("unlink after setting a password: %v", err)
	}
	if _, err := svc.UnlinkIdentity(ctx, connect.NewRequest(&authv1.UnlinkIdentityRequest{
		Provider: "sso",
	})); codeOf(err) != connect.CodeNotFound {
		t.Errorf("second unlink: want not_found, got %v", err)
	}
}

func TestUsernameRename(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, _ := socialUser(t, pool, "temp_handle", "sso")
	taken, _ := signIn(t, svc, "held", "correct horse battery")
	_ = taken

	// Taken and reserved names are rejected; the pending flag survives.
	rename := func(name string) error {
		u := name
		_, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
			DisplayName: "Someone", Username: &u,
		}))
		return err
	}
	if err := rename("held"); codeOf(err) != connect.CodeAlreadyExists {
		t.Errorf("rename to taken: want already_exists, got %v", err)
	}
	if err := rename("admin"); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("rename to reserved: want invalid_argument, got %v", err)
	}
	if err := rename("x"); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("rename too short: want invalid_argument, got %v", err)
	}

	// A valid rename lands and clears the derived-name flag...
	if err := rename("Quinn_9"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	me, _ := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if me.Msg.User.Username != "quinn_9" {
		t.Errorf("username = %q, want lowercased quinn_9", me.Msg.User.Username)
	}
	if me.Msg.User.UsernamePending {
		t.Error("UsernamePending still true after rename")
	}

	// ...and usernames are freely changeable, so renaming again works.
	if err := rename("quinn_10"); err != nil {
		t.Errorf("second rename: %v", err)
	}
	me, _ = svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if me.Msg.User.Username != "quinn_10" {
		t.Errorf("username after second rename = %q", me.Msg.User.Username)
	}

	// A plain display-name update (no username field) always works.
	if _, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Quinn",
	})); err != nil {
		t.Errorf("display-name-only update: %v", err)
	}
}

func TestAdminRenameAccount(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, userID := socialUser(t, pool, "temp_name", "sso")
	signIn(t, svc, "held", "correct horse battery")

	str := func(s string) *string { return &s }
	for name, arg := range map[string]*string{
		"taken":    str("held"),
		"reserved": str("admin"),
		"invalid":  str("x!"),
	} {
		_, err := svc.RenameAccount(context.Background(), userID, arg, nil)
		if err == nil {
			t.Errorf("rename to %s value accepted", name)
		}
	}

	// Admin rename works regardless of the one-time flag, and settles it.
	if _, err := svc.RenameAccount(context.Background(), userID, str("Fresh_Name"), str("  Fresh  ")); err != nil {
		t.Fatal(err)
	}
	me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if me.Msg.User.Username != "fresh_name" || me.Msg.User.DisplayName != "Fresh" || me.Msg.User.UsernamePending {
		t.Errorf("after admin rename = %+v", me.Msg.User)
	}
	// And again: not one-time for admins.
	if _, err := svc.RenameAccount(context.Background(), userID, str("fresh_name2"), nil); err != nil {
		t.Errorf("second admin rename: %v", err)
	}
	if _, err := svc.RenameAccount(context.Background(), "00000000-0000-0000-0000-000000000000", str("ok_name"), nil); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("rename unknown user: %v", err)
	}
}

// An admin can take down pronouns and a bio, one at a time, and has no
// way to write either.
func TestAdminClearAccountProfile(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, _ := signIn(t, svc, "robin", "correct horse battery")
	userID := authctx.UserID(ctx)
	str := func(s string) *string { return &s }
	if _, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Robin", Pronouns: str("any"), Bio: str("Something to take down."),
	})); err != nil {
		t.Fatal(err)
	}

	// Clearing one leaves the other standing.
	u, err := svc.ClearAccountProfile(context.Background(), userID, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if u.Bio != "" || u.Pronouns != "any" {
		t.Errorf("clearing the bio alone = %q/%q", u.Pronouns, u.Bio)
	}
	if u, err = svc.ClearAccountProfile(context.Background(), userID, true, false); err != nil || u.Pronouns != "" {
		t.Errorf("clearing pronouns: %+v %v", u, err)
	}
	// The account still reads its own profile back as empty, not stale.
	me, _ := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if me.Msg.User.Pronouns != "" || me.Msg.User.Bio != "" {
		t.Errorf("GetMe after clear = %q/%q", me.Msg.User.Pronouns, me.Msg.User.Bio)
	}
	if _, err := svc.ClearAccountProfile(context.Background(), "00000000-0000-0000-0000-000000000000", true, true); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("clear on unknown user: %v", err)
	}
}

func TestUsernameFreeze(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, userID := socialUser(t, pool, "loudname", "sso")
	str := func(s string) *string { return &s }

	if _, err := svc.SetAccountUsernameFrozen(context.Background(), userID, true); err != nil {
		t.Fatal(err)
	}
	me, _ := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if !me.Msg.User.UsernameFrozen {
		t.Error("UsernameFrozen not reported")
	}

	// Self-rename is refused while frozen; display-name-only still works.
	if _, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Quiet", Username: str("sneaky"),
	})); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("frozen self-rename: want failed_precondition, got %v", err)
	}
	if _, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Quiet",
	})); err != nil {
		t.Errorf("display-name change while frozen: %v", err)
	}

	// The admin rename bypasses the freeze (fix the handle, keep the lock).
	if _, err := svc.RenameAccount(context.Background(), userID, str("politename"), nil); err != nil {
		t.Fatalf("admin rename while frozen: %v", err)
	}
	me, _ = svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if me.Msg.User.Username != "politename" || !me.Msg.User.UsernameFrozen {
		t.Errorf("after admin rename = %+v", me.Msg.User)
	}

	// Unfreeze restores self-service.
	if _, err := svc.SetAccountUsernameFrozen(context.Background(), userID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Quiet", Username: str("my_own_pick"),
	})); err != nil {
		t.Errorf("rename after unfreeze: %v", err)
	}
}

type fakePasswordPolicy struct{ policy string }

func (p *fakePasswordPolicy) PasswordSignIn(context.Context) (string, error) { return p.policy, nil }

func TestPasswordSignInPolicy(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	pw := &fakePasswordPolicy{policy: auth.PasswordEveryone}
	svc.UsePasswordPolicy(pw)
	ctx := context.Background()
	login := func(user string) error {
		_, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: user, Password: "correct horse battery"}))
		return err
	}

	signIn(t, svc, "boss", "correct horse battery")   // first account: admin
	signIn(t, svc, "member", "correct horse battery") // second: member

	for _, policy := range []string{auth.PasswordAdmins, auth.PasswordOff} {
		pw.policy = policy
		if err := login("boss"); err != nil {
			t.Errorf("%s: admin password login refused: %v", policy, err)
		}
		if err := login("member"); codeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s: member password login: want permission_denied, got %v", policy, err)
		}
		// A wrong password still reads as invalid credentials, not policy.
		if _, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "member", Password: "nope nope nope"})); codeOf(err) != connect.CodeUnauthenticated {
			t.Errorf("%s: wrong password: want unauthenticated, got %v", policy, err)
		}
		// Password sign-up is off too, except for admins creating accounts.
		if _, err := register(svc, ctx, "newbie_"+policy, ""); codeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s: password registration: want permission_denied, got %v", policy, err)
		}
		adminCtx, _ := signIn(t, svc, "boss", "correct horse battery")
		if _, err := register(svc, adminCtx, "made_by_admin_"+policy, ""); err != nil {
			t.Errorf("%s: admin-created account: %v", policy, err)
		}
	}
	pw.policy = auth.PasswordEveryone
	if err := login("member"); err != nil {
		t.Errorf("everyone: member login: %v", err)
	}
}
