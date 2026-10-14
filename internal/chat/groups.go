package chat

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
)

// Groups: see docs/architecture/messaging.md → Groups.

var groupHandleRE = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

const (
	maxGroupNameLen = 50
	maxGroupMembers = 100
)

// groupInput is a create or update request, checked.
type groupInput struct {
	handle, name string
	userIDs      []string
}

func (s *Service) ListGroups(ctx context.Context, req *connect.Request[chatv1.ListGroupsRequest]) (*connect.Response[chatv1.ListGroupsResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.SpaceRead); err != nil {
		return nil, err
	}
	groups, err := s.q.ListGroups(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	members, err := s.q.ListGroupMembersInSpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, fmt.Errorf("list group members: %w", err)
	}
	byGroup := map[string][]string{}
	for _, member := range members {
		byGroup[member.GroupID] = append(byGroup[member.GroupID], member.UserID)
	}
	out := make([]*chatv1.Group, len(groups))
	for i, group := range groups {
		out[i] = toProtoGroup(group, byGroup[group.ID])
	}
	return connect.NewResponse(&chatv1.ListGroupsResponse{Groups: out}), nil
}

func (s *Service) CreateGroup(ctx context.Context, req *connect.Request[chatv1.CreateGroupRequest]) (*connect.Response[chatv1.CreateGroupResponse], error) {
	spaceID := req.Msg.SpaceId
	if err := s.requirePermission(ctx, spaceID, authctx.MembersManage); err != nil {
		return nil, err
	}
	input, err := s.groupInputFrom(ctx, spaceID, req.Msg.Handle, req.Msg.Name, req.Msg.UserIds)
	if err != nil {
		return nil, err
	}
	var group dbgen.Group
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		group, err = qtx.CreateGroup(ctx, dbgen.CreateGroupParams{
			ID: rowid.New(), SpaceID: spaceID, Handle: input.handle, Name: input.name,
		})
		if err != nil {
			return groupWriteError(err, input.handle)
		}
		return addGroupMembers(ctx, qtx, group, input.userIDs)
	})
	if err != nil {
		return nil, err
	}
	s.publishGroupsChanged(spaceID)
	return connect.NewResponse(&chatv1.CreateGroupResponse{Group: toProtoGroup(group, input.userIDs)}), nil
}

func (s *Service) UpdateGroup(ctx context.Context, req *connect.Request[chatv1.UpdateGroupRequest]) (*connect.Response[chatv1.UpdateGroupResponse], error) {
	current, err := s.groupToManage(ctx, req.Msg.GroupId)
	if err != nil {
		return nil, err
	}
	input, err := s.groupInputFrom(ctx, current.SpaceID, req.Msg.Handle, req.Msg.Name, req.Msg.UserIds)
	if err != nil {
		return nil, err
	}
	var group dbgen.Group
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		group, err = qtx.UpdateGroup(ctx, dbgen.UpdateGroupParams{
			ID: current.ID, Handle: input.handle, Name: input.name,
		})
		if err != nil {
			return groupWriteError(err, input.handle)
		}
		if err := qtx.ClearGroupMembers(ctx, group.ID); err != nil {
			return fmt.Errorf("clear group members: %w", err)
		}
		return addGroupMembers(ctx, qtx, group, input.userIDs)
	})
	if err != nil {
		return nil, err
	}
	s.publishGroupsChanged(group.SpaceID)
	return connect.NewResponse(&chatv1.UpdateGroupResponse{Group: toProtoGroup(group, input.userIDs)}), nil
}

func (s *Service) DeleteGroup(ctx context.Context, req *connect.Request[chatv1.DeleteGroupRequest]) (*connect.Response[chatv1.DeleteGroupResponse], error) {
	group, err := s.groupToManage(ctx, req.Msg.GroupId)
	if err != nil {
		return nil, err
	}
	if _, err := s.q.DeleteGroup(ctx, group.ID); err != nil {
		return nil, fmt.Errorf("delete group: %w", err)
	}
	s.publishGroupsChanged(group.SpaceID)
	return connect.NewResponse(&chatv1.DeleteGroupResponse{}), nil
}

