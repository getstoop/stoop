package auth

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/authctx"
)

// The server owner: one admin no other admin can demote, deactivate or
// reset, so two admins can't lock each other out. The first account owns
// the server; ownership moves only when the owner hands it on, or when the
// host operator runs `stoop admin transfer-owner`.

// TransferOwnership makes toUserID the owner. fromUserID is the caller,
// who must be the owner; "" is the CLI, which may always.
func (s *Service) TransferOwnership(ctx context.Context, fromUserID, toUserID string) (AccountSummary, error) {
	if _, err := uuid.Parse(toUserID); err != nil {
		return AccountSummary{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccountSummary{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	// The roster lock: a demotion or deactivation of the new owner can't
	// slip in between the check below and the hand-over.
	if err := qtx.LockAdminRoster(ctx); err != nil {
		return AccountSummary{}, fmt.Errorf("lock admin roster: %w", err)
	}
	if fromUserID != "" {
		from, err := qtx.GetUserByID(ctx, fromUserID)
		if err != nil {
			return AccountSummary{}, notFoundOr(err, "user")
		}
		if !from.IsOwner {
			return AccountSummary{}, connect.NewError(connect.CodePermissionDenied,
				errors.New("only the server owner can hand ownership on"))
		}
	}
	to, err := qtx.GetUserByID(ctx, toUserID)
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	if to.IsOwner {
		return toSummary(to), nil
	}
	if err := refuseBotTarget(to, "a bot can't own the server"); err != nil {
		return AccountSummary{}, err
	}
	switch {
	case to.DeactivatedAt != nil:
		return AccountSummary{}, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("that account is deactivated; the owner has to be an active admin"))
	case authctx.Role(to.Role) != authctx.RoleAdmin:
		return AccountSummary{}, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("make them an admin first; the owner has to be an active admin"))
	}
	if err := qtx.ClearOwner(ctx); err != nil {
		return AccountSummary{}, fmt.Errorf("clear owner: %w", err)
	}
	u, err := qtx.SetOwner(ctx, to.ID)
	if err != nil {
		return AccountSummary{}, fmt.Errorf("set owner: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return AccountSummary{}, fmt.Errorf("commit: %w", err)
	}
	return toSummary(u), nil
}

// TransferOwnershipByUsername is the CLI's hand-over, with refusals as
// plain sentences.
func (s *Service) TransferOwnershipByUsername(ctx context.Context, username string) (AccountSummary, error) {
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	out, err := s.TransferOwnership(ctx, "", u.ID)
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return AccountSummary{}, errors.New(cerr.Message())
	}
	return out, err
}
