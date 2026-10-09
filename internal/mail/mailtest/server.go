// Package mailtest is a scriptable SMTP server for tests. Nothing outside
// tests imports it.
package mailtest

import (
	"crypto/tls"
	"errors"
	"io"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
)

// Options script what the server offers and where it says no.
type Options struct {
	// TLS serves TLS from the first byte; Certificate is required.
	TLS bool
	// STARTTLS offers STARTTLS on a plain listener; Certificate is required.
	STARTTLS    bool
	Certificate tls.Certificate
	// Username and Password are the one sign-in accepted. Set, mail
	// without signing in is refused with 530.
	Username, Password string
	// LoginOnly offers LOGIN instead of PLAIN.
	LoginOnly bool
	// RefuseMail and RefuseRcpt are a reply code for MAIL FROM and RCPT TO.
	RefuseMail, RefuseRcpt int
}

// Received is one message the server accepted.
type Received struct {
	From string
	To   []string
	Data string
}

// Server is a running fake.
type Server struct {
	Host     string
	Port     int
	received chan Received
}

// Start serves on 127.0.0.1 until the test ends.
func Start(t *testing.T, options Options) *Server {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	fake := &Server{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, received: make(chan Received, 16)}
	server := smtp.NewServer(smtp.BackendFunc(func(*smtp.Conn) (smtp.Session, error) {
		return &session{options: options, fake: fake}, nil
	}))
	server.Domain = "localhost"
	server.ErrorLog = discardLogger{}
	if options.TLS || options.STARTTLS {
		server.TLSConfig = &tls.Config{Certificates: []tls.Certificate{options.Certificate}}
	}
	if options.TLS {
		listener = tls.NewListener(listener, server.TLSConfig)
	}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return fake
}

// Address is host:port.
func (fake *Server) Address() string {
	return net.JoinHostPort(fake.Host, strconv.Itoa(fake.Port))
}

// Next is the next message accepted, waiting up to five seconds.
func (fake *Server) Next(t *testing.T) Received {
	t.Helper()
	select {
	case message := <-fake.received:
		return message
	case <-time.After(5 * time.Second):
		t.Fatal("no message arrived")
		return Received{}
	}
}

// Silent accepts connections and never says a word, the way a TLS port
// waits for a client hello.
func Silent(t *testing.T) (host string, port int) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { _ = conn.Close() })
		}
	}()
	t.Cleanup(func() { _ = listener.Close() })
	return "127.0.0.1", listener.Addr().(*net.TCPAddr).Port
}

// ClosedPort is a port on 127.0.0.1 that nothing listens on.
func ClosedPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	return port
}

type session struct {
	options  Options
	fake     *Server
	signedIn bool
	message  Received
}

func (s *session) AuthMechanisms() []string {
	if s.options.Username == "" {
		return nil
	}
	if s.options.LoginOnly {
		return []string{"LOGIN"}
	}
	return []string{sasl.Plain}
}

func (s *session) Auth(mechanism string) (sasl.Server, error) {
	check := func(username, password string) error {
		if username != s.options.Username || password != s.options.Password {
			return smtp.ErrAuthFailed
		}
		s.signedIn = true
		return nil
	}
	if mechanism == "LOGIN" {
		return &loginServer{check: check}, nil
	}
	return sasl.NewPlainServer(func(_, username, password string) error { return check(username, password) }), nil
}

func (s *session) Mail(from string, _ *smtp.MailOptions) error {
	if s.options.Username != "" && !s.signedIn {
		return &smtp.SMTPError{Code: 530, EnhancedCode: smtp.EnhancedCode{5, 7, 0}, Message: "Authentication required"}
	}
	if s.options.RefuseMail != 0 {
		return &smtp.SMTPError{Code: s.options.RefuseMail, EnhancedCode: smtp.EnhancedCode{5, 7, 1}, Message: "Sender not allowed"}
	}
	s.message.From = from
	return nil
}

func (s *session) Rcpt(to string, _ *smtp.RcptOptions) error {
	if s.options.RefuseRcpt != 0 {
		return &smtp.SMTPError{Code: s.options.RefuseRcpt, EnhancedCode: smtp.EnhancedCode{5, 1, 1}, Message: "No such user"}
	}
	s.message.To = append(s.message.To, to)
	return nil
}

func (s *session) Data(reader io.Reader) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	s.message.Data = string(data)
	s.fake.received <- s.message
	s.message = Received{}
	return nil
}

func (s *session) Reset()        { s.message = Received{} }
func (s *session) Logout() error { return nil }

// loginServer is the LOGIN mechanism, which go-sasl no longer ships.
type loginServer struct {
	check    func(username, password string) error
	username string
	step     int
}

func (login *loginServer) Next(response []byte) ([]byte, bool, error) {
	login.step++
	switch login.step {
	case 1:
		return []byte("Username:"), false, nil
	case 2:
		login.username = string(response)
		return []byte("Password:"), false, nil
	case 3:
		return nil, true, login.check(login.username, string(response))
	}
	return nil, false, errors.New("unexpected LOGIN step")
}

type discardLogger struct{}

func (discardLogger) Printf(string, ...any) {}
func (discardLogger) Println(...any)        {}
