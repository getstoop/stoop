package mail

import (
	"context"
	"errors"
	"time"
)

// SendEmailKind is the background job that sends one email. Its
// arguments name the message and who it is for, never the finished
// email: the builder runs at send time, so a link's token is made then
// and is never stored with the job.
const SendEmailKind = "send_email"

// The messages a send_email job can carry.
const (
	TemplateConfirmEmail = "confirm_email"
	TemplateEmailChanged = "email_changed"
)

// JobArgs are a send_email job's arguments.
type JobArgs struct {
	Template   string `json:"template"`
	UserID     string `json:"user_id"`
	OldAddress string `json:"old_address,omitempty"`
	// When the change a notice reports happened; zero on a job queued
	// before it was recorded.
	At time.Time `json:"at,omitzero"`
}

// Site is what a message needs from the instance.
type Site struct {
	PublicURL    string
	InstanceName string
}

// Builder writes one message for a send_email job.
type Builder func(ctx context.Context, args JobArgs, site Site) (Message, error)

var (
	// ErrNothingToSend ends the job without sending: the address it was
	// for is gone or the account is deactivated.
	ErrNothingToSend = errors.New("nothing to send")
	// ErrNoPublicURL is a message with a link on a server with no public
	// address to build it from.
	ErrNoPublicURL = errors.New("the server has no public address for links")
)
