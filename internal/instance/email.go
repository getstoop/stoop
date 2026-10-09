package instance

import (
	"context"
	"errors"
	"fmt"
	"net"
	netmail "net/mail"
	"regexp"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/mail"
)

const keySMTP = "smtp"

// DefaultHourlyLimit caps a row saved without one.
const DefaultHourlyLimit = config.DefaultSMTPHourlyLimit

const maxFromNameRunes = 80

// SMTP is the server Stoop sends mail through.
type SMTP struct {
	Enabled     bool          `json:"enabled"`
	Host        string        `json:"host"`
	Port        int           `json:"port"`
	Security    mail.Security `json:"security"`
	Username    string        `json:"username"`
	Password    string        `json:"password"`
	FromAddress string        `json:"from_address"`
	FromName    string        `json:"from_name"`
	HourlyLimit int           `json:"hourly_limit"`
}

var smtpSecurities = newEnumSetting(map[mail.Security]instancev1.SmtpSecurity{
	mail.SecuritySTARTTLS: instancev1.SmtpSecurity_SMTP_SECURITY_STARTTLS,
	mail.SecurityTLS:      instancev1.SmtpSecurity_SMTP_SECURITY_TLS,
	mail.SecurityNone:     instancev1.SmtpSecurity_SMTP_SECURITY_NONE,
}, instancev1.SmtpSecurity_SMTP_SECURITY_UNSPECIFIED)

// UseSMTPEnv supplies STOOP_SMTP_*; a blank host means the environment
// sets no server. Set, it seeds the row switched on.
func (s *Service) UseSMTPEnv(smtp SMTP) {
	if smtp.Security == "" {
		smtp.Security = mail.SecuritySTARTTLS
	}
	if smtp.Port == 0 {
		smtp.Port = mail.DefaultPort(smtp.Security)
	}
	smtp.Enabled = smtp.Host != ""
	s.smtpEnv = smtp
}

// SMTPSettings is the saved server; a row without hourly_limit reads as
// DefaultHourlyLimit. With no row, it is the environment's.
func (s *Service) SMTPSettings(ctx context.Context) (SMTP, error) {
	smtp := SMTP{HourlyLimit: DefaultHourlyLimit}
	found, err := s.readJSON(ctx, keySMTP, &smtp)
	if err != nil || found {
		return smtp, err
	}
	if s.smtpEnv.Host != "" {
		return s.smtpEnv, nil
	}
	return smtp, nil
}

func (s *Service) GetEmailSettings(ctx context.Context, _ *connect.Request[instancev1.GetEmailSettingsRequest]) (*connect.Response[instancev1.GetEmailSettingsResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	smtp, err := s.SMTPSettings(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.GetEmailSettingsResponse{Smtp: smtp.toProto()}), nil
}

func (s *Service) UpdateEmailSettings(ctx context.Context, req *connect.Request[instancev1.UpdateEmailSettingsRequest]) (*connect.Response[instancev1.UpdateEmailSettingsResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceSettingsManage); err != nil {
		return nil, err
	}
	if err := s.SaveEmail(ctx, req.Msg.Smtp); err != nil {
		return nil, err
	}
	smtp, err := s.SMTPSettings(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateEmailSettingsResponse{Smtp: smtp.toProto()}), nil
}

// SaveEmail checks every field, then saves the server whole. Shared by the
// admin page and stoop admin, which checks no permission.
func (s *Service) SaveEmail(ctx context.Context, in *instancev1.SmtpSettings) error {
	if in == nil {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("smtp settings are required"))
	}
	current, err := s.SMTPSettings(ctx)
	if err != nil {
		return err
	}
	smtp := smtpFromProto(in, current)
	if err := smtp.validate(); err != nil {
		return err
	}
	return s.writeJSON(ctx, keySMTP, smtp)
}

