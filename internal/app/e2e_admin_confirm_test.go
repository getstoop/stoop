package app_test

import (
	"context"
	"testing"
)

// What hands out lasting access from Server admin needs a recent sign-in
// (identity.md → Confirm it's you): an admin session older than five
// minutes, stolen or not, is refused before the handler runs, with the
// marker the web app offers "Confirm it's you" from.
func TestE2EAdminActionsNeedARecentSignIn(t *testing.T) {
	instance, pool, casey := emailHarness(t)
	ada := instance.person("ada")
	adaID := instance.userID(ada)
	if _, err := pool.Exec(context.Background(),
		`UPDATE credentials SET created_at = now() - interval '6 minutes' WHERE kind = 'session'`); err != nil {
		t.Fatal(err)
	}

	const instanceSvc, integrations = "stoop.instance.v1.InstanceService/", "stoop.integrations.v1.IntegrationService/"
	for _, procedure := range []string{
		instanceSvc + "ResetUserPassword",
		instanceSvc + "SetUserRole",
		instanceSvc + "TransferOwnership",
		instanceSvc + "UpdateLoginProviders",
		instanceSvc + "UpdateEmailSettings",
		integrations + "CreateBotToken",
		integrations + "CreateIncoming",
		integrations + "CreateOutgoing",
		integrations + "UpdateOutgoing",
		integrations + "RotateSecret",
	} {
		got := instance.rpc(casey, procedure, map[string]any{}).expect(t, "failed_precondition", "sign in again first")
		if got.header.Get("Stoop-Confirm") != "required" {
			t.Errorf("%s: the refusal isn't marked for Confirm it's you", procedure)
		}
	}

	// Signed in just now: through the gate, to the handler.
	fresh := instance.loginFrom(t, "casey", "Laptop browser")
	instance.rpc(fresh, instanceSvc+"ResetUserPassword", map[string]any{"userId": adaID}).expect(t, "ok")
}
