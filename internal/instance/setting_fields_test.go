package instance_test

import (
	"context"
	"testing"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

func TestSettingFields(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin}))
	svc.UseReachabilityEnv(instance.ReachabilityEnv{Reachability: instance.Reachability{
		PublicURL: "https://env.example.com",
	}})
	ctx := context.Background()
	field := func(name string) instance.SettingField {
		t.Helper()
		fields, err := svc.SettingFields(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, field := range fields {
			if field.Name == name {
				return field
			}
		}
		t.Fatalf("no field %s", name)
		return instance.SettingField{}
	}

	// Nothing saved: the environment's value, marked unsaved.
	if got := field("public-url"); got.Value != "https://env.example.com" || got.Saved {
		t.Errorf("env public-url = %+v", got)
	}

	// Set checks what the page checks, and a group's fields save together.
	if err := svc.SetSettingFields(ctx, map[string]string{"turn.urls": "turns:t.example.com:5349"}); err == nil {
		t.Error("TURN without credentials was saved")
	}
	if err := svc.SetSettingFields(ctx, map[string]string{
		"turn.urls": "turns:t.example.com:5349, turn:t.example.com:3478", "turn.username": "u", "turn.credential": "p",
	}); err != nil {
		t.Fatal(err)
	}
	if got := field("turn.credential"); got.Value != "(set)" || !got.Secret || !got.Saved {
		t.Errorf("credential shown as %+v", got)
	}
	// One field changes; the secret left out is kept.
	if err := svc.SetSettingFields(ctx, map[string]string{"turn.username": "v"}); err != nil {
		t.Fatal(err)
	}
	if inForce, _ := svc.Reachability(ctx); inForce.TURN.Username != "v" || inForce.TURN.Credential != "p" || len(inForce.TURN.URLs) != 2 {
		t.Errorf("TURN after one-field set = %+v", inForce.TURN)
	}
	if err := svc.SetSettingFields(ctx, map[string]string{"tailscale.enabled": "maybe"}); err == nil {
		t.Error("a non-boolean switch was accepted")
	}
	if err := svc.SetSettingFields(ctx, map[string]string{"public-url": "https://a.example.com", "instance-name": "Porch"}); err == nil {
		t.Error("fields of two forms were saved in one command")
	}
	if err := svc.SetSettingFields(ctx, map[string]string{"password-sign-in": "off"}); err == nil {
		t.Error("password sign-in turned off with no login provider")
	}

	// Clear saves empty; reset hands the group back to the environment.
	if err := svc.ClearSetting(ctx, "public-url"); err != nil {
		t.Fatal(err)
	}
	if got := field("public-url"); got.Value != "" || !got.Saved {
		t.Errorf("cleared public-url = %+v", got)
	}
	if err := svc.ClearSetting(ctx, "instance-name"); err == nil {
		t.Error("the instance name was cleared")
	}
	if existed, err := svc.ResetSetting(ctx, "public-url"); err != nil || !existed {
		t.Fatalf("reset: %v %v", existed, err)
	}
	if got := field("public-url"); got.Value != "https://env.example.com" || got.Saved {
		t.Errorf("reset public-url = %+v", got)
	}
	if existed, _ := svc.ResetSetting(ctx, "public-url"); existed {
		t.Error("a second reset found a row")
	}
	if _, err := svc.ResetSetting(ctx, "nope"); err == nil {
		t.Error("an unknown group was reset")
	}
}
