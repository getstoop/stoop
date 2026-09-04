package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

func (s *Service) CreateSpace(ctx context.Context, req *connect.Request[chatv1.CreateSpaceRequest]) (*connect.Response[chatv1.CreateSpaceResponse], error) {
	userID := authctx.UserID(ctx)
	if !authctx.IsAdmin(ctx) && s.policy != nil {
		ok, err := s.policy.MembersMayCreateSpaces(ctx)
		if err != nil {
			return nil, fmt.Errorf("check space creation policy: %w", err)
		}
		if !ok {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("only server admins can create spaces on this instance"))
		}
	}
	name := req.Msg.Name
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("space name must be 1-100 characters"))
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
		Space:          toProtoSpace(space, RoleOwner),
		DefaultChannel: toProtoChannel(channel),
	}), nil
}

func (s *Service) ListSpaces(ctx context.Context, _ *connect.Request[chatv1.ListSpacesRequest]) (*connect.Response[chatv1.ListSpacesResponse], error) {
	rows, err := s.q.ListSpacesByUser(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list spaces: %w", err)
	}
	spaces := make([]*chatv1.Space, len(rows))
	for i, r := range rows {
		spaces[i] = toProtoSpace(r.Space, Role(r.MyRole))
		spaces[i].HasUnread = r.HasUnread
		spaces[i].Muted = r.Muted
	}
	return connect.NewResponse(&chatv1.ListSpacesResponse{Spaces: spaces}), nil
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
	return connect.NewResponse(&chatv1.GetSpaceResponse{Space: toProtoSpace(space, a.role)}), nil
}

// publishSpaceJoined tells the joiner's live connections about their new
// space; the gateway also uses it to subscribe them to the space's events.
func (s *Service) publishSpaceJoined(userID string, space dbgen.Space, role Role) {
	s.bus.Publish("user:"+userID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceJoined{
			SpaceJoined: &realtimev1.SpaceJoined{Space: toProtoSpace(space, role)},
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
	// A description has to survive a tooltip and a 244 px sidebar row.
	maxSpaceDescription = 200
	maxSpaceWelcome     = 4000
)

// oneLine collapses every run of whitespace, newlines included, to a
// single space: a description is rendered where a line break would only
// ever be an ellipsis.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// toProtoSpace renders a space for one caller; myRole is that caller's
// effective role in it.
func toProtoSpace(s dbgen.Space, myRole Role) *chatv1.Space {
	space := &chatv1.Space{
		Id: s.ID, Name: s.Name, OwnerId: s.OwnerID, CreatedAt: timestamppb.New(s.CreatedAt),
		MyRole: toProtoRole(myRole), MembersCanInvite: s.MembersCanInvite,
		Description: s.Description, Welcome: s.Welcome,
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
// processes an icon upload: the caller must hold manage_space here. The
// error is already a Connect error when it is a permission problem.
func (s *Service) RequireManageSpace(ctx context.Context, spaceID string) error {
	return s.requirePermission(ctx, spaceID, PermManageSpace)
}

// SetSpaceIcon points a space at a new icon file (or clears it with "")
// and returns the file id it replaced, "" if none. Exposed for the files
// module's port, which owns the file rows and deletes the old one after
// this returns. Members hear about it as SpaceUpdated.
func (s *Service) SetSpaceIcon(ctx context.Context, spaceID, fileID string) (previous string, err error) {
	if err := s.requirePermission(ctx, spaceID, PermManageSpace); err != nil {
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
			SpaceUpdated: &realtimev1.SpaceUpdated{Space: toProtoSpace(space, "")},
		},
	}))
	if prev != nil {
		return *prev, nil
	}
	return "", nil
}

func (s *Service) UpdateSpace(ctx context.Context, req *connect.Request[chatv1.UpdateSpaceRequest]) (*connect.Response[chatv1.UpdateSpaceResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermManageSpace); err != nil {
		return nil, err
	}
	if req.Msg.Name != nil {
		if n := *req.Msg.Name; n == "" || utf8.RuneCountInString(n) > 100 {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("space name must be 1-100 characters"))
		}
	}
	patch := dbgen.UpdateSpaceSettingsParams{
		ID: req.Msg.SpaceId, Name: req.Msg.Name, MembersCanInvite: req.Msg.MembersCanInvite,
	}
	if req.Msg.Description != nil {
		d := oneLine(*req.Msg.Description)
		if utf8.RuneCountInString(d) > maxSpaceDescription {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("description must be %d characters or fewer", maxSpaceDescription))
		}
		patch.Description = &d
	}
	if req.Msg.Welcome != nil {
		w := strings.TrimSpace(*req.Msg.Welcome)
		if utf8.RuneCountInString(w) > maxSpaceWelcome {
			return nil, connect.NewError(connect.CodeInvalidArgument,
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
				return nil, connect.NewError(connect.CodeInvalidArgument,
					errors.New("that channel is not in this space"))
			}
			if channel.Kind != int16(chatv1.ChannelKind_CHANNEL_KIND_TEXT) {
				return nil, connect.NewError(connect.CodeInvalidArgument,
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
			SpaceUpdated: &realtimev1.SpaceUpdated{Space: toProtoSpace(space, "")},
		},
	}))
	return connect.NewResponse(&chatv1.UpdateSpaceResponse{Space: toProtoSpace(space, a.role)}), nil
}

func (s *Service) TransferOwnership(ctx context.Context, req *connect.Request[chatv1.TransferOwnershipRequest]) (*connect.Response[chatv1.TransferOwnershipResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermTransferOwnership); err != nil {
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
	return connect.NewResponse(&chatv1.TransferOwnershipResponse{Space: toProtoSpace(space, RoleAdmin)}), nil
}

func (s *Service) DeleteSpace(ctx context.Context, req *connect.Request[chatv1.DeleteSpaceRequest]) (*connect.Response[chatv1.DeleteSpaceResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermDeleteSpace); err != nil {
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
