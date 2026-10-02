// Package apierr builds the Connect errors that carry more than a code and
// a sentence, and holds the gate shared by instance-wide actions. See
// docs/architecture/contracts.md → Errors.
package apierr

import (
	"errors"

	"connectrpc.com/connect"

	commonv1 "github.com/getstoop/stoop/gen/stoop/common/v1"
)

// Field is a refusal about one request field, named as the request spells
// it ("name", "turn.urls", "providers[2].client_id"). The sentence is what
// every client shows; the field is for a client that has a place beside it.
func Field(code connect.Code, field string, err error) *connect.Error {
	return addFieldDetail(connect.NewError(code, err), field)
}

// WithField names the field on a refusal that was built elsewhere, such as
// one that came back through a port. The refusal it is given is not
// changed: the result is a copy. Anything that is not a Connect error is
// returned as it is.
func WithField(err error, field string) error {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return err
	}
	named := connect.NewError(cerr.Code(), cerr.Unwrap())
	for _, detail := range cerr.Details() {
		named.AddDetail(detail)
	}
	for key, values := range cerr.Meta() {
		named.Meta()[key] = append([]string(nil), values...)
	}
	return addFieldDetail(named, field)
}

func addFieldDetail(cerr *connect.Error, field string) *connect.Error {
	if detail, derr := connect.NewErrorDetail(&commonv1.FieldViolation{Field: field}); derr == nil {
		cerr.AddDetail(detail)
	}
	return cerr
}