// smtpFromProto is the settings a save or a test sends; a blank password
// keeps current's.
func smtpFromProto(in *instancev1.SmtpSettings, current SMTP) SMTP {
	// An unknown enum value stays blank, for validate to refuse.
	security := mail.SecuritySTARTTLS
	if in.Security != instancev1.SmtpSecurity_SMTP_SECURITY_UNSPECIFIED {
		security, _ = smtpSecurities.fromProto(in.Security)
	}
	port := int(in.Port)
	if port == 0 {
		port = mail.DefaultPort(security)
	}
	username := strings.TrimSpace(in.Username)
	password := keepSecret(in.Password, current.Password)
	// Clearing the username clears the saved password; a typed one stays
	// for validate to refuse.
	if username == "" && in.Password == "" {
		password = ""
	}
	return SMTP{
		Enabled:     in.Enabled,
		Host:        strings.TrimSpace(in.Host),
		Port:        port,
		Security:    security,
		Username:    username,
		Password:    password,
		FromAddress: strings.TrimSpace(in.FromAddress),
		FromName:    strings.TrimSpace(in.FromName),
		HourlyLimit: int(in.HourlyLimit),
	}
}

// toProto is the settings as the API shows them: the password only as set
// or not.
func (smtp SMTP) toProto() *instancev1.SmtpSettings {
	return &instancev1.SmtpSettings{
		Enabled:     smtp.Enabled,
		Host:        smtp.Host,
		Port:        uint32(max(smtp.Port, 0)),
		Security:    smtpSecurities.toProto(smtp.Security),
		Username:    smtp.Username,
		HasPassword: smtp.Password != "",
		FromAddress: smtp.FromAddress,
		FromName:    smtp.FromName,
		HourlyLimit: uint32(max(smtp.HourlyLimit, 0)),
	}
}

var hostnamePattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.?$`)

// validate applies the save rules; a refusal names its field (smtp.host,
// smtp.port, …).
func (smtp SMTP) validate() error {
	refuse := func(field, format string, args ...any) error {
		return apierr.Field(connect.CodeInvalidArgument, "smtp."+field, fmt.Errorf(format, args...))
	}
	switch {
	case smtp.Host == "" && smtp.Enabled:
		return refuse("host", "enter the SMTP server's hostname")
	case smtp.Host != "" && !validHost(smtp.Host):
		return refuse("host", "enter a hostname or IP address, with no scheme or port")
	}
	if smtp.Port < 1 || smtp.Port > 65535 {
		return refuse("port", "the port must be between 1 and 65535")
	}
	if !smtpSecurities.has(smtp.Security) {
		return refuse("security", "pick STARTTLS, TLS or none")
	}
	if smtp.Security == mail.SecurityNone && smtp.Username != "" {
		return refuse("security", "pick STARTTLS or TLS to sign in; a password is never sent unencrypted")
	}
	switch {
	case smtp.Username != "" && smtp.Password == "":
		return refuse("password", "enter the password for this username")
	case smtp.Username == "" && smtp.Password != "":
		return refuse("password", "a password needs a username")
	}
	switch {
	case smtp.FromAddress == "" && smtp.Enabled:
		return refuse("from_address", "enter the address emails are sent from")
	case smtp.FromAddress != "" && !bareAddress(smtp.FromAddress):
		return refuse("from_address", "enter one address, like stoop@example.com")
	}
	if utf8.RuneCountInString(smtp.FromName) > maxFromNameRunes {
		return refuse("from_name", "the sender name must be %d characters or fewer", maxFromNameRunes)
	}
	if strings.ContainsAny(smtp.FromName, "\r\n") {
		return refuse("from_name", "the sender name must be one line")
	}
	if smtp.HourlyLimit < 0 || smtp.HourlyLimit > config.MaxSMTPHourlyLimit {
		return refuse("hourly_limit", "the hourly limit must be between 0 and %d", config.MaxSMTPHourlyLimit)
	}
	return nil
}

func validHost(host string) bool {
	return net.ParseIP(host) != nil || (len(host) <= 253 && hostnamePattern.MatchString(host))
}

// bareAddress reports whether address is one address with no name or
// angle brackets.
func bareAddress(address string) bool {
	parsed, err := netmail.ParseAddress(address)
	return err == nil && parsed.Name == "" && parsed.Address == address
}
