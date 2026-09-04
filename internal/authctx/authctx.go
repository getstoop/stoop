// Package authctx is the one-file contract through which modules read the
// authenticated identity from a request context. It plays the role a shared
// proto would play between separate services: everything may import it, and
// it imports nothing.
package authctx

import "context"

// Role is the instance-level user type. Admins operate the server
// (settings, users) and inherit admin in every space; see
// docs/architecture/permissions.md.
type Role string

const (
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
)

type Identity struct {
	UserID    string
	SessionID string
	Role      Role
}

type ctxKey struct{}

func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

func From(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(ctxKey{}).(Identity)
	return id, ok
}

// UserID returns the authenticated user's ID, or "" if unauthenticated.
func UserID(ctx context.Context) string {
	id, _ := From(ctx)
	return id.UserID
}

// IsAdmin reports whether the authenticated user is an instance admin.
func IsAdmin(ctx context.Context) bool {
	id, _ := From(ctx)
	return id.Role == RoleAdmin
}

type secureKey struct{}

// WithSecureTransport records whether the request arrived over TLS, so
// cookies can be marked Secure per request rather than per deployment.
func WithSecureTransport(ctx context.Context, secure bool) context.Context {
	return context.WithValue(ctx, secureKey{}, secure)
}

// SecureTransport reports whether the request arrived over TLS.
func SecureTransport(ctx context.Context) bool {
	secure, _ := ctx.Value(secureKey{}).(bool)
	return secure
}