// groupToManage loads a group the caller may change.
func (s *Service) groupToManage(ctx context.Context, groupID string) (dbgen.Group, error) {
	group, err := s.q.GetGroup(ctx, groupID)
	if err != nil {
		return dbgen.Group{}, apierr.NotFoundOr(err, "group")
	}
	if err := s.requirePermission(ctx, group.SpaceID, authctx.MembersManage); err != nil {
		return dbgen.Group{}, err
	}
	return group, nil
}

// groupInputFrom checks every field before anything is written. The people
// must be people, not bots, and members of the space.
func (s *Service) groupInputFrom(ctx context.Context, spaceID, rawHandle, rawName string, rawUserIDs []string) (groupInput, error) {
	handle := strings.ToLower(strings.TrimSpace(rawHandle))
	if !groupHandleRE.MatchString(handle) {
		return groupInput{}, apierr.Field(connect.CodeInvalidArgument, "handle",
			errors.New("handle must be 3-32 letters, numbers, or _"))
	}
	if handle == entireChannelHandle || handle == hereHandle {
		return groupInput{}, apierr.Field(connect.CodeInvalidArgument, "handle",
			fmt.Errorf("@@%s is reserved", handle))
	}
	name := strings.TrimSpace(rawName)
	if name == "" || utf8.RuneCountInString(name) > maxGroupNameLen {
		return groupInput{}, apierr.Field(connect.CodeInvalidArgument, "name",
			fmt.Errorf("name must be 1-%d characters", maxGroupNameLen))
	}
	userIDs := slices.Compact(slices.Sorted(slices.Values(rawUserIDs)))
	if len(userIDs) == 0 || len(userIDs) > maxGroupMembers {
		return groupInput{}, apierr.Field(connect.CodeInvalidArgument, "user_ids",
			fmt.Errorf("pick between 1 and %d people", maxGroupMembers))
	}
	members, err := s.q.ListSpaceMembers(ctx, spaceID)
	if err != nil {
		return groupInput{}, fmt.Errorf("list members: %w", err)
	}
	inSpace := make(map[string]bool, len(members))
	for _, member := range members {
		inSpace[member.UserID] = true
	}
	for _, userID := range userIDs {
		if !inSpace[userID] {
			return groupInput{}, errNotSpaceMember()
		}
	}
	records, err := s.users.GetUsers(ctx, userIDs)
	if err != nil {
		return groupInput{}, fmt.Errorf("look up people: %w", err)
	}
	for _, record := range records {
		if record.Kind == authctx.KindBot {
			return groupInput{}, apierr.Field(connect.CodeInvalidArgument, "user_ids",
				errors.New("a group can't include bots"))
		}
	}
	return groupInput{handle: handle, name: name, userIDs: userIDs}, nil
}

func errNotSpaceMember() error {
	return apierr.Field(connect.CodeFailedPrecondition, "user_ids",
		errors.New("only members of the space can be in a group"))
}

// addGroupMembers writes a group's people. Someone who left the space a
// moment ago is refused like anyone outside it.
func addGroupMembers(ctx context.Context, qtx *dbgen.Queries, group dbgen.Group, userIDs []string) error {
	err := qtx.AddGroupMembers(ctx, dbgen.AddGroupMembersParams{
		GroupID: group.ID, SpaceID: group.SpaceID, UserIds: userIDs,
	})
	if db.HasCode(err, db.ForeignKeyViolation) {
		return errNotSpaceMember()
	}
	if err != nil {
		return fmt.Errorf("add group members: %w", err)
	}
	return nil
}

// groupWriteError names a handle another group in the space already has.
func groupWriteError(err error, handle string) error {
	if db.HasCode(err, db.UniqueViolation) {
		return apierr.Field(connect.CodeAlreadyExists, "handle",
			fmt.Errorf("@@%s is taken in this space", handle))
	}
	return fmt.Errorf("write group: %w", err)
}

func (s *Service) publishGroupsChanged(spaceID string) {
	s.bus.Publish(events.SpaceTopic(spaceID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_GroupsChanged{GroupsChanged: &realtimev1.GroupsChanged{SpaceId: spaceID}},
	}))
}

func toProtoGroup(group dbgen.Group, userIDs []string) *chatv1.Group {
	return &chatv1.Group{
		Id: group.ID, SpaceId: group.SpaceID, Handle: group.Handle, Name: group.Name, UserIds: userIDs,
	}
}
