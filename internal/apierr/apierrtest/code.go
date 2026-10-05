// Package apierrtest checks the Connect code a call refused with, for tests.
package apierrtest

import (
	"testing"

	"connectrpc.com/connect"
)

// ExpectCode marks the test failed, and lets it carry on, unless err
// carries the Connect code want. what names the call in the failure.
func ExpectCode(t testing.TB, err error, want connect.Code, what string) {
	t.Helper()
	if !hasCode(err, want) {
		t.Errorf("%s: got %v, want code %v", what, err, want)
	}
}

// RequireCode is ExpectCode for a check the rest of the test relies on: it
// stops the test.
func RequireCode(t testing.TB, err error, want connect.Code, what string) {
	t.Helper()
	if !hasCode(err, want) {
		t.Fatalf("%s: got %v, want code %v", what, err, want)
	}
}

func hasCode(err error, want connect.Code) bool {
	return err != nil && connect.CodeOf(err) == want
}
