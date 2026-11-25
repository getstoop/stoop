package chat

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// When a reminder is for (docs/architecture/messaging.md → Reminders):
// the instant the server works out from what a request says, against a
// clock the test fixes.

const (
	in20Minutes = chatv1.ReminderPreset_REMINDER_PRESET_IN_20_MINUTES
	in1Hour     = chatv1.ReminderPreset_REMINDER_PRESET_IN_1_HOUR
	in3Hours    = chatv1.ReminderPreset_REMINDER_PRESET_IN_3_HOURS
	tomorrowAt9 = chatv1.ReminderPreset_REMINDER_PRESET_TOMORROW_AT_9
)

func utc(year int, month time.Month, day, hour, minute, second int) time.Time {
	return time.Date(year, month, day, hour, minute, second, 0, time.UTC)
}

func localRequest(local, zone string) *chatv1.CreateReminderRequest {
	return &chatv1.CreateReminderRequest{LocalTime: local, TimeZone: zone}
}

// wantTime checks the instant a request means at now.
func wantTime(t *testing.T, what string, req *chatv1.CreateReminderRequest, now, want time.Time) {
	t.Helper()
	got, err := reminderTime(req, now)
	if err != nil || !got.Equal(want) || got.Location() != time.UTC {
		t.Errorf("%s = %s, %v; want %s", what, got, err, want)
	}
}

// wantRefused checks a request is InvalidArgument in these words.
func wantRefused(t *testing.T, what string, req *chatv1.CreateReminderRequest, now time.Time, words string) {
	t.Helper()
	got, err := reminderTime(req, now)
	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), words) {
		t.Errorf("%s = %s, %v; want InvalidArgument saying %q", what, got, err, words)
	}
}

// The three waits are the server's now plus the wait, rounded down to
// the minute, whatever zone is sent or none; a zone that is sent must
// still be one.
func TestReminderPresetsAreWaitsFromTheServersClock(t *testing.T) {
	now := utc(2026, 11, 24, 12, 0, 50)
	for preset, want := range map[chatv1.ReminderPreset]time.Time{
		in20Minutes: utc(2026, 11, 24, 12, 20, 0),
		in1Hour:     utc(2026, 11, 24, 13, 0, 0),
		in3Hours:    utc(2026, 11, 24, 15, 0, 0),
	} {
		for _, zone := range []string{"", "UTC", "Asia/Kolkata", "America/New_York"} {
			wantTime(t, preset.String()+" in "+zone, &chatv1.CreateReminderRequest{Preset: preset, TimeZone: zone}, now, want)
		}
		wantRefused(t, preset.String()+" with a zone that is none",
			&chatv1.CreateReminderRequest{Preset: preset, TimeZone: "Mars/Olympus"}, now, "not one the server knows")
	}
	// A wait is a span, not a clock reading: across the hour New York's
	// clocks go back, three hours is still three hours.
	night := utc(2026, 11, 1, 4, 30, 0) // 00:30 EDT
	wantTime(t, "three hours across a clock change",
		&chatv1.CreateReminderRequest{Preset: in3Hours, TimeZone: "America/New_York"}, night, utc(2026, 11, 1, 7, 30, 0))
}

