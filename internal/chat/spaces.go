package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

func (s *Service) CreateSpace(ctx context.Context, req *connect.Request[chatv1.CreateSpaceRequest]) (*connect.Response[chatv1.CreateSpaceResponse], error) {
	if err := refuseBot(ctx, "a bot can't create a space; a person makes one and adds the bot to it"); err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	if !authctx.Allows(ctx, authctx.SpacesCreate) && s.policy != nil {
		ok, err := s.policy.MembersMayCreateSpaces(ctx)
		if err != nil {
			return nil, fmt.Errorf("check space creation policy: %w", err)
		}
		if !ok {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("only server admins can create spaces on this instance"))
		}
	}
	name, ok := cleanSpaceName(req.Msg.Name)
	if !ok {
		return nil, apierr.Field(connect.CodeInvalidArgument, "name", errSpaceName)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	qtx := s.q.WithTx(tx)
	space, err := qtx.CreateSpace(ctx, dbgen.CreateSpaceParams{
		ID: newID(), Name: name, OwnerID: userID,
	})
	if err != nil {
		return nil, fmt.Errorf("create space: %w", err)
	}
	if err := qtx.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
		SpaceID: space.ID, UserID: userID, Role: string(RoleOwner),
	}); err != nil {
		return nil, fmt.Errorf("add owner as member: %w", err)
	}
	channel, err := qtx.CreateChannel(ctx, dbgen.CreateChannelParams{
		ID: newID(), SpaceID: space.ID, Name: defaultChannelName,
		Kind: int16(chatv1.ChannelKind_CHANNEL_KIND_TEXT), Position: 0,
	})
	if err != nil {
		return nil, fmt.Errorf("create default channel: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return connect.NewResponse(&chatv1.CreateSpaceResponse{
		Space:          toProtoSpace(space, memberActor(RoleOwner, authctx.IsAdmin(ctx)), callerCredential(ctx)),
		DefaultChannel: toProtoChannel(channel),
	}), nil
}

func (s *Service) ListSpaces(ctx context.Context, req *connect.Request[chatv1.ListSpacesRequest]) (*connect.Response[chatv1.ListSpacesResponse], error) {
	if req.Msg.All {
		return s.listAllSpaces(ctx)
	}
	rows, err := s.q.ListSpacesByUser(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list spaces: %w", err)
	}
	cred := callerCredential(ctx)
	spaces := make([]*chatv1.Space, 0, len(rows))
	for _, r := range rows {
		// A bounded credential lists only the spaces it reaches.
		if !cred.Reaches(r.Space.ID, "") {
			continue
		}
		space := toProtoSpace(r.Space, memberActor(Role(r.MyRole), authctx.IsAdmin(ctx)), cred)
		space.HasUnread = r.HasUnread
		space.Muted = r.Muted
		spaces = append(spaces, space)
	}
	return connect.NewResponse(&chatv1.ListSpacesResponse{Spaces: spaces}), nil
}

// listAllSpaces is every space on the server, for whoever may join any
// of them: the standing they'd have on arrival, with no unread or mute
// state, since they may not be in it.
func (s *Service) listAllSpaces(ctx context.Context) (*connect.Response[chatv1.ListSpacesResponse], error) {
	if !authctx.Allows(ctx, authctx.SpacesJoinAny) {
		return nil, connect.NewError(connect.CodePermissionDenied, authctx.Uncovered(authctx.SpacesJoinAny))
	}
	rows, err := s.q.ListAllSpaces(ctx)
	if err != nil {
		return nil, fmt.Errorf("list spaces: %w", err)
	}
	cred := callerCredential(ctx)
	spaces := make([]*chatv1.Space, 0, len(rows))
	for _, space := range rows {
		a, err := s.actorFor(ctx, space.ID)
		if err != nil {
			return nil, err
		}
		spaces = append(spaces, toProtoSpace(space, a, cred))
	}
	return connect.NewResponse(&chatv1.ListSpacesResponse{Spaces: spaces}), nil
}

