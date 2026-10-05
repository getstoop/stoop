package instance

import (
	"testing"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// checkEnumSetting pins every stored string to its wire value both ways,
// so a swapped mapping fails even though it would still round-trip, and
// checks what an unknown stored value reads as and that the zero wire
// value and an out-of-range one are refused.
func checkEnumSetting[Stored ~string, Wire ~int32](t *testing.T, setting enumSetting[Stored, Wire], want map[string]Wire, unknown Wire) {
	t.Helper()
	if len(setting.wire) != len(want) {
		t.Errorf("table has %d values, want %d", len(setting.wire), len(want))
	}
	for stored, wire := range want {
		if got := setting.toProto(Stored(stored)); got != wire {
			t.Errorf("%q reads as %v, want %v", stored, got, wire)
		}
		if got, ok := setting.fromProto(wire); !ok || string(got) != stored {
			t.Errorf("%v saves as %q (accepted %v), want %q", wire, got, ok, stored)
		}
	}
	if got := setting.toProto("bogus"); got != unknown {
		t.Errorf("an unknown stored value reads as %v, want %v", got, unknown)
	}
	for _, wire := range []Wire{0, 99} {
		if _, ok := setting.fromProto(wire); ok {
			t.Errorf("wire value %d was accepted", wire)
		}
	}
}

func TestEnumSettings(t *testing.T) {
	t.Run("registration", func(t *testing.T) {
		checkEnumSetting(t, registrationPolicies, map[string]instancev1.RegistrationPolicy{
			"open":   instancev1.RegistrationPolicy_REGISTRATION_POLICY_OPEN,
			"invite": instancev1.RegistrationPolicy_REGISTRATION_POLICY_INVITE,
			"closed": instancev1.RegistrationPolicy_REGISTRATION_POLICY_CLOSED,
		}, instancev1.RegistrationPolicy_REGISTRATION_POLICY_UNSPECIFIED)
	})
	t.Run("space creation", func(t *testing.T) {
		checkEnumSetting(t, spaceCreations, map[string]instancev1.SpaceCreationPolicy{
			"admins":   instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS,
			"everyone": instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE,
		}, instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS)
	})
	t.Run("password sign-in", func(t *testing.T) {
		checkEnumSetting(t, passwordSignIns, map[string]instancev1.PasswordSignIn{
			"everyone": instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE,
			"admins":   instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS,
			"off":      instancev1.PasswordSignIn_PASSWORD_SIGN_IN_OFF,
		}, instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE)
		if passwordSignIns.has("nobody") {
			t.Error(`"nobody" counts as a password sign-in value`)
		}
	})
	t.Run("personal tokens", func(t *testing.T) {
		checkEnumSetting(t, personalTokenSettings, map[string]instancev1.PersonalTokens{
			"everyone": instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE,
			"admins":   instancev1.PersonalTokens_PERSONAL_TOKENS_ADMINS,
			"off":      instancev1.PersonalTokens_PERSONAL_TOKENS_OFF,
		}, instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE)
	})
}
