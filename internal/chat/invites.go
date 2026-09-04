package chat

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

const (
	// inviteCodeLen base58 characters ≈ 58 bits of entropy: unguessable, but
	// short enough to read out loud.
	inviteCodeLen = 10
	// Bitcoin-style base58: no 0/O/I/l so codes survive being read aloud.
	inviteAlphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	// Retries on the (astronomically unlikely) code collision.
	inviteCodeAttempts = 5
	maxInviteLifetime  = 365 * 24 * time.Hour
	uniqueViolation    = "23505"
)

func (s *Service) CreateInvite(ctx context.Context, req *connect.Request[chatv1.CreateInviteRequest]) (*connect.Response[chatv1.CreateInviteResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermCreateInvites); err != nil {
		return nil, err
	}

	var expiresAt *time.Time
	if d := req.Msg.ExpiresIn; d != nil {
		if err := d.CheckValid(); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("expires_in: %w", err))
		}
		lifetime := d.AsDuration()
		if lifetime <= 0 || lifetime > maxInviteLifetime {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("expires_in must be between 1 second and 365 days"))
		}
		t := time.Now().Add(lifetime)
		expiresAt = &t
	}
	if req.Msg.MaxUses != nil && *req.Msg.MaxUses < 1 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("max_uses must be at least 1"))
	}
	grant := roleFromProto(req.Msg.Role)
	creator, err := s.actorFor(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, err
	}
	if err := grantableRole(creator, grant); err != nil {
		return nil, err
	}

	var invite dbgen.Invite
	for attempt := 0; ; attempt++ {
		code, err := newInviteCode()
		if err != nil {
			return nil, fmt.Errorf("generate invite code: %w", err)
		}
		invite, err = s.q.CreateInvite(ctx, dbgen.CreateInviteParams{
			ID: newID(), SpaceID: req.Msg.SpaceId, Code: code,
			CreatedBy: authctx.UserID(ctx), ExpiresAt: expiresAt, MaxUses: req.Msg.MaxUses,
			Role: string(grant),
		})
		if err == nil {
			break
		}
		if isUniqueViolation(err) && attempt < inviteCodeAttempts-1 {
			continue
		}
		return nil, fmt.Errorf("create invite: %w", err)
	}

	return connect.NewResponse(&chatv1.CreateInviteResponse{Invite: toProtoInvite(invite)}), nil
}

// ListInvites is gated like CreateInvite: seeing live codes is as good as
// minting them.
func (s *Service) ListInvites(ctx context.Context, req *connect.Request[chatv1.ListInvitesRequest]) (*connect.Response[chatv1.ListInvitesResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermCreateInvites); err != nil {
		return nil, err
	}
	rows, err := s.q.ListInvitesBySpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	invites := make([]*chatv1.Invite, len(rows))
	for i, r := range rows {
		invites[i] = toProtoInvite(r)
	}
	return connect.NewResponse(&chatv1.ListInvitesResponse{Invites: invites}), nil
}

func (s *Service) RevokeInvite(ctx context.Context, req *connect.Request[chatv1.RevokeInviteRequest]) (*connect.Response[chatv1.RevokeInviteResponse], error) {
	userID := authctx.UserID(ctx)
	invite, err := s.q.GetInvite(ctx, req.Msg.InviteId)
	if err != nil {
		return nil, notFoundOr(err, "invite")
	}
	// Your own invites are always yours to revoke; anyone else's needs
	// manage_invites.
	if invite.CreatedBy != userID {
		if err := s.requirePermission(ctx, invite.SpaceID, PermManageInvites); err != nil {
			return nil, err
		}
	}

	revoked, err := s.q.RevokeInvite(ctx, invite.ID)
	if err != nil {
		return nil, fmt.Errorf("revoke invite: %w", err)
	}
	return connect.NewResponse(&chatv1.RevokeInviteResponse{Invite: toProtoInvite(revoked)}), nil
}

// JoinSpace redeems an invite code. Membership is granted and one use is
// consumed in a single transaction; the consume is a guarded UPDATE so
// concurrent joins cannot push use_count past max_uses.
func (s *Service) JoinSpace(ctx context.Context, req *connect.Request[chatv1.JoinSpaceRequest]) (*connect.Response[chatv1.JoinSpaceResponse], error) {
	if req.Msg.SpaceId != "" {
		if err := s.refuseIfBanned(ctx, req.Msg.SpaceId, authctx.UserID(ctx)); err != nil {
			return nil, err
		}
	}
	userID := authctx.UserID(ctx)
	if req.Msg.SpaceId != "" {
		return s.joinAsInstanceAdmin(ctx, userID, req.Msg.SpaceId)
	}
	space, role, err := s.joinWithCode(ctx, userID, req.Msg.Code)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.JoinSpaceResponse{Space: toProtoSpace(space, role)}), nil
}

