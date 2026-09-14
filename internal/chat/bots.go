package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// What the integrations module asks chat for, through its SpaceAccess
// port. Configuring integrations is instance.integrations.manage, checked
// there; nothing here consults a space permission.

// mayNotifyEveryone is the @everyone gate: the credential covers it in
// this channel and the author's role holds it.
func (s *Service) mayNotifyEveryone(ctx context.Context, channel dbgen.Channel) bool {
	if !authctx.CoversChannel(ctx, authctx.MessagesNotifyEveryone, spaceOf(channel), channel.ID) {
		return false
	}
	a, err := s.actorFor(ctx, *channel.SpaceID)
	if err != nil || (!a.member && !a.instanceAdmin) {
		return false
	}
	return allowed(a, authctx.MessagesNotifyEveryone, false)
}

// ChannelSpace returns a space channel's space id.
func (s *Service) ChannelSpace(ctx context.Context, channelID string) (string, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil || isDM(channel) {
		return "", connect.NewError(connect.CodeNotFound, errors.New("channel not found"))
	}
	return *channel.SpaceID, nil
}

func (s *Service) SpaceName(ctx context.Context, spaceID string) (string, error) {
	space, err := s.q.GetSpace(ctx, spaceID)
	if err != nil {
		return "", notFoundOr(err, "space")
	}
	return space.Name, nil
}

// AddBotMember puts a bot into a space as a member; already in is fine.
func (s *Service) AddBotMember(ctx context.Context, spaceID, userID string) error {
	space, err := s.q.GetSpace(ctx, spaceID)
	if err != nil {
		return notFoundOr(err, "space")
	}
	isMember, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: spaceID, UserID: userID})
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if isMember {
		return nil
	}
	if err := s.q.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
		SpaceID: spaceID, UserID: userID, Role: string(RoleMember),
	}); err != nil {
		return fmt.Errorf("add member: %w", err)
	}
	s.publishSpaceJoined(userID, space, memberActor(RoleMember, s.isInstanceAdmin(ctx, userID)))
	return nil
}

// SetBotAdmin sets or clears a bot's admin role in a space.
func (s *Service) SetBotAdmin(ctx context.Context, spaceID, userID string, admin bool) error {
	role := RoleMember
	if admin {
		role = RoleAdmin
	}
	current, err := s.q.GetSpaceMemberRole(ctx, dbgen.GetSpaceMemberRoleParams{SpaceID: spaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, errors.New("the bot is not a member of that space"))
	}
	if err != nil {
		return fmt.Errorf("look up member role: %w", err)
	}
	if Role(current) == role || Role(current) == RoleOwner {
		return nil
	}
	if _, err := s.q.SetSpaceMemberRole(ctx, dbgen.SetSpaceMemberRoleParams{
		SpaceID: spaceID, UserID: userID, Role: string(role),
	}); err != nil {
		return fmt.Errorf("set role: %w", err)
	}
	s.publishRoleChanged(spaceID, userID, role)
	return nil
}
