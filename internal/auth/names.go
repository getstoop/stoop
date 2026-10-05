package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
)

// usernameFrom normalises a requested username and checks it.
func usernameFrom(raw string) (string, error) {
	name := strings.ToLower(strings.TrimSpace(raw))
	if !usernameRE.MatchString(name) {
		return "", apierr.Field(connect.CodeInvalidArgument, "username",
			errors.New("username must be 3-32 letters, numbers, or _"))
	}
	if reservedUsernames[name] {
		return "", apierr.Field(connect.CodeInvalidArgument, "username",
			fmt.Errorf("%q is reserved; pick another username", name))
	}
	return name, nil
}

// checkPasswordLength refuses a password shorter than minPasswordLen,
// naming the field and calling it noun in the refusal.
func checkPasswordLength(password, field, noun string) error {
	if len(password) < minPasswordLen {
		return apierr.Field(connect.CodeInvalidArgument, field,
			fmt.Errorf("%s must be at least %d characters", noun, minPasswordLen))
	}
	return nil
}

// displayNameFrom trims a requested display name and checks its length.
func displayNameFrom(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > maxDisplayNameLen {
		return "", apierr.Field(connect.CodeInvalidArgument, "display_name",
			fmt.Errorf("display name must be 1-%d characters", maxDisplayNameLen))
	}
	return name, nil
}

// rename is an admin's checked change to an account's names; nil leaves a
// name as it is.
type rename struct {
	username, displayName *string
}

// renameFrom checks both names before anything is written, so a refusal of
// either leaves the account as it was.
func renameFrom(username, displayName *string) (rename, error) {
	var checked rename
	if username != nil {
		name, err := usernameFrom(*username)
		if err != nil {
			return rename{}, err
		}
		checked.username = &name
	}
	if displayName != nil {
		name, err := displayNameFrom(*displayName)
		if err != nil {
			return rename{}, err
		}
		checked.displayName = &name
	}
	return checked, nil
}

// apply writes a checked rename with qtx; current is returned when it
// changes nothing.
func (change rename) apply(ctx context.Context, qtx *dbgen.Queries, current dbgen.User) (dbgen.User, error) {
	user := current
	var err error
	if change.username != nil {
		user, err = qtx.AdminSetUsername(ctx, dbgen.AdminSetUsernameParams{ID: current.ID, Username: *change.username})
		if err != nil {
			if db.HasCode(err, db.UniqueViolation) {
				return dbgen.User{}, apierr.Field(connect.CodeAlreadyExists, "username",
					errors.New("username is taken"))
			}
			return dbgen.User{}, fmt.Errorf("update username: %w", err)
		}
	}
	if change.displayName != nil {
		user, err = qtx.UpdateUserProfile(ctx, dbgen.UpdateUserProfileParams{ID: current.ID, DisplayName: change.displayName})
		if err != nil {
			return dbgen.User{}, fmt.Errorf("update display name: %w", err)
		}
	}
	return user, nil
}

// userByUsername finds an account for the CLI's by-name verbs; usernames
// are citext, so any case matches.
func (s *Service) userByUsername(ctx context.Context, username string) (dbgen.User, error) {
	account, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return dbgen.User{}, apierr.NotFoundOr(err, "user")
	}
	return account, nil
}
