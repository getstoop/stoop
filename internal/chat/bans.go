package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Bans: see docs/architecture/permissions.md → Bans.

var errBanned = connect.NewError(connect.CodePermissionDenied,
	errors.New("you've been removed from this space and can't rejoin"))

// refuseIfBanned is the check every join path runs.
func (s *Service) refuseIfBanned(ctx context.Context, spaceID, userID string) error {
	banned, err := s.q.IsBanned(ctx, dbgen.IsBannedParams{SpaceID: spaceID, UserID: userID})
	if err != nil {
		return fmt.Errorf("check ban: %w", err)
	}
	if banned {
		return errBanned
	}
	return nil
}

func (s *Service) BanMember(ctx context.Context, req *connect.Request[chatv1.BanMemberRequest]) (*connect.Response[chatv1.BanMemberResponse], error) {
	me := authctx.UserID(ctx)
	if req.Msg.UserId == me {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("you can't ban yourself"))
	}
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.MembersManage); err != nil {
		return nil, err
	}
	a, err := s.actorFor(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, err
	}
	// A member is subject to the hierarchy (and the owner is untouchable);
	// someone already gone can be banned by anyone who manages members.
	target, err := s.q.GetSpaceMember(ctx, dbgen.GetSpaceMemberParams{SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId})
	isMember := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("look up member: %w", err)
	}
	if isMember {
		if Role(target.Role) == RoleOwner {
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("the owner can't be banned"))
		}
		if !canActOn(a, Role(target.Role)) {
			return nil, connect.NewError(connect.CodePermissionDenied,
				fmt.Errorf("you can't ban the space's %s", target.Role))
		}
	} else {
		_, found, err := s.lookupUser(ctx, req.Msg.UserId)
		if err != nil {
			return nil, fmt.Errorf("look up user: %w", err)
		}
		if !found {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
	}
	if err := s.q.BanUser(ctx, dbgen.BanUserParams{
		SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId, BannedBy: &me, Reason: req.Msg.Reason,
	}); err != nil {
		return nil, fmt.Errorf("ban: %w", err)
	}
	if isMember {
		if err := s.removeFromSpace(ctx, req.Msg.SpaceId, req.Msg.UserId, true); err != nil {
			return nil, fmt.Errorf("remove member: %w", err)
		}
	} else {
		s.evictFromSpaceVoice(ctx, req.Msg.SpaceId, req.Msg.UserId)
	}
	return connect.NewResponse(&chatv1.BanMemberResponse{}), nil
}

func (s *Service) UnbanMember(ctx context.Context, req *connect.Request[chatv1.UnbanMemberRequest]) (*connect.Response[chatv1.UnbanMemberResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.MembersManage); err != nil {
		return nil, err
	}
	n, err := s.q.UnbanUser(ctx, dbgen.UnbanUserParams{SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId})
	if err != nil {
		return nil, fmt.Errorf("unban: %w", err)
	}
	if n == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("no such ban"))
	}
	return connect.NewResponse(&chatv1.UnbanMemberResponse{}), nil
}

func (s *Service) ListBans(ctx context.Context, req *connect.Request[chatv1.ListBansRequest]) (*connect.Response[chatv1.ListBansResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.MembersManage); err != nil {
		return nil, err
	}
	rows, err := s.q.ListBans(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, fmt.Errorf("list bans: %w", err)
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.UserID
	}
	authors, err := s.resolveAuthors(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.Ban, len(rows))
	for i, ban := range rows {
		out[i] = &chatv1.Ban{
			User: authorOrUnknown(authors, ban.UserID), Reason: ban.Reason, CreatedAt: timestamppb.New(ban.CreatedAt),
		}
	}
	return connect.NewResponse(&chatv1.ListBansResponse{Bans: out}), nil
}