// ValidateInvite reports whether a code could be redeemed right now,
// without consuming it. Exposed for the auth module's InviteRedeemer port
// (invite-gated registration checks before creating the account).
func (s *Service) ValidateInvite(ctx context.Context, code string) error {
	invite, err := s.q.GetInviteByCode(ctx, strings.TrimSpace(code))
	if err != nil {
		return notFoundOr(err, "invite")
	}
	return inviteUsable(invite, time.Now())
}

// LookupInvite previews the space behind a code without redeeming it.
// Public, so it answers with the space's public face only — the welcome
// text is not in the query behind it — and it refuses a spent code with
// the reason a join would have given.
func (s *Service) LookupInvite(ctx context.Context, req *connect.Request[chatv1.LookupInviteRequest]) (*connect.Response[chatv1.LookupInviteResponse], error) {
	code := strings.TrimSpace(req.Msg.Code)
	if code == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invite code is required"))
	}
	row, err := s.q.LookupInviteByCode(ctx, code)
	if err != nil {
		return nil, notFoundOr(err, "invite")
	}
	if err := inviteUsable(row.Invite, time.Now()); err != nil {
		return nil, err
	}
	granted, err := s.roleGrantedBy(ctx, row.Invite)
	if err != nil {
		return nil, err
	}
	preview := &chatv1.InvitePreview{
		SpaceId:          row.Invite.SpaceID,
		SpaceName:        row.SpaceName,
		SpaceDescription: row.SpaceDescription,
		MemberCount:      int32(min(row.MemberCount, math.MaxInt32)),
		Role:             toProtoRole(granted),
	}
	if row.SpaceIconFileID != nil {
		preview.SpaceIconFileId = *row.SpaceIconFileID
	}
	return connect.NewResponse(&chatv1.LookupInviteResponse{Preview: preview}), nil
}

// inviteUsable reports whether an invite could be redeemed at now,
// explaining a refusal the way a redemption would.
func inviteUsable(inv dbgen.Invite, now time.Time) error {
	if inv.RevokedAt != nil || (inv.ExpiresAt != nil && !inv.ExpiresAt.After(now)) ||
		(inv.MaxUses != nil && inv.UseCount >= *inv.MaxUses) {
		return inviteRejection(inv, now)
	}
	return nil
}

// RedeemInvite joins a user to the invite's space on their behalf. Exposed
// for the auth module's InviteRedeemer port (invite-gated registration).
func (s *Service) RedeemInvite(ctx context.Context, code, userID string) (string, error) {
	space, _, err := s.joinWithCode(ctx, userID, code)
	if err != nil {
		return "", err
	}
	return space.ID, nil
}

// joinWithCode is the shared redemption path for JoinSpace and RedeemInvite.
func (s *Service) joinWithCode(ctx context.Context, userID, rawCode string) (dbgen.Space, Role, error) {
	code := strings.TrimSpace(rawCode)
	if code == "" {
		return dbgen.Space{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("invite code is required"))
	}

	invite, err := s.q.GetInviteByCode(ctx, code)
	if err != nil {
		return dbgen.Space{}, "", notFoundOr(err, "invite")
	}
	space, err := s.q.GetSpace(ctx, invite.SpaceID)
	if err != nil {
		return dbgen.Space{}, "", notFoundOr(err, "space")
	}
	if err := s.refuseIfBanned(ctx, space.ID, userID); err != nil {
		return dbgen.Space{}, "", err
	}

	// Existing members don't burn a use — re-following a link is harmless.
	isMember, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: space.ID, UserID: userID})
	if err != nil {
		return dbgen.Space{}, "", fmt.Errorf("check membership: %w", err)
	}
	if isMember {
		a, err := s.actorForUser(ctx, space.ID, userID, authctx.IsAdmin(ctx) && authctx.UserID(ctx) == userID)
		if err != nil {
			return dbgen.Space{}, "", err
		}
		return space, a.role, nil
	}

	// The invite's role is re-capped at what its creator holds *now*, so a
	// demoted or departed creator's admin invite grants member.
	granted, err := s.roleGrantedBy(ctx, invite)
	if err != nil {
		return dbgen.Space{}, "", err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return dbgen.Space{}, "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	qtx := s.q.WithTx(tx)
	if _, err := qtx.ConsumeInvite(ctx, code); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return dbgen.Space{}, "", fmt.Errorf("consume invite: %w", err)
		}
		// The guard rejected it; re-read so the error names the reason.
		current, err := qtx.GetInviteByCode(ctx, code)
		if err != nil {
			return dbgen.Space{}, "", notFoundOr(err, "invite")
		}
		return dbgen.Space{}, "", inviteRejection(current, time.Now())
	}
	if err := qtx.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
		SpaceID: space.ID, UserID: userID, Role: string(granted),
	}); err != nil {
		return dbgen.Space{}, "", fmt.Errorf("join space: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dbgen.Space{}, "", fmt.Errorf("commit: %w", err)
	}

	s.publishSpaceJoined(userID, space, granted)
	return space, granted, nil
}