// "Tomorrow at 9:00" is 09:00 on the day after today in the person's
// zone, where today is the server's now read in that zone.
func TestReminderTomorrowAtNine(t *testing.T) {
	for name, tc := range map[string]struct {
		now  time.Time
		zone string
		want time.Time
	}{
		"UTC":              {utc(2026, 11, 24, 12, 0, 50), "UTC", utc(2026, 11, 25, 9, 0, 0)},
		"New York, winter": {utc(2026, 11, 24, 12, 0, 0), "America/New_York", utc(2026, 11, 25, 14, 0, 0)},
		"a half-hour zone": {utc(2026, 11, 24, 12, 0, 0), "Asia/Kolkata", utc(2026, 11, 25, 3, 30, 0)},
		// 23:30 UTC on the 24th is already the 25th in Tokyo and Auckland.
		"the zone is a day ahead": {utc(2026, 11, 24, 23, 30, 0), "Asia/Tokyo", utc(2026, 11, 26, 0, 0, 0)},
		"a day ahead, in summer":  {utc(2026, 11, 24, 23, 30, 0), "Pacific/Auckland", utc(2026, 11, 25, 20, 0, 0)},
		// 03:00 UTC on the 25th is still the 24th in Los Angeles.
		"the zone is a day behind": {utc(2026, 11, 25, 3, 0, 0), "America/Los_Angeles", utc(2026, 11, 25, 17, 0, 0)},
		"just before midnight":     {utc(2026, 11, 25, 4, 59, 59), "America/New_York", utc(2026, 11, 25, 14, 0, 0)},
		"just after midnight":      {utc(2026, 11, 25, 5, 0, 0), "America/New_York", utc(2026, 11, 26, 14, 0, 0)},
		"the month ends":           {utc(2026, 11, 30, 12, 0, 0), "UTC", utc(2026, 12, 1, 9, 0, 0)},
		"the year ends":            {utc(2026, 12, 31, 12, 0, 0), "Europe/Berlin", utc(2027, 1, 1, 8, 0, 0)},
		"a leap day":               {utc(2028, 2, 28, 12, 0, 0), "UTC", utc(2028, 2, 29, 9, 0, 0)},
		// The night before the clocks go forward: 9:00 is an hour sooner.
		"clocks go forward tonight": {utc(2026, 3, 7, 17, 0, 0), "America/New_York", utc(2026, 3, 8, 13, 0, 0)},
		// The night before they go back: an hour later.
		"clocks go back tonight": {utc(2026, 10, 31, 16, 0, 0), "America/New_York", utc(2026, 11, 1, 14, 0, 0)},
		"Europe goes forward":    {utc(2026, 3, 28, 12, 0, 0), "Europe/London", utc(2026, 3, 29, 8, 0, 0)},
	} {
		wantTime(t, name, &chatv1.CreateReminderRequest{Preset: tomorrowAt9, TimeZone: tc.zone}, tc.now, tc.want)
	}
	now := utc(2026, 11, 24, 12, 0, 0)
	wantRefused(t, "with no zone", &chatv1.CreateReminderRequest{Preset: tomorrowAt9}, now, "needs a time zone")
	wantRefused(t, "in a zone that is none", &chatv1.CreateReminderRequest{Preset: tomorrowAt9, TimeZone: "Nowhere"}, now, "not one the server knows")
}

