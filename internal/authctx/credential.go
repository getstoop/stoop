package authctx

import (
	"context"
	"errors"
	"fmt"
	"slices"
)

// CredentialKind is how a request was authenticated.
type CredentialKind string

const (
	CredentialSession       CredentialKind = "session"
	CredentialPersonalToken CredentialKind = "personal_token"
	CredentialBotToken      CredentialKind = "bot_token"
	CredentialIncomingHook  CredentialKind = "incoming_hook"
)

// Credential is what a request was made with. A nil Grants covers every
// action; only a session has that. A Bounded credential reaches only the
// Spaces and Channels listed, and with neither it reaches nothing.
type Credential struct {
	ID       string
	Kind     CredentialKind
	Grants   []Action
	Bounded  bool
	Spaces   []string
	Channels []string
}

// Covers reports whether the grant includes a, wherever it is used.
func (c Credential) Covers(a Action) bool {
	if c.Grants == nil {
		return true
	}
	return a.Grantable() && slices.Contains(c.Grants, a)
}

// Reaches reports whether the bounds admit a resource: a space, a channel
// (with its space, "" for a direct message), or neither for the instance
// and the caller's own account, which no bound contains.
func (c Credential) Reaches(spaceID, channelID string) bool {
	if !c.Bounded {
		return true
	}
	return (spaceID != "" && slices.Contains(c.Spaces, spaceID)) ||
		(channelID != "" && slices.Contains(c.Channels, channelID))
}

// Covers reports whether the credential in ctx covers a on the instance or
// the caller's own account.
func Covers(ctx context.Context, a Action) bool {
	id, ok := From(ctx)
	return ok && id.Credential.Covers(a) && id.Credential.Reaches("", "")
}

// CoversSpace reports whether the credential in ctx covers a in a space.
func CoversSpace(ctx context.Context, a Action, spaceID string) bool {
	id, ok := From(ctx)
	return ok && id.Credential.Covers(a) && id.Credential.Reaches(spaceID, "")
}

// CoversChannel reports whether the credential in ctx covers a in a
// channel; spaceID is "" for a direct message.
func CoversChannel(ctx context.Context, a Action, spaceID, channelID string) bool {
	id, ok := From(ctx)
	return ok && id.Credential.Covers(a) && id.Credential.Reaches(spaceID, channelID)
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

// Uncovered is the refusal when the grant is what's missing. It says
// nothing about whether the identity would have been allowed.
func Uncovered(a Action) error {
	return fmt.Errorf("this token isn't allowed to %s", a.Describe())
}

var errOutOfBounds = errors.New("this token isn't allowed here")

// Refusal explains why the credential in ctx failed a Covers check: the
// grant, or else the bounds.
func Refusal(ctx context.Context, a Action) error {
	if id, _ := From(ctx); !id.Credential.Covers(a) {
		return Uncovered(a)
	}
	return errOutOfBounds
}

// Rule classifies a Connect procedure for the credential gate. A public
// procedure needs no credential; otherwise the credential must cover one of
// AnyOf, and an empty AnyOf admits any caller. Bounds are checked by the
// handler, once it knows the resource.
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
