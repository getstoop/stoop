package instance

import (
	"context"

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
