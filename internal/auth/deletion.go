package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// DeletionPolicy is auth's port for whether people may delete their own
// accounts; backed by instance. Nil means they may.
type DeletionPolicy interface {
	SelfDeletion(ctx context.Context) (bool, error)
}

// AccountDeparture is auth's port onto chat for what a deleted person
// leaves behind: the spaces they own go to someone else, and they leave
// every space. fallbackOwnerID takes a space no space admin can. The
// announcement is a second call, made once the account reads as
// deleted, so what clients fetch on hearing it carries the mark.
type AccountDeparture interface {
	RemovePerson(ctx context.Context, userID, fallbackOwnerID string) (spaceIDs []string, err error)
	AnnounceDeparture(ctx context.Context, userID string, spaceIDs []string)
}

// UseDeletionPorts wires both. Set once at startup.
func (s *Service) UseDeletionPorts(policy DeletionPolicy, departure AccountDeparture) {
	s.deletion = policy
	s.departure = departure
}

// recentSignIn is how old a session may be and still count as the person
// being here. An account that signs in through a provider and has no
// password takes it in the password's place for every change the
// password guards, and every account needs it to link a provider or make
// a personal token (requireRecentSignIn): a stolen session can't set a
// password, move the email address, or add a way back in that outlives
// it.
const recentSignIn = 10 * time.Minute

// DeleteAccount is the caller deleting their own account. The row stays,
// so their messages keep their author and the username stays held;
// everything that was theirs to show goes, and so do their sessions,
// tokens, provider links and email addresses. The spaces they owned are handed on first,
// so a failure there leaves an account that can still be used.
func (s *Service) DeleteAccount(ctx context.Context, req *connect.Request[authv1.DeleteAccountRequest]) (*connect.Response[authv1.DeleteAccountResponse], error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if id.Credential.Kind != authctx.CredentialSession {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("deleting an account needs the app, not a token"))
	}
	if err := refuseBotCaller(ctx, "a bot is removed from Server admin → Integrations"); err != nil {
		return nil, err
	}
	if s.deletion != nil {
		allowed, err := s.deletion.SelfDeletion(ctx)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("this server doesn't let people delete their own accounts; ask an admin"))
		}
	}
	user, err := s.q.GetUserByID(ctx, id.UserID)
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if err := s.confirmIdentity(ctx, user, id.SessionID, req.Msg.Password); err != nil {
		return nil, err
	}
	// The same refusals the locked write below makes, made early: the
	// departure is not undone, so it must not run for an account that
	// then cannot go.
	if user.IsOwner {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("you own this server; hand ownership to another admin first"))
	}
	if authctx.Role(user.Role) == authctx.RoleAdmin {
		n, err := s.q.CountAdmins(ctx)
		if err != nil {
			return nil, fmt.Errorf("count admins: %w", err)
		}
		if n <= 1 {
			return nil, errLastAdmin
		}
	}
	var left []string
	if s.departure != nil {
		fallback, err := s.q.OldestOtherAdmin(ctx, id.UserID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("find an admin: %w", err)
		}
		if left, err = s.departure.RemovePerson(ctx, id.UserID, fallback); err != nil {
			return nil, err
		}
	}
	if _, err := s.underAdminGuard(ctx, id.UserID, func(qtx *dbgen.Queries) (dbgen.User, error) {
		if err := qtx.DeleteUserIdentities(ctx, id.UserID); err != nil {
			return dbgen.User{}, fmt.Errorf("unlink identities: %w", err)
		}
		if err := clearEmail(ctx, qtx, id.UserID); err != nil {
			return dbgen.User{}, err
		}
		return qtx.DeleteAccount(ctx, id.UserID)
	}); err != nil {
		return nil, err
	}
	if err := s.revokeAll(ctx, id.UserID); err != nil {
		return nil, err
	}
	if s.departure != nil {
		s.departure.AnnounceDeparture(ctx, id.UserID, left)
	}
	return connect.NewResponse(&authv1.DeleteAccountResponse{}), nil
}

// confirmIdentity is the second look before something irreversible: the
// password, or for an account without one, a sign-in recent enough to
// count as the person being here.
func (s *Service) confirmIdentity(ctx context.Context, user dbgen.User, sessionID, password string) error {
	if user.PasswordHash != nil {
		match, err := s.accountPasswordMatches(ctx, user, password)
		if err != nil {
			return err
		}
		if !match {
			return apierr.Field(connect.CodeInvalidArgument, "password", errors.New("password is incorrect"))
		}
		return nil
	}
	return s.requireRecentSignIn(ctx, sessionID, "delete your account")
}

// requireRecentSignIn refuses unless the session making the change is
// under recentSignIn old. sessionID is the caller's session, "" for a
// token: a token is never a sign-in, however new. what finishes "sign in
// again first, then …".
func (s *Service) requireRecentSignIn(ctx context.Context, sessionID, what string) error {
	recent := false
	if sessionID != "" { // credentials.id is a uuid: "" would be a query error
		signedIn, err := s.q.GetCredentialCreatedAt(ctx, sessionID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("look up session: %w", err)
		}
		recent = err == nil && time.Since(signedIn) <= recentSignIn
	}
	if !recent {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("sign in again first, then "+what))
	}
	return nil
}