// ListAllSpaces is the server admin's Spaces page: every space with the
// numbers it shows, whether or not the caller is in it. It reports
// membership rather than a role, because an instance admin's inherited
// admin would otherwise read as membership they don't have — and it
// subscribes them to nothing, since the gateway follows the membership
// rows. There is no per-space bound to apply: instance.read is an
// instance action, so a bounded credential fails the check below rather
// than listing the spaces it reaches.
func (s *Service) ListAllSpaces(ctx context.Context, _ *connect.Request[chatv1.ListAllSpacesRequest]) (*connect.Response[chatv1.ListAllSpacesResponse], error) {
	if !authctx.Allows(ctx, authctx.InstanceRead) {
		return nil, connect.NewError(connect.CodePermissionDenied, authctx.Uncovered(authctx.InstanceRead))
	}
	rows, err := s.q.ListAllSpacesForAdmin(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list spaces: %w", err)
	}
	ownerIDs := make([]string, len(rows))
	for i, r := range rows {
		ownerIDs[i] = r.Space.OwnerID
	}
	owners, err := s.users.GetUsers(ctx, ownerIDs)
	if err != nil {
		return nil, fmt.Errorf("resolve owners: %w", err)
	}
	byID := make(map[string]UserRecord, len(owners))
	for _, o := range owners {
		byID[o.ID] = o
	}
	spaces := make([]*chatv1.SpaceSummary, len(rows))
	for i, r := range rows {
		spaces[i] = toProtoSpaceSummary(r, byID[r.Space.OwnerID])
	}
	return connect.NewResponse(&chatv1.ListAllSpacesResponse{Spaces: spaces}), nil
}

// toProtoSpaceSummary renders one admin row. An owner the directory does
// not know about leaves the names empty rather than failing the list.
func toProtoSpaceSummary(r dbgen.ListAllSpacesForAdminRow, owner UserRecord) *chatv1.SpaceSummary {
	summary := &chatv1.SpaceSummary{
		Id: r.Space.ID, Name: r.Space.Name, Description: r.Space.Description,
		OwnerId: r.Space.OwnerID, OwnerUsername: owner.Username,
		OwnerDisplayName: owner.DisplayName, OwnerDeleted: owner.Deleted,
		MemberCount:    uint32(r.MemberCount), //nolint:gosec // a count of rows
		CreatedAt:      timestamppb.New(r.Space.CreatedAt),
		ViewerIsMember: r.ViewerIsMember,
	}
	if r.Space.IconFileID != nil {
		summary.IconFileId = *r.Space.IconFileID
	}
	return summary
}

func (s *Service) GetSpace(ctx context.Context, req *connect.Request[chatv1.GetSpaceRequest]) (*connect.Response[chatv1.GetSpaceResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	a, err := s.actorFor(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, err
	}
	space, err := s.q.GetSpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, notFoundOr(err, "space")
	}
	return connect.NewResponse(&chatv1.GetSpaceResponse{Space: toProtoSpace(space, a, callerCredential(ctx))}), nil
}

// publishSpaceJoined tells the joiner's live connections about their new
// space; the gateway also uses it to subscribe them to the space's events.
func (s *Service) publishSpaceJoined(userID string, space dbgen.Space, viewer actor) {
	s.bus.Publish("user:"+userID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceJoined{
			SpaceJoined: &realtimev1.SpaceJoined{Space: toProtoSpace(space, viewer, authctx.Credential{})},
		},
	}))
	// Existing members learn about the newcomer on the space topic.
	s.bus.Publish("space:"+space.ID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberJoined{
			MemberJoined: &realtimev1.MemberJoined{SpaceId: space.ID, UserId: userID},
		},
	}))
}

const (
	maxSpaceName = 50
	// A description has to survive a tooltip and a 244 px sidebar row.
	maxSpaceDescription = 200
	maxSpaceWelcome     = 4000
)

var errSpaceName = fmt.Errorf(
	"a space name needs a letter, number or symbol, and is at most %d characters",
	maxSpaceName)

// cleanSpaceName is the rule for a new name or a rename; see
// docs/architecture/messaging.md → Space names.
func cleanSpaceName(name string) (string, bool) {
	name = oneLine(name)
	if utf8.RuneCountInString(name) > maxSpaceName {
		return "", false
	}
	visible := false
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", false
		}
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			visible = true
		}
	}
	return name, visible
}