// A date and time is that reading of the zone's clock, with seconds
// ignored, and must be from a minute to a year ahead by the server's
// clock.
func TestReminderLocalTime(t *testing.T) {
	now := utc(2026, 11, 24, 12, 0, 50)
	wantTime(t, "in UTC", localRequest("2026-12-02T09:00", "UTC"), now, utc(2026, 12, 2, 9, 0, 0))
	wantTime(t, "in New York, winter", localRequest("2026-12-02T09:00", "America/New_York"), now, utc(2026, 12, 2, 14, 0, 0))
	wantTime(t, "in New York, summer", localRequest("2027-07-02T09:00", "America/New_York"), now, utc(2027, 7, 2, 13, 0, 0))
	wantTime(t, "in a half-hour zone", localRequest("2026-12-02T09:00", "Asia/Kolkata"), now, utc(2026, 12, 2, 3, 30, 0))
	wantTime(t, "with seconds, which are ignored", localRequest("2026-12-02T09:00:45", "UTC"), now, utc(2026, 12, 2, 9, 0, 0))
	// The zone's date, not the server's: 08:00 on the 25th in Tokyo is
	// still the 24th in UTC.
	wantTime(t, "tomorrow in the zone, today on the server", localRequest("2026-11-25T08:00", "Asia/Tokyo"), now, utc(2026, 11, 24, 23, 0, 0))

	// The bounds, by the server's clock at 12:00:50.
	wantTime(t, "the first minute far enough ahead", localRequest("2026-11-24T12:02", "UTC"), now, utc(2026, 11, 24, 12, 2, 0))
	wantRefused(t, "ten seconds ahead", localRequest("2026-11-24T12:01", "UTC"), now, "at least a minute from now")
	wantRefused(t, "now", localRequest("2026-11-24T12:00", "UTC"), now, "at least a minute from now")
	wantRefused(t, "yesterday", localRequest("2026-11-23T12:00", "UTC"), now, "at least a minute from now")
	wantRefused(t, "seconds do not carry it past the bound", localRequest("2026-11-24T12:01:59", "UTC"), now, "at least a minute from now")
	// Exactly a minute ahead is taken.
	wantTime(t, "exactly a minute ahead", localRequest("2026-11-24T12:01", "UTC"), utc(2026, 11, 24, 12, 0, 0), utc(2026, 11, 24, 12, 1, 0))
	wantTime(t, "the last minute within a year", localRequest("2027-11-24T12:00", "UTC"), now, utc(2027, 11, 24, 12, 0, 0))
	wantRefused(t, "a minute past a year", localRequest("2027-11-24T12:01", "UTC"), now, "at most a year from now")
	// What the person's device thinks the time is plays no part: this
	// reading is in the past for the server, whatever it was for them.
	wantRefused(t, "a time the server has passed", localRequest("2026-11-24T06:30", "America/New_York"), now, "at least a minute from now")

	for name, local := range map[string]string{
		"a date alone":      "2026-12-02",
		"no T":              "2026-12-02 09:00",
		"an offset":         "2026-12-02T09:00+01:00",
		"a Z":               "2026-12-02T09:00Z",
		"fractions":         "2026-12-02T09:00:00.5",
		"one-digit parts":   "2026-12-2T9:00",
		"words":             "tomorrow morning",
		"a trailing space":  "2026-12-02T09:00 ",
		"a five-digit year": "12026-12-02T09:00",
	} {
		wantRefused(t, name, localRequest(local, "UTC"), now, "must read like 2026-12-02T09:00")
	}
	for name, local := range map[string]string{
		"a 13th month":         "2026-13-02T09:00",
		"the 30th of February": "2027-02-30T09:00",
		"the 29th, no leap":    "2027-02-29T09:00",
		"a 24th hour":          "2026-12-02T24:00",
		"a 60th minute":        "2026-12-02T09:60",
		"a 60th second":        "2026-12-02T09:00:60",
		"day zero":             "2026-12-00T09:00",
	} {
		wantRefused(t, name, localRequest(local, "UTC"), now, "not a real date and time")
	}
	wantTime(t, "the 29th in a leap year", localRequest("2028-02-29T09:00", "UTC"), utc(2028, 1, 1, 0, 0, 0), utc(2028, 2, 29, 9, 0, 0))
}

