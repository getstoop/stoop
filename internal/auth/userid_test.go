package auth_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestMalformedUserIDIsNotFound(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	bg := context.Background()
	username, displayName := "ada", "Ada"
	paths := map[string]func() error{
		"SetAccountRole": func() error {
			_, err := svc.SetAccountRole(bg, "nope", authctx.RoleAdmin)
			return err
		},
		"SetAccountRole demote": func() error {
			_, err := svc.SetAccountRole(bg, "nope", authctx.RoleMember)
			return err
		},
		"SetAccountActive": func() error {
			_, err := svc.SetAccountActive(bg, "nope", true)
			return err
		},
		"SetAccountActive deactivate": func() error {
			_, err := svc.SetAccountActive(bg, "nope", false)
			return err
		},
		"RenameAccount": func() error {
			_, err := svc.RenameAccount(bg, "nope", &username, &displayName)
			return err
		},
		"ClearAccountProfile": func() error {
			_, err := svc.ClearAccountProfile(bg, "nope", true, true)
			return err
		},
		"ResetPassword": func() error {
			_, _, err := svc.ResetPassword(bg, "nope")
			return err
		},
		"GetUserProfile": func() error {
			_, err := svc.GetUserProfile(bg, connect.NewRequest(&authv1.GetUserProfileRequest{UserId: "nope"}))
			return err
		},
	}
	for name, call := range paths {
		t.Run(name, func(t *testing.T) {
			if err := call(); connect.CodeOf(err) != connect.CodeNotFound {
				t.Errorf("want not_found, got %v", err)
			}
		})
	}
}
