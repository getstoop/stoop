package instance

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

const keySpaceCreation = "space_creation"

// SpaceCreation is who may create spaces.
type SpaceCreation string

const (
	SpaceCreationAdmins   SpaceCreation = "admins"
	SpaceCreationEveryone SpaceCreation = "everyone"
)

var spaceCreations = newEnumSetting(map[SpaceCreation]instancev1.SpaceCreationPolicy{
	SpaceCreationAdmins:   instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS,
	SpaceCreationEveryone: instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE,
}, instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS)

// SpaceCreationPolicy is the current setting.
func (s *Service) SpaceCreationPolicy(ctx context.Context) (SpaceCreation, error) {
	v, err := s.readSetting(ctx, keySpaceCreation, string(SpaceCreationAdmins))
	return SpaceCreation(v), err
}

// MembersMayCreateSpaces satisfies the chat module's port.
func (s *Service) MembersMayCreateSpaces(ctx context.Context) (bool, error) {
	p, err := s.SpaceCreationPolicy(ctx)
	return p == SpaceCreationEveryone, err
}

func stageSpaceCreation(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	if msg.SpaceCreation == nil {
		return nil
	}
	policy, ok := spaceCreations.fromProto(*msg.SpaceCreation)
	if !ok {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("space_creation must be admins or everyone"))
	}
	save.write(keySpaceCreation, policy)
	return nil
}