// Where a zone's clock changes there is one rule: a time the clock skips
// is read as the clock shows it after the change, and a time it shows
// twice is the first of the two.
func TestReminderLocalTimeAcrossClockChanges(t *testing.T) {
	spring := utc(2026, 3, 1, 0, 0, 0)
	// New York, 8 March 2026: 02:00 EST becomes 03:00 EDT.
	wantTime(t, "the last minute before the gap", localRequest("2026-03-08T01:59", "America/New_York"), spring, utc(2026, 3, 8, 6, 59, 0))
	wantTime(t, "the start of the gap", localRequest("2026-03-08T02:00", "America/New_York"), spring, utc(2026, 3, 8, 7, 0, 0))
	wantTime(t, "inside the gap, read as 03:30", localRequest("2026-03-08T02:30", "America/New_York"), spring, utc(2026, 3, 8, 7, 30, 0))
	wantTime(t, "03:30 itself, the same instant", localRequest("2026-03-08T03:30", "America/New_York"), spring, utc(2026, 3, 8, 7, 30, 0))
	wantTime(t, "the first minute after the gap", localRequest("2026-03-08T03:00", "America/New_York"), spring, utc(2026, 3, 8, 7, 0, 0))
	wantTime(t, "later that day", localRequest("2026-03-08T10:00", "America/New_York"), spring, utc(2026, 3, 8, 14, 0, 0))
	wantTime(t, "the day before", localRequest("2026-03-07T10:00", "America/New_York"), spring, utc(2026, 3, 7, 15, 0, 0))

	autumn := utc(2026, 10, 1, 0, 0, 0)
	// New York, 1 November 2026: 02:00 EDT becomes 01:00 EST, so 01:00
	// to 01:59 is shown twice.
	wantTime(t, "before the repeat", localRequest("2026-11-01T00:30", "America/New_York"), autumn, utc(2026, 11, 1, 4, 30, 0))
	wantTime(t, "a repeated time, the first", localRequest("2026-11-01T01:30", "America/New_York"), autumn, utc(2026, 11, 1, 5, 30, 0))
	wantTime(t, "the start of the repeat, the first", localRequest("2026-11-01T01:00", "America/New_York"), autumn, utc(2026, 11, 1, 5, 0, 0))
	wantTime(t, "after the repeat", localRequest("2026-11-01T02:00", "America/New_York"), autumn, utc(2026, 11, 1, 7, 0, 0))
	wantTime(t, "later that day", localRequest("2026-11-01T10:00", "America/New_York"), autumn, utc(2026, 11, 1, 15, 0, 0))

	// South of the equator the year runs the other way, and one zone
	// changes by half an hour.
	wantTime(t, "Sydney's gap", localRequest("2026-10-04T02:30", "Australia/Sydney"), autumn, utc(2026, 10, 3, 16, 30, 0))
	wantTime(t, "Lord Howe's half-hour gap", localRequest("2026-10-04T02:15", "Australia/Lord_Howe"), autumn, utc(2026, 10, 3, 15, 45, 0))
	wantTime(t, "London's repeat, the first", localRequest("2026-10-25T01:30", "Europe/London"), autumn, utc(2026, 10, 25, 0, 30, 0))

	// The same input gives the same instant every time.
	for range 5 {
		wantTime(t, "again", localRequest("2026-11-01T01:30", "America/New_York"), autumn, utc(2026, 11, 1, 5, 30, 0))
	}
}

// A request says when in exactly one way, with a preset the server
// knows, in a zone it knows.
func TestReminderTimeRefusals(t *testing.T) {
	now := utc(2026, 11, 24, 12, 0, 0)
	wantRefused(t, "neither", &chatv1.CreateReminderRequest{}, now, "needs a time")
	wantRefused(t, "neither, with a zone", &chatv1.CreateReminderRequest{TimeZone: "UTC"}, now, "needs a time")
	wantRefused(t, "both", &chatv1.CreateReminderRequest{Preset: in1Hour, LocalTime: "2026-12-02T09:00", TimeZone: "UTC"}, now, "not both")
	wantRefused(t, "a preset from a newer app", &chatv1.CreateReminderRequest{Preset: 99, TimeZone: "UTC"}, now, "not a preset the server knows")
	wantRefused(t, "a date and time with no zone", localRequest("2026-12-02T09:00", ""), now, "needs a time zone")
	for name, zone := range map[string]string{
		"an unknown zone":       "Mars/Olympus",
		"the server's own zone": "Local",
		"an offset":             "+01:00",
		"an abbreviation":       "PDT",
		"a path":                "../../etc/passwd",
		"a very long name":      strings.Repeat("A", 200),
		"padded":                " UTC",
	} {
		wantRefused(t, name, localRequest("2026-12-02T09:00", zone), now, "not one the server knows")
	}
	// Names the zone database holds, old and new.
	for _, zone := range []string{"UTC", "Etc/UTC", "Europe/Kyiv", "Asia/Calcutta", "America/Argentina/ComodRivadavia", "US/Pacific"} {
		if _, err := reminderTime(localRequest("2026-12-02T09:00", zone), now); err != nil {
			t.Errorf("zone %s: %v", zone, err)
		}
	}
}