// roleGrantedBy resolves the role an invite confers today: its stored role,
// capped at the creator's current effective role in the space.
func (s *Service) roleGrantedBy(ctx context.Context, invite dbgen.Invite) (Role, error) {
	granted := Role(invite.Role)
	if granted == RoleMember {
		return RoleMember, nil
	}
	creatorIsInstanceAdmin := false
	records, err := s.users.GetUsers(ctx, []string{invite.CreatedBy})
	if err != nil {
		return "", fmt.Errorf("look up invite creator: %w", err)
	}
	for _, r := range records {
		if r.ID == invite.CreatedBy {
			creatorIsInstanceAdmin = r.InstanceAdmin
		}
	}
	creator, err := s.actorForUser(ctx, invite.SpaceID, invite.CreatedBy, creatorIsInstanceAdmin)
	if err != nil {
		return "", err
	}
	return capRole(creator, granted), nil
}

// joinAsInstanceAdmin is the invite-free join available to the server
// operator. They enter as a plain member: their admin powers come from the
// instance role, so demoting them later leaves an ordinary membership.
func (s *Service) joinAsInstanceAdmin(ctx context.Context, userID, spaceID string) (*connect.Response[chatv1.JoinSpaceResponse], error) {
	if !authctx.IsAdmin(ctx) {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("joining without an invite requires the instance admin role"))
	}
	space, err := s.q.GetSpace(ctx, spaceID)
	if err != nil {
		return nil, notFoundOr(err, "space")
	}
	if err := s.q.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
		SpaceID: space.ID, UserID: userID, Role: string(RoleMember),
	}); err != nil {
		return nil, fmt.Errorf("join space: %w", err)
	}
	s.publishSpaceJoined(userID, space, RoleAdmin) // effective role: instance admin
	return connect.NewResponse(&chatv1.JoinSpaceResponse{Space: toProtoSpace(space, RoleAdmin)}), nil
}

// inviteRejection explains why ConsumeInvite's guard refused an invite,
// checked in the same order a user would expect to hear about it.
func inviteRejection(inv dbgen.Invite, now time.Time) error {
	switch {
	case inv.RevokedAt != nil:
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("this invite has been revoked"))
	case inv.ExpiresAt != nil && !inv.ExpiresAt.After(now):
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("this invite has expired"))
	case inv.MaxUses != nil && inv.UseCount >= *inv.MaxUses:
		return connect.NewError(connect.CodeResourceExhausted, errors.New("this invite has reached its maximum number of uses"))
	default:
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("this invite can no longer be used"))
	}
}

func newInviteCode() (string, error) {
	// Rejection sampling keeps the distribution uniform: 256 % 58 != 0, so a
	// plain modulo would bias toward the first few alphabet characters.
	const limit = 256 - 256%len(inviteAlphabet)
	code := make([]byte, 0, inviteCodeLen)
	buf := make([]byte, 2*inviteCodeLen)
	for len(code) < inviteCodeLen {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		for _, b := range buf {
			if int(b) < limit {
				code = append(code, inviteAlphabet[int(b)%len(inviteAlphabet)])
				if len(code) == inviteCodeLen {
					break
				}
			}
		}
	}
	return string(code), nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}

func toProtoInvite(i dbgen.Invite) *chatv1.Invite {
	out := &chatv1.Invite{
		Id: i.ID, SpaceId: i.SpaceID, Code: i.Code, CreatedBy: i.CreatedBy,
		MaxUses: i.MaxUses, UseCount: i.UseCount, CreatedAt: timestamppb.New(i.CreatedAt),
		Role: toProtoRole(Role(i.Role)),
	}
	if i.ExpiresAt != nil {
		out.ExpiresAt = timestamppb.New(*i.ExpiresAt)
	}
	if i.RevokedAt != nil {
		out.RevokedAt = timestamppb.New(*i.RevokedAt)
	}
	return out
}
