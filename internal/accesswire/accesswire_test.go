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

func TestToProtoKeepsOrder(t *testing.T) {
	got := ToProto([]authctx.Action{authctx.SpaceDelete, authctx.InstanceRead, authctx.Action("bogus")})
	want := []accessv1.Permission{accessv1.Permission_PERMISSION_SPACE_DELETE, accessv1.Permission_PERMISSION_INSTANCE_READ}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("ToProto = %v, want %v", got, want)
	}
}
