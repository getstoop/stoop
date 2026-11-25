package chat

import (
	"errors"
	"regexp"
	"time"
	// The zone database, in the binary: a reminder's time is worked out in
	// the person's zone, and a host need not carry one.
	_ "time/tzdata"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// When a reminder is for (docs/architecture/messaging.md → Reminders): a
// request says what time is meant, a preset or a wall-clock time in a
// named zone, and the instant is worked out here from the server's
// clock. A device's clock decides nothing.

const (
	minReminderLead = time.Minute
	// tomorrowHour is the hour of "tomorrow at 9:00".
	tomorrowHour = 9
	// maxZoneNameLen is longer than any name in the zone database.
	maxZoneNameLen = 64
)

// presetLeads are the presets that are a wait from now.
var presetLeads = map[chatv1.ReminderPreset]time.Duration{
	chatv1.ReminderPreset_REMINDER_PRESET_IN_20_MINUTES: 20 * time.Minute,
	chatv1.ReminderPreset_REMINDER_PRESET_IN_1_HOUR:     time.Hour,
	chatv1.ReminderPreset_REMINDER_PRESET_IN_3_HOURS:    3 * time.Hour,
}

// localTimeShape is a date-and-time field's value, seconds optional.
var localTimeShape = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$`)

func errReminderTime(message string) error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New(message))
}

// reminderTime is the instant a request means at now, as it is stored:
// rounded down to the whole minute. A wall-clock time is first checked
// to be from a minute to a year ahead.
func reminderTime(req *chatv1.CreateReminderRequest, now time.Time) (time.Time, error) {
	hasPreset := req.Preset != chatv1.ReminderPreset_REMINDER_PRESET_UNSPECIFIED
	switch {
	case hasPreset && req.LocalTime != "":
		return time.Time{}, errReminderTime("a reminder's time is a preset or a date and time, not both")
	case !hasPreset && req.LocalTime == "":
		return time.Time{}, errReminderTime("a reminder needs a time")
	}
	lead, relative := presetLeads[req.Preset]
	if hasPreset && !relative && req.Preset != chatv1.ReminderPreset_REMINDER_PRESET_TOMORROW_AT_9 {
		return time.Time{}, errReminderTime("a reminder's time is not a preset the server knows")
	}
	zone, err := reminderZone(req.TimeZone)
	if err != nil {
		return time.Time{}, err
	}
	if relative {
		return now.Add(lead).UTC().Truncate(time.Minute), nil
	}
	if zone == nil {
		return time.Time{}, errReminderTime("a reminder's time needs a time zone")
	}
	if hasPreset {
		today := now.In(zone)
		return wallClock(today.Year(), today.Month(), today.Day()+1, tomorrowHour, 0, zone).UTC(), nil
	}
	if !localTimeShape.MatchString(req.LocalTime) {
		return time.Time{}, errReminderTime("a reminder's time must read like 2026-12-02T09:00")
	}
	// Parsing refuses what the shape lets through: a 13th month, the 30th
	// of February, 24:00, a 60th second.
	layout := "2006-01-02T15:04:05"[:len(req.LocalTime)]
	named, err := time.Parse(layout, req.LocalTime)
	if err != nil {
		return time.Time{}, errReminderTime("a reminder's time is not a real date and time")
	}
	remindAt := wallClock(named.Year(), named.Month(), named.Day(), named.Hour(), named.Minute(), zone)
	if remindAt.Before(now.Add(minReminderLead)) {
		return time.Time{}, errReminderTime("a reminder's time must be at least a minute from now")
	}
	if remindAt.After(now.AddDate(1, 0, 0)) {
		return time.Time{}, errReminderTime("a reminder's time can be at most a year from now")
	}
	return remindAt.UTC(), nil
}

// reminderZone is the zone a request names: nil for none. "Local" is
// refused, since it would name the server's zone and not the person's.
func reminderZone(name string) (*time.Location, error) {
	if name == "" {
		return nil, nil
	}
	if len(name) > maxZoneNameLen || name == "Local" {
		return nil, errReminderTime("a reminder's time zone is not one the server knows")
	}
	zone, err := time.LoadLocation(name)
	if err != nil {
		return nil, errReminderTime("a reminder's time zone is not one the server knows")
	}
	return zone, nil
}

// wallClock is the instant a zone's clock shows this date and minute
// (a day past the month's end rolls into the next). By one rule where
// the clock changes: a time the clock skips is read as the clock shows
// it after the change, so 02:30 on a morning that goes from 02:00 to
// 03:00 is 03:30; a time the clock shows twice is the first of the two.
// time.Date promises neither, so the offsets either side are tried here.
func wallClock(year int, month time.Month, day, hour, minute int, zone *time.Location) time.Time {
	naive := time.Date(year, month, day, hour, minute, 0, 0, time.UTC)
	// The zone's offsets a day either side, and the instant each gives.
	_, offsetBefore := naive.Add(-24 * time.Hour).In(zone).Zone()
	_, offsetAfter := naive.Add(24 * time.Hour).In(zone).Zone()
	byBefore := naive.Add(-time.Duration(offsetBefore) * time.Second)
	byAfter := naive.Add(-time.Duration(offsetAfter) * time.Second)
	shows := func(instant time.Time) bool {
		_, offset := instant.In(zone).Zone()
		return instant.Add(time.Duration(offset) * time.Second).Equal(naive)
	}
	switch {
	case shows(byBefore) && shows(byAfter):
		// The same instant on an ordinary day; the first of a repeated time.
		if byAfter.Before(byBefore) {
			return byAfter
		}
		return byBefore
	case shows(byAfter):
		return byAfter
	}
	// Shown by the offset before the change alone, or by neither: a
	// skipped time, which that offset carries past the change.
	return byBefore
}
