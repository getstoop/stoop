package mail

import (
	"reflect"
	"time"
)

// TemplateSMTPTest is the admin's test send; it is sent directly, not by
// a job.
const TemplateSMTPTest = "smtp_test"

// ConfirmEmailData fills TemplateConfirmEmail.
type ConfirmEmailData struct {
	Username string
	Link     string
}

// EmailChangedData fills TemplateEmailChanged.
type EmailChangedData struct {
	Username string
	At       time.Time
}

// PasswordResetData fills TemplatePasswordReset.
type PasswordResetData struct {
	Username string
	Link     string
}

// PasswordChangedData fills TemplatePasswordChanged.
type PasswordChangedData struct {
	Username string
	At       time.Time
}

// SMTPTestData fills TemplateSMTPTest.
type SMTPTestData struct {
	// The SMTP server the test went through.
	Host   string
	SentAt time.Time
}

// messageData is the data type each template renders with.
var messageData = map[string]reflect.Type{
	TemplateConfirmEmail:    reflect.TypeFor[ConfirmEmailData](),
	TemplateEmailChanged:    reflect.TypeFor[EmailChangedData](),
	TemplatePasswordReset:   reflect.TypeFor[PasswordResetData](),
	TemplatePasswordChanged: reflect.TypeFor[PasswordChangedData](),
	TemplateSMTPTest:        reflect.TypeFor[SMTPTestData](),
}
