package accesswire

import (
	"testing"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func TestVocabularyAndEnumMatch(t *testing.T) {
	actions := authctx.AllActions()
	for _, a := range actions {
		if _, ok := toProto(a); !ok {
			t.Errorf("%s has no stoop.access.v1.Permission value", a)
		}
	}
	// Every value but UNSPECIFIED must be some action.
	if got, want := len(accessv1.Permission_name)-1, len(actions); got != want {
		t.Errorf("the enum has %d permissions, the vocabulary %d actions", got, want)
	}
}

func TestFromProtoRoundTrips(t *testing.T) {
	actions := authctx.AllActions()
	back, ok := FromProto(ToProto(actions))
	if !ok || len(back) != len(actions) {
		t.Fatalf("round trip lost actions: %v", back)
	}
	for i := range actions {
		if back[i] != actions[i] {
			t.Errorf("%s came back as %s", actions[i], back[i])
		}
	}
	if _, ok := FromProto([]accessv1.Permission{accessv1.Permission_PERMISSION_UNSPECIFIED}); ok {
		t.Error("UNSPECIFIED must not convert")
	}
}

func TestToProtoKeepsOrder(t *testing.T) {
	got := ToProto([]authctx.Action{authctx.SpaceDelete, authctx.InstanceRead, authctx.Action("bogus")})
	want := []accessv1.Permission{accessv1.Permission_PERMISSION_SPACE_DELETE, accessv1.Permission_PERMISSION_INSTANCE_READ}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("ToProto = %v, want %v", got, want)
	}
}

func TestKindToProto(t *testing.T) {
	cases := map[authctx.IdentityKind]accessv1.IdentityKind{
		authctx.KindPerson: accessv1.IdentityKind_IDENTITY_KIND_PERSON,
		authctx.KindBot:    accessv1.IdentityKind_IDENTITY_KIND_BOT,
		"":                 accessv1.IdentityKind_IDENTITY_KIND_UNSPECIFIED,
		"agent":            accessv1.IdentityKind_IDENTITY_KIND_UNSPECIFIED,
	}
	for k, want := range cases {
		if got := KindToProto(k); got != want {
			t.Errorf("KindToProto(%q) = %v, want %v", k, got, want)
		}
	}
}