// oneLine collapses every run of whitespace, newlines included, to a
// single space: a description is rendered where a line break would only
// ever be an ellipsis.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// toProtoSpace renders a space for one caller; myRole is that caller's
// effective role in it.
// toProtoSpace renders a space for one viewer holding cred. A broadcast
// passes actor{} and carries no role or permissions.
func toProtoSpace(s dbgen.Space, viewer actor, cred authctx.Credential) *chatv1.Space {
	space := &chatv1.Space{
		Id: s.ID, Name: s.Name, OwnerId: s.OwnerID, CreatedAt: timestamppb.New(s.CreatedAt),
		MyRole: toProtoRole(viewer.role), MembersCanInvite: s.MembersCanInvite,
		MyPermissions: accesswire.ToProto(spacePermissions(viewer, s, cred)),
		Description:   s.Description, Welcome: s.Welcome,
	}
	if s.IconFileID != nil {
		space.IconFileId = *s.IconFileID
	}
	if s.DefaultChannelID != nil {
		space.DefaultChannelId = *s.DefaultChannelID
	}
	return space
}

// RequireManageSpace is the files module's pre-flight check before it
// processes an icon upload: the caller must hold space.manage here. The
// error is already a Connect error when it is a permission problem.
func (s *Service) RequireManageSpace(ctx context.Context, spaceID string) error {
	return s.requirePermission(ctx, spaceID, authctx.SpaceManage)
}

// SetSpaceIcon points a space at a new icon file (or clears it with "")
// and returns the file id it replaced, "" if none. Exposed for the files
// module's port, which owns the file rows and deletes the old one after
// this returns. Members hear about it as SpaceUpdated.
func (s *Service) SetSpaceIcon(ctx context.Context, spaceID, fileID string) (previous string, err error) {
	if err := s.requirePermission(ctx, spaceID, authctx.SpaceManage); err != nil {
		return "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	prev, err := qtx.GetSpaceIconForUpdate(ctx, spaceID)
	if err != nil {
		return "", notFoundOr(err, "space")
	}
	var next *string
	if fileID != "" {
		next = &fileID
	}
	if err := qtx.SetSpaceIcon(ctx, dbgen.SetSpaceIconParams{ID: spaceID, IconFileID: next}); err != nil {
		return "", fmt.Errorf("set space icon: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	space, err := s.q.GetSpace(ctx, spaceID)
	if err != nil {
		return "", notFoundOr(err, "space")
	}
	s.bus.Publish("space:"+space.ID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceUpdated{
			SpaceUpdated: &realtimev1.SpaceUpdated{Space: toProtoSpace(space, actor{}, authctx.Credential{})},
		},
	}))
	if prev != nil {
		return *prev, nil
	}
	return "", nil
}

func (s *Service) UpdateSpace(ctx context.Context, req *connect.Request[chatv1.UpdateSpaceRequest]) (*connect.Response[chatv1.UpdateSpaceResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.SpaceManage); err != nil {
		return nil, err
	}
	patch := dbgen.UpdateSpaceSettingsParams{
		ID: req.Msg.SpaceId, MembersCanInvite: req.Msg.MembersCanInvite,
	}
	if req.Msg.Name != nil {
		n, ok := cleanSpaceName(*req.Msg.Name)
		if !ok {
			return nil, apierr.Field(connect.CodeInvalidArgument, "name", errSpaceName)
		}
		patch.Name = &n
	}
	if req.Msg.Description != nil {
		d := oneLine(*req.Msg.Description)
		if utf8.RuneCountInString(d) > maxSpaceDescription {
			return nil, apierr.Field(connect.CodeInvalidArgument, "description",
				fmt.Errorf("description must be %d characters or fewer", maxSpaceDescription))
		}
		patch.Description = &d
	}
	if req.Msg.Welcome != nil {
		w := strings.TrimSpace(*req.Msg.Welcome)
		if utf8.RuneCountInString(w) > maxSpaceWelcome {
			return nil, apierr.Field(connect.CodeInvalidArgument, "welcome",
				fmt.Errorf("welcome text must be %d characters or fewer", maxSpaceWelcome))
		}
		patch.Welcome = &w
	}
	if req.Msg.DefaultChannelId != nil {
		// Present but empty means "clear it", which the column can hold
		// and COALESCE could not express; hence the separate flag.
		patch.SetDefaultChannel = true
		if id := *req.Msg.DefaultChannelId; id != "" {
			channel, err := s.q.GetChannel(ctx, id)
			if err != nil {
				return nil, notFoundOr(err, "channel")
			}
			// A channel from another space would send arrivals somewhere
			// they may not be able to read; a voice channel would drop
			// them into a call they never asked to join.
			if spaceOf(channel) != req.Msg.SpaceId {
				return nil, apierr.Field(connect.CodeInvalidArgument, "default_channel_id",
					errors.New("that channel is not in this space"))
			}
			if channel.Kind != int16(chatv1.ChannelKind_CHANNEL_KIND_TEXT) {
				return nil, apierr.Field(connect.CodeInvalidArgument, "default_channel_id",
					errors.New("only a text channel can be the default"))
			}
			patch.DefaultChannelID = &id
		}
	}
	space, err := s.q.UpdateSpaceSettings(ctx, patch)
	if err != nil {
		return nil, notFoundOr(err, "space")
	}
	a, err := s.actorFor(ctx, space.ID)
	if err != nil {
		return nil, err
	}
	s.bus.Publish("space:"+space.ID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceUpdated{
			SpaceUpdated: &realtimev1.SpaceUpdated{Space: toProtoSpace(space, actor{}, authctx.Credential{})},
		},
	}))
	return connect.NewResponse(&chatv1.UpdateSpaceResponse{Space: toProtoSpace(space, a, callerCredential(ctx))}), nil
}

