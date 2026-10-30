package chat

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/pbtime"
	"github.com/getstoop/stoop/internal/rowid"
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
	// A label is a few words for the people who list invites; the
	// column's check agrees.
	maxInviteLabel = 60
)

func (s *Service) CreateInvite(ctx context.Context, req *connect.Request[chatv1.CreateInviteRequest]) (*connect.Response[chatv1.CreateInviteResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.InvitesCreate); err != nil {
		return nil, err
	}

	var expiresAt *time.Time
	if d := req.Msg.ExpiresIn; d != nil {
		if err := d.CheckValid(); err != nil {
			return nil, apierr.Field(connect.CodeInvalidArgument, "expires_in", fmt.Errorf("an invite's lifetime: %w", err))
		}
		lifetime := d.AsDuration()
		if lifetime <= 0 || lifetime > maxInviteLifetime {
			return nil, apierr.Field(connect.CodeInvalidArgument, "expires_in",
				errors.New("an invite lasts between 1 second and 365 days"))
		}
		t := time.Now().Add(lifetime)
		expiresAt = &t
	}
	if req.Msg.MaxUses != nil && *req.Msg.MaxUses < 1 {
		return nil, apierr.Field(connect.CodeInvalidArgument, "max_uses",
			errors.New("max uses must be at least 1"))
	}
	// Every invite joins people as a member; admins are made from Members
	// once they are in. The field stays on the wire, and asking for more
	// is refused rather than quietly lowered, so nobody believes they
	// handed out admin.
	switch req.Msg.Role {
	case chatv1.SpaceRole_SPACE_ROLE_UNSPECIFIED, chatv1.SpaceRole_SPACE_ROLE_MEMBER:
	default:
		return nil, apierr.Field(connect.CodeInvalidArgument, "role",
			errors.New("an invite joins people as a member; make them an admin from Members once they're in"))
	}
	label := strings.TrimSpace(req.Msg.Label)
	if utf8.RuneCountInString(label) > maxInviteLabel {
		return nil, apierr.Field(connect.CodeInvalidArgument, "label",
			fmt.Errorf("a label is at most %d characters", maxInviteLabel))
	}

	var invite dbgen.Invite
	for attempt := 0; ; attempt++ {
		code, err := newInviteCode()
		if err != nil {
			return nil, fmt.Errorf("generate invite code: %w", err)
		}
		invite, err = s.q.CreateInvite(ctx, dbgen.CreateInviteParams{
			ID: rowid.New(), SpaceID: req.Msg.SpaceId, Code: code,
			CreatedBy: authctx.UserID(ctx), ExpiresAt: expiresAt, MaxUses: req.Msg.MaxUses,
			Role: string(RoleMember), Label: label,
		})
		if err == nil {
			break
		}
		if db.HasCode(err, db.UniqueViolation) && attempt < inviteCodeAttempts-1 {
			continue
		}
		return nil, fmt.Errorf("create invite: %w", err)
	}

	return connect.NewResponse(&chatv1.CreateInviteResponse{Invite: toProtoInvite(invite)}), nil
}

// ListInvites is gated like CreateInvite: seeing live codes is as good as
// minting them. What it lists follows invites.manage: with it, every
// invite to the space; without, only the caller's own.
func (s *Service) ListInvites(ctx context.Context, req *connect.Request[chatv1.ListInvitesRequest]) (*connect.Response[chatv1.ListInvitesResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.InvitesCreate); err != nil {
		return nil, err
	}
	manages, err := s.managesInvites(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, err
	}
	var rows []dbgen.Invite
	if manages {
		rows, err = s.q.ListInvitesBySpace(ctx, req.Msg.SpaceId)
	} else {
		rows, err = s.q.ListInvitesByCreator(ctx, dbgen.ListInvitesByCreatorParams{
			SpaceID: req.Msg.SpaceId, CreatedBy: authctx.UserID(ctx),
		})
	}
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.CreatedBy
	}
	creators, err := s.resolveAuthors(ctx, ids)
	if err != nil {
		return nil, err
	}
	invites := make([]*chatv1.Invite, len(rows))
	for i, r := range rows {
		invites[i] = toProtoInvite(r)
		invites[i].Creator = authorOrUnknown(creators, r.CreatedBy)
	}
	return connect.NewResponse(&chatv1.ListInvitesResponse{Invites: invites}), nil
}

// managesInvites reports whether a caller already admitted by
// invites.create also holds invites.manage here, without the refusal
// requirePermission would write: it shapes what is listed, it doesn't
// gate it.
func (s *Service) managesInvites(ctx context.Context, spaceID string) (bool, error) {
	if !authctx.CoversSpace(ctx, authctx.InvitesManage, spaceID) {
		return false, nil
	}
	caller, err := s.actorFor(ctx, spaceID)
	if err != nil {
		return false, err
	}
	return allowed(caller, authctx.InvitesManage, false), nil
}

