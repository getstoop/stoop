package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	netmail "net/mail"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/mail"
)

// EmailJobs queues send_email jobs inside the caller's transaction, so a
// confirmation is only sent for a change that committed.
type EmailJobs interface {
	EnqueueTx(ctx context.Context, tx pgx.Tx, kind string, args any) (string, error)
}

// Throttle is auth's port onto a rate limiter, keyed per account.
type Throttle interface {
	Allow(ctx context.Context, key string) (bool, error)
}

// UseEmailPorts wires the job queue and the instance's "can send email"
// switch.
func (s *Service) UseEmailPorts(jobs EmailJobs, enabled func(ctx context.Context) (bool, error)) {
	s.emailJobs = jobs
	s.emailEnabled = enabled
}

// UseEmailThrottle wires the per-account limit shared by
// RequestEmailChange and ResendEmailConfirmation.
func (s *Service) UseEmailThrottle(throttle Throttle) { s.emailThrottle = throttle }

const maxEmailAddressLen = 254

// emailThrottleRetryAfter is how long one more request takes to come back
// at three an hour.
const emailThrottleRetryAfter = 20 * time.Minute

// emailAddressFrom is one bare address, trimmed, or a refusal on "address".
func emailAddressFrom(raw string) (string, error) { return emailAddressIn(raw, "address") }

// emailAddressIn is emailAddressFrom with the refusal on field.
func emailAddressIn(raw, field string) (string, error) {
	address := strings.TrimSpace(raw)
	if address == "" {
		return "", apierr.Field(connect.CodeInvalidArgument, field, errors.New("Enter an email address."))
	}
	if len(address) > maxEmailAddressLen {
		return "", apierr.Field(connect.CodeInvalidArgument, field,
			fmt.Errorf("An email address is at most %d characters.", maxEmailAddressLen))
	}
	parsed, err := netmail.ParseAddress(address)
	if err != nil || parsed.Name != "" || parsed.Address != address {
		return "", apierr.Field(connect.CodeInvalidArgument, field,
			errors.New("Enter one email address, like casey@example.com."))
	}
	return address, nil
}

// checkAccountPassword is the password check for changing the address; an
// account without a password has nothing to check.
func (s *Service) checkAccountPassword(ctx context.Context, user dbgen.User, password string) error {
	if user.PasswordHash == nil {
		return nil
	}
	if password == "" {
		return apierr.Field(connect.CodeInvalidArgument, "password", errors.New("Enter your password."))
	}
	match, err := s.checkPassword(ctx, password, *user.PasswordHash)
	if err != nil {
		return hashFailure("verify password", err)
	}
	if !match {
		return apierr.Field(connect.CodeInvalidArgument, "password", errors.New("Password is incorrect."))
	}
	return nil
}

// requireEmailOn refuses while the instance can't send email.
// UseLinkBase wires the public URL links are built on.
func (s *Service) UseLinkBase(base func(ctx context.Context) (string, error)) { s.linkBase = base }

// requireEmailOn refuses a request for a link the server can't send: email
// off, or no public URL to build the link on.
func (s *Service) requireEmailOn(ctx context.Context) error {
	if s.emailEnabled == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("This server doesn't send email."))
	}
	enabled, err := s.emailEnabled(ctx)
	if err != nil {
		return fmt.Errorf("read email setting: %w", err)
	}
	if !enabled {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("This server doesn't send email."))
	}
	if s.linkBase != nil {
		base, err := s.linkBase(ctx)
		if err != nil {
			return fmt.Errorf("read public URL: %w", err)
		}
		if base == "" {
			return connect.NewError(connect.CodeFailedPrecondition, errors.New("This server can't send links yet. Ask an admin to set its public address."))
		}
	}
	return nil
}

func (s *Service) allowEmailSend(ctx context.Context, userID string) error {
	if s.emailThrottle == nil {
		return nil
	}
	allowed, err := s.emailThrottle.Allow(ctx, userID)
	if err != nil {
		slog.Error("email throttle store", "err", err)
		return connect.NewError(connect.CodeUnavailable, errors.New("Email is unavailable right now. Try again in a moment."))
	}
	if !allowed {
		err := connect.NewError(connect.CodeResourceExhausted, errors.New("Too many confirmation emails. Try again later."))
		err.Meta().Set("Retry-After", strconv.Itoa(int(emailThrottleRetryAfter.Seconds())))
		return err
	}
	return nil
}

func myEmail(user dbgen.User) *authv1.MyEmail {
	return &authv1.MyEmail{Address: deref(user.Email), PendingAddress: deref(user.PendingEmail)}
}

