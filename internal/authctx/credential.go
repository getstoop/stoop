package authctx

import (
	"context"
	"fmt"
	"slices"
)

// CredentialKind is how a request was authenticated.
type CredentialKind string

const CredentialSession CredentialKind = "session"

// Credential is what a request was made with. A nil Grants covers every
// action; only a session has that.
type Credential struct {
	ID     string
	Kind   CredentialKind
	Grants []Action
}

// Covers reports whether the credential may be used for a.
func (c Credential) Covers(a Action) bool {
	if c.Grants == nil {
		return true
	}
	return a.Grantable() && slices.Contains(c.Grants, a)
}

// Covers reports whether the credential in ctx covers a.
func Covers(ctx context.Context, a Action) bool {
	id, ok := From(ctx)
	return ok && id.Credential.Covers(a)
}

// Holds reports whether the identity in ctx holds an instance or
// own-account action.
func Holds(ctx context.Context, a Action) bool {
	id, ok := From(ctx)
	return ok && RoleHolds(id.Role, a)
}

// Allows is both gates for an instance or own-account action.
func Allows(ctx context.Context, a Action) bool {
	return Holds(ctx, a) && Covers(ctx, a)
}

// Uncovered is the refusal when the credential is what's missing. It says
// nothing about whether the identity would have been allowed.
func Uncovered(a Action) error {
	return fmt.Errorf("this token isn't allowed to %s", a.Describe())
}

// Rule classifies a Connect procedure for the credential gate. A public
// procedure needs no credential; otherwise the credential must cover one of
// AnyOf, and an empty AnyOf admits any caller.
type Rule struct {
	Public bool
	AnyOf  []Action
}

// CoveredBy reports whether c may call a procedure with this rule.
func (r Rule) CoveredBy(c Credential) bool {
	if len(r.AnyOf) == 0 {
		return true
	}
	return slices.ContainsFunc(r.AnyOf, c.Covers)
}
