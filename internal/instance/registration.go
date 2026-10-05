package instance

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

const keyRegistrationPolicy = "registration_policy"

// Policy is the registration policy as stored and as exposed through the
// auth module's RegistrationPolicy port.
type Policy string

const (
	PolicyOpen   Policy = "open"
	PolicyInvite Policy = "invite"
	PolicyClosed Policy = "closed"
)

var registrationPolicies = newEnumSetting(map[Policy]instancev1.RegistrationPolicy{
	PolicyOpen:   instancev1.RegistrationPolicy_REGISTRATION_POLICY_OPEN,
	PolicyInvite: instancev1.RegistrationPolicy_REGISTRATION_POLICY_INVITE,
	PolicyClosed: instancev1.RegistrationPolicy_REGISTRATION_POLICY_CLOSED,
}, instancev1.RegistrationPolicy_REGISTRATION_POLICY_UNSPECIFIED)

// RegistrationPolicy is the current policy; it also satisfies the auth
// module's port (which sees it as a string).
func (s *Service) RegistrationPolicy(ctx context.Context) (string, error) {
	policy, err := readSettingOr(ctx, s, keyRegistrationPolicy, PolicyInvite)
	return string(policy), err
}

func stageRegistrationPolicy(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	if msg.RegistrationPolicy == nil {
		return nil
	}
	policy, ok := registrationPolicies.fromProto(*msg.RegistrationPolicy)
	if !ok {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("registration_policy must be open, invite, or closed"))
	}
	save.write(keyRegistrationPolicy, policy)
	return nil
}
