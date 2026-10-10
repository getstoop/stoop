package mail

import (
	"embed"
	"fmt"
	htmltemplate "html/template"
	"net/url"
	"reflect"
	"strings"
	texttemplate "text/template"
	"time"
)

//go:embed templates
var templateFiles embed.FS

const (
	textLayout = "layout.txt.tmpl"
	htmlLayout = "layout.html.tmpl"
)

// messageTemplates is one message's two parts, each joined to its layout.
type messageTemplates struct {
	text *texttemplate.Template
	html *htmltemplate.Template
}

var parsedTemplates = parseTemplates()

// templateView is what a template sees: .Site, .Subject (HTML only) and
// .Data, the message's own struct.
type templateView struct {
	Site    siteView
	Subject string
	Data    any
}

type siteView struct {
	InstanceName string
	// The public URL without a trailing slash, and its host; both "" when
	// the server has none.
	URL  string
	Host string
}

// Render writes the subject, text and HTML of the named message. data
// must be the message's own struct (ConfirmEmailData, …); the caller sets
// To and OnSent.
func Render(name string, data any, site Site) (Message, error) {
	templates, ok := parsedTemplates[name]
	if !ok {
		return Message{}, fmt.Errorf("unknown email template %q", name)
	}
	if want := messageData[name]; reflect.TypeOf(data) != want {
		return Message{}, fmt.Errorf("email template %q renders %s, not %T", name, want, data)
	}
	view := templateView{Site: newSiteView(site), Data: data}

	var subject strings.Builder
	if err := templates.text.ExecuteTemplate(&subject, "subject", view); err != nil {
		return Message{}, fmt.Errorf("render %s subject: %w", name, err)
	}
	// One line, so nothing in it can start another header.
	view.Subject = strings.Join(strings.Fields(subject.String()), " ")

	var text strings.Builder
	if err := templates.text.ExecuteTemplate(&text, textLayout, view); err != nil {
		return Message{}, fmt.Errorf("render %s text: %w", name, err)
	}
	var html strings.Builder
	if err := templates.html.ExecuteTemplate(&html, htmlLayout, view); err != nil {
		return Message{}, fmt.Errorf("render %s html: %w", name, err)
	}
	return Message{Subject: view.Subject, Text: text.String(), HTML: html.String()}, nil
}

func newSiteView(site Site) siteView {
	view := siteView{InstanceName: site.InstanceName, URL: strings.TrimRight(site.PublicURL, "/")}
	if parsed, err := url.Parse(view.URL); err == nil {
		view.Host = parsed.Host
	}
	if view.Host == "" {
		view.URL = ""
	}
	return view
}

func parseTemplates() map[string]messageTemplates {
	funcs := map[string]any{"when": formatWhen, "day": formatDay, "clock": formatClock}
	htmlFuncs := map[string]any{"when": formatWhen, "day": formatDay, "clock": formatClock,
		"outlookOpen": func() htmltemplate.HTML { return outlookOpen }, "outlookClose": func() htmltemplate.HTML { return outlookClose }}
	parsed := make(map[string]messageTemplates, len(messageData))
	for name := range messageData {
		text := texttemplate.Must(texttemplate.New(name).Funcs(funcs).Option("missingkey=error").
			ParseFS(templateFiles, "templates/"+textLayout, "templates/"+name+".txt.tmpl"))
		html := htmltemplate.Must(htmltemplate.New(name).Funcs(htmlFuncs).Option("missingkey=error").
			ParseFS(templateFiles, "templates/"+htmlLayout, "templates/"+name+".html.tmpl"))
		parsed[name] = messageTemplates{text: text, html: html}
	}
	return parsed
}

// formatWhen is "9 October 2026 at 22:14 UTC".
func formatWhen(at time.Time) string { return formatDay(at) + " at " + formatClock(at) }

// formatDay is "9 October 2026".
func formatDay(at time.Time) string { return at.UTC().Format("2 January 2006") }

// formatClock is "22:14 UTC".
func formatClock(at time.Time) string { return at.UTC().Format("15:04") + " UTC" }

// Outlook on Windows ignores max-width, so the card would stretch across
// the window; only it reads these conditional comments, which give it a
// fixed 560px table. html/template drops comments written in a template,
// so they come in as values.
const (
	outlookOpen  = `<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`
	outlookClose = `<!--[if mso]></td></tr></table><![endif]-->`
)
