package db_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/db"
)

func TestWriteReport(t *testing.T) {
	pending := db.Plan{Applied: 37, Newest: 42, Pending: []db.Migration{{Version: 38, Name: "session_user_agent"}, {Version: 42, Name: "message_fk_indexes"}}}.Report("v0.3.0")
	var out bytes.Buffer
	db.WriteReport(&out, pending, true)
	for _, want := range []string{
		"database   migration 37 (0.2.0), floor 0",
		"binary     0.3.0, migration 42, floor 0",
		"pending    2",
		"           00038_session_user_agent",
		"startable  0.1.0 and later can start",
		"after up   floor stays at 0; 0.1.0 and later can start",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}

	out.Reset()
	db.WriteReport(&out, pending, false)
	if strings.Contains(out.String(), "after up") || !strings.Contains(out.String(), "startable  0.1.0") {
		t.Errorf("status should say what starts now, not what up means:\n%s", out.String())
	}

	contract := db.Plan{Applied: 40, Newest: 45, Floor: 0, FloorAfter: 37, Pending: []db.Migration{{Version: 45, Name: "drop_sessions"}}}.Report("0.4.0")
	if !contract.Contract || contract.Startable != "0.1.0" || contract.StartableAfter != "0.2.0" || contract.AppliedRelease != "past 0.2.0" {
		t.Errorf("contract report: %+v", contract)
	}
	out.Reset()
	db.WriteReport(&out, contract, true)
	for _, want := range []string{
		"migration 40 (past 0.2.0)",
		"contract migration: floor rises from 0 to 37; 0.2.0 and later can start",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}

	refused := db.Plan{Applied: 999, Newest: 42, Floor: 999, FloorAfter: 999, Ahead: []int64{999}}.Report("dev")
	if refused.Refused == "" || refused.Startable != "" {
		t.Errorf("refused report: %+v", refused)
	}
	out.Reset()
	db.WriteReport(&out, refused, true)
	for _, want := range []string{"ahead      999 applied by a newer release", "refused    database was changed by a newer Stoop"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}

	body, err := json.Marshal(db.Plan{Applied: 42, Newest: 42}.Report("0.3.0"))
	if err != nil {
		t.Fatal(err)
	}
	var back db.Report
	if err := json.Unmarshal(body, &back); err != nil {
		t.Fatal(err)
	}
	if back.Startable != "0.1.0" || len(back.Pending) != 0 || !strings.Contains(string(body), `"pending":[]`) {
		t.Errorf("round trip: %s", body)
	}
}
