// Package accesswire converts the authctx action vocabulary to its wire
// form, stoop.access.v1.Permission. The mapping is by name, so the enum and
// the vocabulary can't drift without accesswire_test.go failing.
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

func toProto(a authctx.Action) (accessv1.Permission, bool) {
	v, ok := accessv1.Permission_value["PERMISSION_"+strings.ToUpper(strings.ReplaceAll(string(a), ".", "_"))]
	return accessv1.Permission(v), ok
}
