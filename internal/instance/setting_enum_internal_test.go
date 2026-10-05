package instance

import (
	"testing"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// Each enum setting keeps what it did before one table replaced its
// switches: round trips, and what a stored value outside the table reads as.
func TestEnumSettings(t *testing.T) {
	for _, value := range []Policy{PolicyOpen, PolicyInvite, PolicyClosed} {
		if back, ok := registrationPolicies.fromProto(registrationPolicies.toProto(value)); !ok || back != value {
			t.Errorf("registration %q round trip = %q, %v", value, back, ok)
		}
	}
	if got := registrationPolicies.toProto("bogus"); got != instancev1.RegistrationPolicy_REGISTRATION_POLICY_UNSPECIFIED {
		t.Errorf("unknown registration policy = %v, want unspecified", got)
	}
	if _, ok := registrationPolicies.fromProto(instancev1.RegistrationPolicy_REGISTRATION_POLICY_UNSPECIFIED); ok {
		t.Error("unspecified registration policy was accepted")
	}

	if got := spaceCreations.toProto("bogus"); got != instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS {
		t.Errorf("unknown space creation = %v, want admins", got)
	}
	if got, ok := spaceCreations.fromProto(instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE); !ok || got != SpaceCreationEveryone {
		t.Errorf("space creation everyone = %q, %v", got, ok)
	}

	if got := passwordSignIns.toProto("bogus"); got != instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE {
		t.Errorf("unknown password sign-in = %v, want everyone", got)
	}
	if !passwordSignIns.has(PasswordOff) || passwordSignIns.has("nobody") {
		t.Error("password sign-in membership is wrong")
	}

	if got := personalTokenSettings.toProto("bogus"); got != instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE {
		t.Errorf("unknown personal tokens = %v, want everyone", got)
	}
	if _, ok := personalTokenSettings.fromProto(instancev1.PersonalTokens(99)); ok {
		t.Error("an out-of-range personal tokens value was accepted")
	}
}
