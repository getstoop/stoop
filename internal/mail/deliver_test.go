package mail

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/mail/mailtest"
)

var message = Message{To: "ada@example.com", Subject: "Hello", Text: "First line.\nSecond line."}

// trustFake makes Deliver trust certificates for localhost, and shortens
// the connect timeout for the silent-server cases.
func trustFake(t *testing.T) mailtest.Options {
	t.Helper()
	certificate, pool := mailtest.Certificate(t, "localhost")
	savedRoots, savedTimeout := rootCAs, connectTimeout
	rootCAs, connectTimeout = pool, 500*time.Millisecond
	t.Cleanup(func() { rootCAs, connectTimeout = savedRoots, savedTimeout })
	return mailtest.Options{Certificate: certificate}
}

func serverFor(fake *mailtest.Server, security Security) Server {
	return Server{Host: "localhost", Port: fake.Port, Security: security, FromAddress: "stoop@example.net", FromName: "The Stoop"}
}

func TestDeliverArrives(t *testing.T) {
	base := trustFake(t)
	for _, example := range []struct {
		name     string
		options  func(mailtest.Options) mailtest.Options
		security Security
		username string
	}{
		{"plain", func(options mailtest.Options) mailtest.Options { return options }, SecurityNone, ""},
		{"starttls", func(options mailtest.Options) mailtest.Options {
			options.STARTTLS, options.Username, options.Password = true, "casey", "hunter22"
			return options
		}, SecuritySTARTTLS, "casey"},
		{"tls", func(options mailtest.Options) mailtest.Options {
			options.TLS, options.Username, options.Password = true, "casey", "hunter22"
			return options
		}, SecurityTLS, "casey"},
		{"login only", func(options mailtest.Options) mailtest.Options {
			options.TLS, options.Username, options.Password, options.LoginOnly = true, "casey", "hunter22", true
			return options
		}, SecurityTLS, "casey"},
	} {
		t.Run(example.name, func(t *testing.T) {
			fake := mailtest.Start(t, example.options(base))
			server := serverFor(fake, example.security)
			server.Username, server.Password = example.username, "hunter22"
			withHTML := message
			withHTML.HTML = "<p>First line.</p>"
			if err := Deliver(context.Background(), server, withHTML); err != nil {
				t.Fatalf("Deliver: %v", err)
			}
			got := fake.Next(t)
			if got.From != "stoop@example.net" || len(got.To) != 1 || got.To[0] != "ada@example.com" {
				t.Errorf("envelope = %q → %q", got.From, got.To)
			}
			for _, want := range []string{
				`From: "The Stoop" <stoop@example.net>`,
				"Subject: Hello",
				"Date: ",
				"Auto-Submitted: auto-generated",
				"multipart/alternative",
				"text/plain",
				"text/html",
			} {
				if !strings.Contains(got.Data, want) {
					t.Errorf("message lacks %q:\n%s", want, got.Data)
				}
			}
			if !strings.Contains(got.Data, "Message-ID: <") || !strings.Contains(got.Data, "@example.net>") {
				t.Errorf("Message-ID not on the sender's domain:\n%s", got.Data)
			}
			if strings.Contains(got.Data, "hunter22") {
				t.Error("the password is in the message")
			}
		})
	}
}

func TestDeliverRefusals(t *testing.T) {
	base := trustFake(t)
	start := func(edit func(*mailtest.Options)) *mailtest.Server {
		options := base
		edit(&options)
		return mailtest.Start(t, options)
	}
	silentHost, silentPort := mailtest.Silent(t)

	for _, example := range []struct {
		name   string
		server func() Server
		field  string
		code   int
		says   string
	}{
		{"dns", func() Server {
			return Server{Host: "nowhere.invalid", Port: 587, Security: SecuritySTARTTLS, FromAddress: "stoop@example.net"}
		}, "host", 0, "Can't find nowhere.invalid."},
		{"connection refused", func() Server {
			return Server{Host: "127.0.0.1", Port: mailtest.ClosedPort(t), Security: SecurityNone, FromAddress: "stoop@example.net"}
		}, "port", 0, "Nothing answered on 127.0.0.1:"},
		{"no starttls offered", func() Server {
			return serverFor(start(func(*mailtest.Options) {}), SecuritySTARTTLS)
		}, "security", 0, "doesn't offer STARTTLS"},
		{"tls against a plain port", func() Server {
			return serverFor(start(func(*mailtest.Options) {}), SecurityTLS)
		}, "security", 0, "doesn't expect TLS from the start"},
		{"plain against a tls port", func() Server {
			return serverFor(start(func(options *mailtest.Options) { options.TLS = true }), SecuritySTARTTLS)
		}, "security", 0, "expects TLS from the start"},
		{"silent port", func() Server {
			return Server{Host: silentHost, Port: silentPort, Security: SecurityNone, FromAddress: "stoop@example.net"}
		}, "security", 0, "expects TLS from the start"},
		{"certificate for another host", func() Server {
			server := serverFor(start(func(options *mailtest.Options) { options.TLS = true }), SecurityTLS)
			server.Host = "127.0.0.1"
			return server
		}, "host", 0, "The certificate isn't valid for 127.0.0.1."},
		{"wrong password", func() Server {
			server := serverFor(start(func(options *mailtest.Options) {
				options.TLS, options.Username, options.Password = true, "casey", "hunter22"
			}), SecurityTLS)
			server.Username, server.Password = "casey", "wrong"
			return server
		}, "password", 535, "localhost refused this username and password (535)."},
		{"sign-in required", func() Server {
			return serverFor(start(func(options *mailtest.Options) { options.Username, options.Password = "casey", "hunter22" }), SecurityNone)
		}, "username", 530, "localhost needs a username and password."},
		{"mail from refused", func() Server {
			return serverFor(start(func(options *mailtest.Options) { options.RefuseMail = 550 }), SecurityNone)
		}, "from_address", 550, "localhost won't send from this address (550)."},
		{"rcpt to refused", func() Server {
			return serverFor(start(func(options *mailtest.Options) { options.RefuseRcpt = 553 }), SecurityNone)
		}, "to", 553, "localhost refused this recipient (553)."},
		{"anything else", func() Server {
			return serverFor(start(func(options *mailtest.Options) { options.RefuseRcpt = 554 }), SecurityNone)
		}, "", 554, "localhost replied: 554"},
	} {
		t.Run(example.name, func(t *testing.T) {
			err := Deliver(context.Background(), example.server(), message)
			var refusal *Refusal
			if !errors.As(err, &refusal) {
				t.Fatalf("want a *Refusal, got %T: %v", err, err)
			}
			if refusal.Field != example.field || refusal.Code != example.code || !strings.Contains(refusal.Message, example.says) {
				t.Errorf("got field %q code %d %q; want field %q code %d containing %q",
					refusal.Field, refusal.Code, refusal.Message, example.field, example.code, example.says)
			}
			if strings.Contains(refusal.Message, "hunter22") || strings.Contains(refusal.Message, "wrong") {
				t.Error("the password is in the refusal")
			}
		})
	}
}

func TestDeliverHonoursCancel(t *testing.T) {
	trustFake(t)
	host, port := mailtest.Silent(t)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	started := time.Now()
	err := Deliver(ctx, Server{Host: host, Port: port, Security: SecurityNone, FromAddress: "stoop@example.net"}, message)
	if err == nil || time.Since(started) > 400*time.Millisecond {
		t.Fatalf("Deliver = %v after %s; want a prompt refusal", err, time.Since(started))
	}
}