func (s *Service) RevokeInvite(ctx context.Context, req *connect.Request[chatv1.RevokeInviteRequest]) (*connect.Response[chatv1.RevokeInviteResponse], error) {
	invite, err := s.q.GetInvite(ctx, req.Msg.InviteId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "invite")
	}
	if err := s.requireInviteAccess(ctx, invite); err != nil {
		return nil, err
	}
	revoked, err := s.q.RevokeInvite(ctx, invite.ID)
	if err != nil {
		return nil, fmt.Errorf("revoke invite: %w", err)
	}
	return connect.NewResponse(&chatv1.RevokeInviteResponse{Invite: toProtoInvite(revoked)}), nil
}

// ListInviteUses lists who joined through one invite, newest first, for
// whoever may act on the invite.
func (s *Service) ListInviteUses(ctx context.Context, req *connect.Request[chatv1.ListInviteUsesRequest]) (*connect.Response[chatv1.ListInviteUsesResponse], error) {
	invite, err := s.q.GetInvite(ctx, req.Msg.InviteId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "invite")
	}
	if err := s.requireInviteAccess(ctx, invite); err != nil {
		return nil, err
	}
	rows, err := s.q.ListInviteUses(ctx, invite.ID)
	if err != nil {
		return nil, fmt.Errorf("list invite uses: %w", err)
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.UserID
	}
	users, err := s.resolveAuthors(ctx, ids)
	if err != nil {
		return nil, err
	}
	uses := make([]*chatv1.InviteUse, len(rows))
	for i, r := range rows {
		uses[i] = &chatv1.InviteUse{User: authorOrUnknown(users, r.UserID), UsedAt: timestamppb.New(r.UsedAt)}
	}
	return connect.NewResponse(&chatv1.ListInviteUsesResponse{Uses: uses}), nil
}

// requireInviteAccess admits the caller to one invite: its creator, as
// long as they're still in the space and the credential reaches it, or
// anyone with invites.manage. Revoking and seeing who joined share it.
func (s *Service) requireInviteAccess(ctx context.Context, invite dbgen.Invite) error {
	if invite.CreatedBy != authctx.UserID(ctx) {
		return s.requirePermission(ctx, invite.SpaceID, authctx.InvitesManage)
	}
	if !authctx.CoversSpace(ctx, authctx.InvitesCreate, invite.SpaceID) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Refusal(ctx, authctx.InvitesCreate))
	}
	caller, err := s.actorFor(ctx, invite.SpaceID)
	if err != nil {
		return err
	}
	if !caller.member && !caller.instanceAdmin {
		return connect.NewError(connect.CodePermissionDenied, errors.New("not a member of this space"))
	}
	return nil
}

// JoinSpace redeems an invite code. Membership is granted and one use is
// consumed in a single transaction; the consume is a guarded UPDATE so
// concurrent joins cannot push use_count past max_uses.
func (s *Service) JoinSpace(ctx context.Context, req *connect.Request[chatv1.JoinSpaceRequest]) (*connect.Response[chatv1.JoinSpaceResponse], error) {
	// A token limited to spaces can't widen its own reach by joining another,
	// and a bot never joins on its own: its spaces are set on the bot.
	if id, _ := authctx.From(ctx); id.Credential.Bounded {
		return nil, connect.NewError(connect.CodePermissionDenied, authctx.ErrOutOfBounds)
	}
	if err := refuseBot(ctx, "a bot's spaces are set from Server admin → Integrations"); err != nil {
		return nil, err
	}
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
	return connect.NewResponse(&chatv1.JoinSpaceResponse{Space: toProtoSpace(space, memberActor(role, authctx.IsAdmin(ctx)), callerCredential(ctx))}), nil
}