// queueEmailChanged tells oldAddress, if there was one, that the account's
// address changed or went.
func (s *Service) queueEmailChanged(ctx context.Context, tx pgx.Tx, userID string, oldAddress *string) error {
	if oldAddress == nil || *oldAddress == "" {
		return nil
	}
	if _, err := s.emailJobs.EnqueueTx(ctx, tx, mail.SendEmailKind, mail.JobArgs{
		Template: mail.TemplateEmailChanged, UserID: userID, OldAddress: *oldAddress, At: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("queue change notice: %w", err)
	}
	return nil
}

func (s *Service) queueConfirmEmail(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := s.emailJobs.EnqueueTx(ctx, tx, mail.SendEmailKind, mail.JobArgs{
		Template: mail.TemplateConfirmEmail, UserID: userID,
	}); err != nil {
		return fmt.Errorf("queue confirmation: %w", err)
	}
	return nil
}

func (s *Service) RequestEmailChange(ctx context.Context, req *connect.Request[authv1.RequestEmailChangeRequest]) (*connect.Response[authv1.RequestEmailChangeResponse], error) {
	if err := refuseBotCaller(ctx, "A bot has no email address."); err != nil {
		return nil, err
	}
	if err := s.requireEmailOn(ctx); err != nil {
		return nil, err
	}
	address, err := emailAddressFrom(req.Msg.Address)
	if err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	if err := s.allowEmailSend(ctx, userID); err != nil {
		return nil, err
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if err := s.checkAccountPassword(ctx, user, req.Msg.Password); err != nil {
		return nil, err
	}
	if user.Email != nil && strings.EqualFold(*user.Email, address) {
		return connect.NewResponse(&authv1.RequestEmailChangeResponse{Email: myEmail(user)}), nil
	}
	// Whether another account holds the address is only said by the link.
	err = db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		qtx := s.q.WithTx(tx)
		current, err := qtx.LockUserEmail(ctx, userID)
		if err != nil {
			return fmt.Errorf("lock account: %w", err)
		}
		// Asking again for the address already waiting is a resend: the
		// link already delivered keeps working until the new one is sent.
		if current.PendingEmail == nil || !strings.EqualFold(*current.PendingEmail, address) {
			if err := qtx.SetPendingEmail(ctx, dbgen.SetPendingEmailParams{ID: userID, Address: address}); err != nil {
				return fmt.Errorf("set pending email: %w", err)
			}
			if err := qtx.DeleteUserEmailTokens(ctx, dbgen.DeleteUserEmailTokensParams{UserID: userID, Purpose: confirmEmailPurpose}); err != nil {
				return fmt.Errorf("revoke old links: %w", err)
			}
		}
		return s.queueConfirmEmail(ctx, tx, userID)
	})
	if err != nil {
		return nil, err
	}
	user.PendingEmail = &address
	return connect.NewResponse(&authv1.RequestEmailChangeResponse{Email: myEmail(user)}), nil
}

func (s *Service) ResendEmailConfirmation(ctx context.Context, _ *connect.Request[authv1.ResendEmailConfirmationRequest]) (*connect.Response[authv1.ResendEmailConfirmationResponse], error) {
	if err := refuseBotCaller(ctx, "A bot has no email address."); err != nil {
		return nil, err
	}
	if err := s.requireEmailOn(ctx); err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if user.PendingEmail == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("There's no address waiting to be confirmed."))
	}
	if err := s.allowEmailSend(ctx, userID); err != nil {
		return nil, err
	}
	if err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		return s.queueConfirmEmail(ctx, tx, userID)
	}); err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.ResendEmailConfirmationResponse{}), nil
}

func (s *Service) CancelEmailChange(ctx context.Context, _ *connect.Request[authv1.CancelEmailChangeRequest]) (*connect.Response[authv1.CancelEmailChangeResponse], error) {
	userID := authctx.UserID(ctx)
	var user dbgen.User
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if err := qtx.ClearPendingEmail(ctx, userID); err != nil {
			return fmt.Errorf("clear pending email: %w", err)
		}
		if err := qtx.DeleteUserEmailTokens(ctx, dbgen.DeleteUserEmailTokensParams{UserID: userID, Purpose: confirmEmailPurpose}); err != nil {
			return fmt.Errorf("revoke links: %w", err)
		}
		var err error
		if user, err = qtx.GetUserByID(ctx, userID); err != nil {
			return fmt.Errorf("look up user: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.CancelEmailChangeResponse{Email: myEmail(user)}), nil
}

func (s *Service) RemoveEmail(ctx context.Context, req *connect.Request[authv1.RemoveEmailRequest]) (*connect.Response[authv1.RemoveEmailResponse], error) {
	userID := authctx.UserID(ctx)
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if err := s.checkAccountPassword(ctx, user, req.Msg.Password); err != nil {
		return nil, err
	}
	err = db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		qtx := s.q.WithTx(tx)
		// Read under the lock: a confirmation that just landed decides
		// which address is removed, and so which one is told.
		current, err := qtx.LockUserEmail(ctx, userID)
		if err != nil {
			return fmt.Errorf("lock account: %w", err)
		}
		if err := clearEmail(ctx, qtx, userID); err != nil {
			return err
		}
		return s.queueEmailChanged(ctx, tx, userID, current.Email)
	})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.RemoveEmailResponse{}), nil
}

// clearEmail drops both addresses and every link, on removal and deletion.
func clearEmail(ctx context.Context, qtx *dbgen.Queries, userID string) error {
	if err := qtx.ClearUserEmail(ctx, userID); err != nil {
		return fmt.Errorf("clear email: %w", err)
	}
	if err := qtx.DeleteAllUserEmailTokens(ctx, userID); err != nil {
		return fmt.Errorf("delete email links: %w", err)
	}
	return nil
}
