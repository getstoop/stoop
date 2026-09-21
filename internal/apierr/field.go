// Package apierr builds the Connect errors that carry more than a code and
// a sentence. See docs/architecture/contracts.md → Errors.
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
	cerr := connect.NewError(code, err)
	if detail, derr := connect.NewErrorDetail(&commonv1.FieldViolation{Field: field}); derr == nil {
		cerr.AddDetail(detail)
	}
	return cerr
}

// WithField names the field on a refusal that was built elsewhere, such as
// one that came back through a port. Anything that is not a Connect error
// is returned as it is.
func WithField(err error, field string) error {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return err
	}
	if detail, derr := connect.NewErrorDetail(&commonv1.FieldViolation{Field: field}); derr == nil {
		cerr.AddDetail(detail)
	}
	return err
}
