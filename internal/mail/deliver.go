package mail

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"log/slog"
	"net"
	"strings"
	"sync/atomic"
	"time"

	gomail "github.com/wneessen/go-mail"
)

// Variables so tests can shorten them.
var (
	connectTimeout = 10 * time.Second
	sendTimeout    = 30 * time.Second
)

// rootCAs replaces the system roots when set; only tests set it.
var rootCAs *x509.CertPool

// Deliver sends msg through server: one connection, no cap, no record.
// Every failure is a *Refusal.
func Deliver(ctx context.Context, server Server, msg Message) error {
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	if server.Port == 0 {
		server.Port = DefaultPort(server.Security)
	}
	built, refusal := compose(server, msg)
	if refusal == nil {
		refusal = send(ctx, server, built)
	}
	logOutcome(server, msg, refusal)
	if refusal != nil {
		return refusal
	}
	return nil
}

func send(ctx context.Context, server Server, built *gomail.Msg) *Refusal {
	watch := &connWatch{}
	tlsConfig := &tls.Config{ServerName: server.Host, RootCAs: rootCAs, MinVersion: tls.VersionTLS12}
	options := []gomail.Option{
		gomail.WithPort(server.Port),
		gomail.WithTimeout(connectTimeout),
		gomail.WithTLSConfig(tlsConfig),
		gomail.WithDialContextFunc(watch.dialer(ctx, server.Security, tlsConfig)),
	}
	switch server.Security {
	case SecurityTLS:
		// The dialer does the handshake; WithSSL only stops a STARTTLS.
		options = append(options, gomail.WithSSL(), gomail.WithTLSPolicy(gomail.NoTLS))
	case SecurityNone:
		options = append(options, gomail.WithTLSPolicy(gomail.NoTLS))
	default:
		options = append(options, gomail.WithTLSPolicy(gomail.TLSMandatory))
	}
	if server.Username != "" {
		options = append(options,
			gomail.WithOpportunisticSMTPAuth(gomail.SMTPAuthPlain, gomail.SMTPAuthLogin),
			gomail.WithUsername(server.Username),
			gomail.WithPassword(server.Password))
	}
	client, err := gomail.NewClient(server.Host, options...)
	if err != nil {
		return &Refusal{Message: "Stoop couldn't set up the connection: " + err.Error(), Err: err}
	}
	err = client.DialAndSendWithContext(ctx, built)
	// A failed QUIT after the server took the message is still a send.
	if err == nil || built.IsDelivered() {
		return nil
	}
	return classify(ctx, server, watch, err)
}

// compose builds the message; a bad address is a refusal on its field.
func compose(server Server, msg Message) (*gomail.Msg, *Refusal) {
	built := gomail.NewMsg()
	if err := built.FromFormat(server.FromName, server.FromAddress); err != nil {
		return nil, &Refusal{Field: "from_address", Message: "The from address isn't one email address.", Err: err}
	}
	if err := built.To(msg.To); err != nil {
		return nil, &Refusal{Field: "to", Message: "The recipient isn't one email address.", Err: err}
	}
	built.Subject(msg.Subject)
	built.SetDate()
	built.SetMessageIDWithValue(messageID(server.FromAddress))
	built.SetGenHeader("Auto-Submitted", "auto-generated")
	built.SetBodyString(gomail.TypeTextPlain, msg.Text)
	if msg.HTML != "" {
		built.AddAlternativeString(gomail.TypeTextHTML, msg.HTML)
	}
	return built, nil
}

// messageID is a random id on the from address's domain.
func messageID(fromAddress string) string {
	random := make([]byte, 16)
	_, _ = rand.Read(random)
	return hex.EncodeToString(random) + "@" + domainOf(fromAddress)
}

func domainOf(address string) string {
	return address[strings.LastIndex(address, "@")+1:]
}

func logOutcome(server Server, msg Message, refusal *Refusal) {
	attrs := []any{"host", server.Host, "port", server.Port, "recipient_domain", domainOf(msg.To)}
	if refusal == nil {
		slog.Info("email sent", attrs...)
		return
	}
	slog.Warn("email refused", append(attrs, "code", refusal.Code, "field", refusal.Field, "err", refusal.Message)...)
}

// connWatch records how far a connection got, for classify.
type connWatch struct {
	dialed atomic.Bool
	// heard is whether the server sent any byte.
	heard atomic.Bool
}

// dialer connects, closes the connection when ctx ends, and does the
// handshake itself for implicit TLS so classify can see where it failed.
func (watch *connWatch) dialer(sendCtx context.Context, security Security, tlsConfig *tls.Config) gomail.DialContextFunc {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		var netDialer net.Dialer
		raw, err := netDialer.DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		watch.dialed.Store(true)
		context.AfterFunc(sendCtx, func() { _ = raw.Close() })
		conn := &listeningConn{Conn: raw, watch: watch}
		if security != SecurityTLS {
			return conn, nil
		}
		tlsConn := tls.Client(conn, tlsConfig)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = raw.Close()
			return nil, err
		}
		return tlsConn, nil
	}
}

// listeningConn notes the first byte the server sends.
type listeningConn struct {
	net.Conn
	watch *connWatch
}

func (conn *listeningConn) Read(buffer []byte) (int, error) {
	count, err := conn.Conn.Read(buffer)
	if count > 0 {
		conn.watch.heard.Store(true)
	}
	return count, err
}