func (s *Service) TransferOwnership(ctx context.Context, req *connect.Request[chatv1.TransferOwnershipRequest]) (*connect.Response[chatv1.TransferOwnershipResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.SpaceTransfer); err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	if req.Msg.UserId == userID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("you already own this space"))
	}
	if _, err := s.q.GetSpaceMember(ctx, dbgen.GetSpaceMemberParams{
		SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId,
	}); err != nil {
		return nil, notFoundOr(err, "member")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	// Demote first: the one-owner index forbids two owners even briefly.
	if _, err := qtx.SetSpaceMemberRole(ctx, dbgen.SetSpaceMemberRoleParams{
		SpaceID: req.Msg.SpaceId, UserID: userID, Role: string(RoleAdmin),
	}); err != nil {
		return nil, fmt.Errorf("demote owner: %w", err)
	}
	if _, err := qtx.SetSpaceMemberRole(ctx, dbgen.SetSpaceMemberRoleParams{
		SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId, Role: string(RoleOwner),
	}); err != nil {
		return nil, fmt.Errorf("promote new owner: %w", err)
	}
	if err := qtx.UpdateSpaceOwner(ctx, dbgen.UpdateSpaceOwnerParams{ID: req.Msg.SpaceId, OwnerID: req.Msg.UserId}); err != nil {
		return nil, fmt.Errorf("update owner: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	s.publishRoleChanged(req.Msg.SpaceId, userID, RoleAdmin)
	s.publishRoleChanged(req.Msg.SpaceId, req.Msg.UserId, RoleOwner)
	space, err := s.q.GetSpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, notFoundOr(err, "space")
	}
	return connect.NewResponse(&chatv1.TransferOwnershipResponse{Space: toProtoSpace(space, memberActor(RoleAdmin, authctx.IsAdmin(ctx)), callerCredential(ctx))}), nil
}

func (s *Service) DeleteSpace(ctx context.Context, req *connect.Request[chatv1.DeleteSpaceRequest]) (*connect.Response[chatv1.DeleteSpaceResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.SpaceDelete); err != nil {
		return nil, err
	}
	// Read before the delete cascades the channels away.
	voiceChannels := s.voiceChannelIDs(ctx, req.Msg.SpaceId)
	if err := s.q.DeleteSpace(ctx, req.Msg.SpaceId); err != nil {
		return nil, fmt.Errorf("delete space: %w", err)
	}
	s.closeVoiceRooms(ctx, voiceChannels...)
	// Subscriptions are topic-based, so members still hear this after the
	// rows are gone (and the gateway drops the topic on receipt).
	s.bus.Publish("space:"+req.Msg.SpaceId, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceDeleted{
			SpaceDeleted: &realtimev1.SpaceDeleted{SpaceId: req.Msg.SpaceId},
		},
	}))
	return connect.NewResponse(&chatv1.DeleteSpaceResponse{}), nil
}
