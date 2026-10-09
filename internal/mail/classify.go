package mail

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/textproto"
	"strconv"
	"strings"

	gomail "github.com/wneessen/go-mail"
	"github.com/wneessen/go-mail/smtp"
)

// classify ties a failed send to the setting that explains it
// (docs/proposals/email.md → Refusals, field by field).
func classify(ctx context.Context, server Server, watch *connWatch, err error) *Refusal {
	host := server.Host
	refuse := func(field string, code int, format string, args ...any) *Refusal {
		return &Refusal{Field: field, Code: code, Message: fmt.Sprintf(format, args...), Err: err}
	}
	var (
		dnsErr       *net.DNSError
		hostnameErr  x509.HostnameError
		authorityErr x509.UnknownAuthorityError
		certErr      *tls.CertificateVerificationError
		recordErr    tls.RecordHeaderError
		sendErr      *gomail.SendError
		reply        *textproto.Error
	)
	switch {
	case errors.Is(ctx.Err(), context.Canceled):
		return refuse("", 0, "The send was cancelled.")
	case errors.As(err, &dnsErr):
		return refuse("host", 0, "Can't find %s.", host)
	case errors.As(err, &hostnameErr):
		return refuse("host", 0, "The certificate isn't valid for %s.", host)
	case errors.As(err, &authorityErr), errors.As(err, &certErr):
		return refuse("host", 0, "The certificate from %s isn't trusted.", host)
	case errors.As(err, &recordErr):
		return refuse("security", 0, "Port %d doesn't expect TLS from the start. Pick STARTTLS, or use port 465.", server.Port)
	case !watch.dialed.Load():
		return refuse("port", 0, "Nothing answered on %s:%d.", host, server.Port)
	case !watch.heard.Load() && server.Security != SecurityTLS:
		// Connected, but no greeting: the server is waiting for a TLS hello.
		return refuse("security", 0, "Port %d expects TLS from the start. Pick TLS, or use port 587.", server.Port)
	case !watch.heard.Load():
		return refuse("port", 0, "Nothing answered on %s:%d.", host, server.Port)
	case strings.Contains(err.Error(), "does not support STARTTLS"):
		// go-mail has no sentinel for this one.
		return refuse("security", 0, "%s doesn't offer STARTTLS on port %d.", host, server.Port)
	case errors.Is(err, smtp.ErrUnencrypted):
		return refuse("security", 0, "A password is never sent unencrypted. Pick STARTTLS or TLS.")
	case errors.As(err, &sendErr):
		return classifySend(server, sendErr, refuse)
	case errors.As(err, &reply) && server.Username != "" && (reply.Code == 530 || reply.Code == 534 || reply.Code == 535):
		return refuse("password", reply.Code, "%s refused this username and password (%d).", host, reply.Code)
	case errors.As(err, &reply):
		return refuse("", reply.Code, "%s replied: %s", host, reply.Error())
	case strings.Contains(err.Error(), "server does not support SMTP AUTH"),
		errors.Is(err, gomail.ErrNoSupportedAuthDiscovered):
		return refuse("username", 0, "%s doesn't offer a sign-in Stoop can use on port %d.", host, server.Port)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() || errors.Is(err, context.DeadlineExceeded) {
		return refuse("", 0, "%s:%d stopped answering.", host, server.Port)
	}
	return refuse("", 0, "Sending through %s failed: %v", host, err)
}

// classifySend is a refusal after sign-in, from MAIL FROM onwards.
func classifySend(server Server, sendErr *gomail.SendError, refuse func(string, int, string, ...any) *Refusal) *Refusal {
	host := server.Host
	code := sendErr.ErrorCode()
	switch sendErr.Reason {
	case gomail.ErrSMTPMailFrom:
		if server.Username == "" && (code == 530 || sendErr.EnhancedStatusCode() == "5.7.0") {
			return refuse("username", code, "%s needs a username and password.", host)
		}
		if code == 550 || code == 553 || code == 554 {
			return refuse("from_address", code, "%s won't send from this address (%d).", host, code)
		}
	case gomail.ErrSMTPRcptTo:
		if code == 550 || code == 553 {
			return refuse("to", code, "%s refused this recipient (%d).", host, code)
		}
	}
	return refuse("", code, "%s replied: %s", host, replyText(sendErr, code))
}

// replyText is the server's reply out of a SendError, whose list of
// causes go-mail keeps private.
func replyText(sendErr *gomail.SendError, code int) string {
	text := sendErr.Error()
	if code != 0 {
		if start := strings.Index(text, strconv.Itoa(code)+" "); start >= 0 {
			text = text[start:]
		}
	}
	if end := strings.Index(text, ", affected"); end >= 0 {
		text = text[:end]
	}
	return text
}
