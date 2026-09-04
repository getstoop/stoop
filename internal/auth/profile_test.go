package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/Jhut89/stoop/gen/stoop/auth/v1"
	"github.com/Jhut89/stoop/internal/auth"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/db/dbtest"
)

func codeOf(err error) connect.Code {
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return cerr.Code()
	}
	return 0
}

// signIn registers (if needed) and logs in, returning a context carrying
// the new session's identity and the raw token.
func signIn(t *testing.T, svc *auth.Service, user, pass string) (context.Context, string) {
	t.Helper()
	ctx := context.Background()
	_, _ = svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{Username: user, Password: pass}))
	login, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: user, Password: pass}))
	if err != nil {
		t.Fatalf("login %s: %v", user, err)
	}
	id, err := svc.VerifyToken(ctx, login.Msg.Token)
	if err != nil {
		t.Fatal(err)
	}
	return authctx.WithIdentity(ctx, id), login.Msg.Token
}

func TestUpdateProfile(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx, _ := signIn(t, svc, "ada", "correct horse battery")

	res, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{DisplayName: "  Ada  "}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.User.DisplayName != "Ada" {
		t.Errorf("display name = %q, want trimmed %q", res.Msg.User.DisplayName, "Ada")
	}
	me, _ := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if me.Msg.User.DisplayName != "Ada" {
		t.Errorf("GetMe display name = %q", me.Msg.User.DisplayName)
	}
	for _, bad := range []string{"", "   ", strings.Repeat("x", 51)} {
		_, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{DisplayName: bad}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("display name %q: want invalid_argument, got %v", bad, err)
		}
	}
}

func TestChangePassword(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx, token := signIn(t, svc, "ada", "correct horse battery")
	_, otherToken := signIn(t, svc, "ada", "correct horse battery") // a second device

	_, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: "wrong", NewPassword: "new password 123",
	}))
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("wrong current password: want invalid_argument, got %v", err)
	}
	_, err = svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: "correct horse battery", NewPassword: "short",
	}))
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("short new password: want invalid_argument, got %v", err)
	}

	if _, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: "correct horse battery", NewPassword: "new password 123",
	})); err != nil {
		t.Fatal(err)
	}
	bg := context.Background()
	if _, err := svc.VerifyToken(bg, token); err != nil {
		t.Error("the calling session should survive a password change")
	}
	if _, err := svc.VerifyToken(bg, otherToken); err == nil {
		t.Error("other sessions should be revoked by a password change")
	}
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: "correct horse battery"})); err == nil {
		t.Error("old password should no longer work")
	}
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: "new password 123"})); err != nil {
		t.Errorf("new password should work: %v", err)
	}
}

// Pronouns and bio: absent leaves a field alone, empty clears it, and a
// pasted line break collapses rather than making a tall profile card.
func TestUpdateProfilePronounsAndBio(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx, _ := signIn(t, svc, "casey", "correct horse battery")
	set := func(p, b *string) *authv1.User {
		t.Helper()
		res, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
			DisplayName: "Casey", Pronouns: p, Bio: b,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.User
	}
	ptr := func(s string) *string { return &s }

	// Unset on a fresh account: both empty, and nothing shows.
	if u := set(nil, nil); u.Pronouns != "" || u.Bio != "" {
		t.Errorf("fresh account = %q/%q, want empty", u.Pronouns, u.Bio)
	}
	u := set(ptr("she/her"), ptr("Runs the\n\ntool library."))
	if u.Pronouns != "she/her" {
		t.Errorf("pronouns = %q", u.Pronouns)
	}
	if u.Bio != "Runs the tool library." {
		t.Errorf("bio = %q, want whitespace collapsed to one line", u.Bio)
	}
	// Absent leaves both alone.
	if u := set(nil, nil); u.Pronouns != "she/her" || u.Bio != "Runs the tool library." {
		t.Errorf("absent changed the fields: %q/%q", u.Pronouns, u.Bio)
	}
	// GetMe agrees, so the profile page renders what was saved.
	me, _ := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if me.Msg.User.Pronouns != "she/her" {
		t.Errorf("GetMe pronouns = %q", me.Msg.User.Pronouns)
	}
	// Empty clears: deleting all the text is an answer, not a cancel.
	if u := set(ptr(""), ptr("  ")); u.Pronouns != "" || u.Bio != "" {
		t.Errorf("empty did not clear: %q/%q", u.Pronouns, u.Bio)
	}
}

// The caps are counted in runes, not bytes: a bio of 300 emoji is 1200
// bytes and must still be accepted.
func TestUpdateProfileLimits(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx, _ := signIn(t, svc, "ada", "correct horse battery")
	update := func(p, b *string) error {
		_, err := svc.UpdateProfile(ctx, connect.NewRequest(&authv1.UpdateProfileRequest{
			DisplayName: "Ada", Pronouns: p, Bio: b,
		}))
		return err
	}
	ptr := func(s string) *string { return &s }

	if err := update(ptr(strings.Repeat("x", 40)), ptr(strings.Repeat("y", 300))); err != nil {
		t.Fatalf("at the cap: %v", err)
	}
	if err := update(ptr(strings.Repeat("🌱", 40)), ptr(strings.Repeat("🌱", 300))); err != nil {
		t.Fatalf("multi-byte runes at the cap: %v", err)
	}
	if err := update(ptr(strings.Repeat("x", 41)), nil); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("41-character pronouns: want invalid_argument, got %v", err)
	}
	if err := update(nil, ptr(strings.Repeat("y", 301))); codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("301-character bio: want invalid_argument, got %v", err)
	}
}

// GetUserProfile draws someone else's card. Any signed-in caller may read
// any profile — there is no shared-space test — and the response carries
// identity only.
func TestGetUserProfile(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	adaCtx, _ := signIn(t, svc, "ada", "correct horse battery")
	beaCtx, _ := signIn(t, svc, "bea", "correct horse battery")
	ptr := func(s string) *string { return &s }
	if _, err := svc.UpdateProfile(adaCtx, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Ada", Pronouns: ptr("they/them"), Bio: ptr("Fixes the bandsaw."),
	})); err != nil {
		t.Fatal(err)
	}
	adaID := authctx.UserID(adaCtx)

	// bea shares no space with ada — they have only just registered — and
	// still sees the profile.
	res, err := svc.GetUserProfile(beaCtx, connect.NewRequest(&authv1.GetUserProfileRequest{UserId: adaID}))
	if err != nil {
		t.Fatalf("read another profile: %v", err)
	}
	got := res.Msg.Profile
	if got.Username != "ada" || got.Pronouns != "they/them" || got.Bio != "Fixes the bandsaw." {
		t.Errorf("profile = %+v", got)
	}
	if got.Id != adaID {
		t.Errorf("profile id = %q, want %q", got.Id, adaID)
	}
	// An unknown id says so plainly: profiles are public, so a NotFound
	// leaks no membership, and the ids are UUIDs rather than a range.
	_, err = svc.GetUserProfile(beaCtx, connect.NewRequest(&authv1.GetUserProfileRequest{
		UserId: "00000000-0000-0000-0000-000000000000",
	}))
	if codeOf(err) != connect.CodeNotFound {
		t.Errorf("unknown user: want not_found, got %v", err)
	}
}
