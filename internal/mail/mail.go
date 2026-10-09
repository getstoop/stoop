// Package mail sends email through an SMTP server. It knows nothing of
// settings or the database: the caller passes the server to use. See
// docs/architecture/email.md.
package mail

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Security is how the connection to the server is encrypted.
type Security string

const (
	SecuritySTARTTLS Security = "starttls"
	SecurityTLS      Security = "tls"
	SecurityNone     Security = "none"
)

// DefaultPort is the usual port for a security mode.
func DefaultPort(security Security) int {
	switch security {
	case SecurityTLS:
		return 465
	case SecurityNone:
		return 25
	default:
		return 587
	}
}

// Server is the SMTP server and the sender it sends as.
type Server struct {
	Host        string
	Port        int
	Security    Security
	Username    string
	Password    string
	FromAddress string
	FromName    string
}

// Message is one email to one recipient.
type Message struct {
	To      string
	Subject string
	Text    string
	// Optional; sent as multipart/alternative with Text.
	HTML string
}

// Sender delivers a message through the configured server.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// Refusal is a failed send tied to the setting that explains it.
type Refusal struct {
	// "host", "port", "security", "username", "password", "from_address",
	// "to", or "" when no one setting explains it.
	Field string
	// The SMTP reply code, 0 when the server never replied.
	Code int
	// What the person reads, e.g. "smtp.example.net refused this username
	// and password (535)."
	Message string
	Err     error
}

func (r *Refusal) Error() string { return r.Message }
func (r *Refusal) Unwrap() error { return r.Err }

// ErrNotConfigured is a send with email off or no server saved.
var ErrNotConfigured = errors.New("email is not set up")

// ErrHourlyLimit is the cap reached; a *HourlyLimitError says until when.
var ErrHourlyLimit = errors.New("hourly email limit reached")

// HourlyLimitError is a send refused because this hour's cap is used.
type HourlyLimitError struct {
	Limit int
	Until time.Time
}

func (e *HourlyLimitError) Error() string {
	return fmt.Sprintf("this hour's %d emails are used; try again after %s", e.Limit, e.Until.Format("15:04"))
}

func (e *HourlyLimitError) Unwrap() error { return ErrHourlyLimit }