// ValidateInvite reports whether a code could be redeemed right now,
// without consuming it. Exposed for the auth module's InviteRedeemer port
// (invite-gated registration checks before creating the account).
func (s *Service) ValidateInvite(ctx context.Context, code string) error {
	invite, err := s.q.GetInviteByCode(ctx, strings.TrimSpace(code))
	if err != nil {
		return apierr.NotFoundOr(err, "invite")
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
		return nil, apierr.NotFoundOr(err, "invite")
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

// InviteShowsIcon reports whether code is a usable invite to the space
// whose icon is fileID. Exposed for the files module, which serves that
// icon to the invite page before sign-in.
func (s *Service) InviteShowsIcon(ctx context.Context, code, fileID string) (bool, error) {
	row, err := s.q.LookupInviteByCode(ctx, strings.TrimSpace(code))
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if inviteUsable(row.Invite, time.Now()) != nil {
		return false, nil
	}
	return row.SpaceIconFileID != nil && *row.SpaceIconFileID == fileID, nil
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
		return dbgen.Space{}, "", apierr.Field(connect.CodeInvalidArgument, "code", errors.New("invite code is required"))
	}

	invite, err := s.q.GetInviteByCode(ctx, code)
	if err != nil {
		return dbgen.Space{}, "", apierr.NotFoundOr(err, "invite")
	}
	space, err := s.q.GetSpace(ctx, invite.SpaceID)
	if err != nil {
		return dbgen.Space{}, "", apierr.NotFoundOr(err, "space")
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

	// New invites grant member. One minted before admin invites were
	// withdrawn is honoured until it is spent, re-capped at what its
	// creator holds *now*, so a demoted or departed creator's admin invite
	// grants member.
	granted, err := s.roleGrantedBy(ctx, invite)
	if err != nil {
		return dbgen.Space{}, "", err
	}

	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.ConsumeInvite(ctx, code); err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("consume invite: %w", err)
			}
			// The guard rejected it; re-read so the error names the reason.
			current, err := qtx.GetInviteByCode(ctx, code)
			if err != nil {
				return apierr.NotFoundOr(err, "invite")
			}
			return inviteRejection(current, time.Now())
		}
		if err := qtx.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
			SpaceID: space.ID, UserID: userID, Role: string(granted),
		}); err != nil {
			return fmt.Errorf("join space: %w", err)
		}
		// Who came in on which invite, for its creator and the admins.
		if err := qtx.RecordInviteUse(ctx, dbgen.RecordInviteUseParams{
			ID: rowid.New(), InviteID: invite.ID, UserID: userID,
		}); err != nil {
			return fmt.Errorf("record invite use: %w", err)
		}
		return nil
	})
	if err != nil {
		return dbgen.Space{}, "", err
	}

	s.publishSpaceJoined(userID, space, memberActor(granted, authctx.IsAdmin(ctx)))
	return space, granted, nil
}

// roleGrantedBy resolves the role an invite confers today: its stored role,
// capped at the creator's current effective role in the space. Only
// invites from before admin invites were withdrawn store anything but
// member.
func (s *Service) roleGrantedBy(ctx context.Context, invite dbgen.Invite) (Role, error) {
	granted := Role(invite.Role)
	if granted == RoleMember {
		return RoleMember, nil
	}
	creatorRecord, _, err := s.lookupUser(ctx, invite.CreatedBy)
	if err != nil {
		return "", fmt.Errorf("look up invite creator: %w", err)
	}
	creator, err := s.actorForUser(ctx, invite.SpaceID, invite.CreatedBy, creatorRecord.InstanceAdmin)
	if err != nil {
		return "", err
	}
	return capRole(creator, granted), nil
}

// joinAsInstanceAdmin is the invite-free join available to the server
// operator. They enter as a plain member: their admin powers come from the
// instance role, so demoting them later leaves an ordinary membership.
func (s *Service) joinAsInstanceAdmin(ctx context.Context, userID, spaceID string) (*connect.Response[chatv1.JoinSpaceResponse], error) {
	if !authctx.Allows(ctx, authctx.SpacesJoinAny) {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("joining without an invite requires the instance admin role"))
	}
	space, err := s.q.GetSpace(ctx, spaceID)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "space")
	}
	isMember, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: space.ID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if isMember {
		existing, err := s.actorForUser(ctx, space.ID, userID, true)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&chatv1.JoinSpaceResponse{Space: toProtoSpace(space, memberActor(existing.role, true), callerCredential(ctx))}), nil
	}
	if err := s.q.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
		SpaceID: space.ID, UserID: userID, Role: string(RoleMember),
	}); err != nil {
		return nil, fmt.Errorf("join space: %w", err)
	}
	s.publishSpaceJoined(userID, space, memberActor(RoleMember, true))
	return connect.NewResponse(&chatv1.JoinSpaceResponse{Space: toProtoSpace(space, memberActor(RoleMember, true), callerCredential(ctx))}), nil
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

func toProtoInvite(i dbgen.Invite) *chatv1.Invite {
	out := &chatv1.Invite{
		Id: i.ID, SpaceId: i.SpaceID, Code: i.Code, CreatedBy: i.CreatedBy,
		MaxUses: i.MaxUses, UseCount: i.UseCount, CreatedAt: timestamppb.New(i.CreatedAt),
		Role: toProtoRole(Role(i.Role)), Label: i.Label,
	}
	out.ExpiresAt = pbtime.OrNil(i.ExpiresAt)
	out.RevokedAt = pbtime.OrNil(i.RevokedAt)
	return out
}
