// Package accesswire converts the authctx action vocabulary to its wire
// form, stoop.access.v1.Permission, and an identity's kind to
// stoop.access.v1.IdentityKind. The permission mapping is by name, so the
// enum and the vocabulary can't drift without accesswire_test.go failing.
package accesswire

import (
	"strings"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// ToProto converts actions to permissions, in the same order.
func ToProto(actions []authctx.Action) []accessv1.Permission {
	out := make([]accessv1.Permission, 0, len(actions))
	for _, a := range actions {
		if p, ok := toProto(a); ok {
			out = append(out, p)
		}
	}
	return out
}

var fromProto = func() map[accessv1.Permission]authctx.Action {
	m := map[accessv1.Permission]authctx.Action{}
	for _, a := range authctx.AllActions() {
		if p, ok := toProto(a); ok {
			m[p] = a
		}
	}
	return m
}()

// FromProto converts permissions to actions, in the same order. ok is false
// when any of them is unspecified or unknown.
func FromProto(perms []accessv1.Permission) ([]authctx.Action, bool) {
	out := make([]authctx.Action, 0, len(perms))
	for _, p := range perms {
		a, ok := fromProto[p]
		if !ok {
			return nil, false
		}
		out = append(out, a)
	}
	return out, true
}

func toProto(a authctx.Action) (accessv1.Permission, bool) {
	v, ok := accessv1.Permission_value["PERMISSION_"+strings.ToUpper(strings.ReplaceAll(string(a), ".", "_"))]
	return accessv1.Permission(v), ok
}

// KindToProto converts an identity's kind. An unknown kind is UNSPECIFIED,
// which readers treat as a person.
func KindToProto(k authctx.IdentityKind) accessv1.IdentityKind {
	switch k {
	case authctx.KindPerson:
		return accessv1.IdentityKind_IDENTITY_KIND_PERSON
	case authctx.KindBot:
		return accessv1.IdentityKind_IDENTITY_KIND_BOT
	default:
		return accessv1.IdentityKind_IDENTITY_KIND_UNSPECIFIED
	}
}
