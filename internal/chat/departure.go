package chat

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/dbgen"
)

// RemovePerson is auth's port for an account being deleted. Every space
// they own goes to its longest-serving admin, or to fallbackOwnerID
// (the longest-serving instance admin) when it has none; then they leave
// every space. Conversations are left as they are: a deleted person's
// messages stay, and so does the other side's view of them.
func (s *Service) RemovePerson(ctx context.Context, userID, fallbackOwnerID string) error {
	owned, err := s.q.ListOwnedSpaceIDs(ctx, userID)
	if err != nil {
		return fmt.Errorf("list owned spaces: %w", err)
	}
	for _, spaceID := range owned {
		heir, err := s.q.LongestServingAdmin(ctx, spaceID)
		if errors.Is(err, pgx.ErrNoRows) {
			heir = fallbackOwnerID
		} else if err != nil {
			return fmt.Errorf("find an heir: %w", err)
		}
		if heir == "" {
			return errors.New("no admin to take over a space you own")
		}
		if err := s.handOver(ctx, spaceID, userID, heir); err != nil {
			return err
		}
	}
	spaces, err := s.q.ListSpaceIDsByUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("list spaces: %w", err)
	}
	for _, spaceID := range spaces {
		if err := s.removeMember(ctx, spaceID, userID); err != nil {
			return fmt.Errorf("leave space: %w", err)
		}
		s.publishMemberRemoved(spaceID, userID, false)
		s.evictFromSpaceVoice(ctx, spaceID, userID)
	}
	return nil
}

// handOver makes heir the owner of a space, joining them to it first when
// they are not a member. The outgoing owner is demoted in the same
// transaction: the one-owner index forbids two, even briefly.
func (s *Service) handOver(ctx context.Context, spaceID, from, to string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	if _, err := qtx.SetSpaceMemberRole(ctx, dbgen.SetSpaceMemberRoleParams{SpaceID: spaceID, UserID: from, Role: string(RoleAdmin)}); err != nil {
		return fmt.Errorf("demote owner: %w", err)
	}
	n, err := qtx.SetSpaceMemberRole(ctx, dbgen.SetSpaceMemberRoleParams{SpaceID: spaceID, UserID: to, Role: string(RoleOwner)})
	if err != nil {
		return fmt.Errorf("promote heir: %w", err)
	}
	joined := n == 0
	if joined {
		if err := qtx.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{SpaceID: spaceID, UserID: to, Role: string(RoleOwner)}); err != nil {
			return fmt.Errorf("add heir: %w", err)
		}
	}
	if err := qtx.UpdateSpaceOwner(ctx, dbgen.UpdateSpaceOwnerParams{ID: spaceID, OwnerID: to}); err != nil {
		return fmt.Errorf("update owner: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if joined {
		if space, err := s.q.GetSpace(ctx, spaceID); err == nil {
			s.publishSpaceJoined(to, space, memberActor(RoleOwner, false))
		}
	}
	s.publishRoleChanged(spaceID, to, RoleOwner)
	return nil
}
