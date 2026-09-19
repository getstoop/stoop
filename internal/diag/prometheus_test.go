package diag

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func smallSnapshot() Snapshot {
	var h Histogram
	h.Observe(time.Millisecond)
	h.Observe(2 * time.Second)
	return Snapshot{
		Counters: []CounterSample{{Name: "bus_dropped", Help: "Slow consumers dropped.", Value: 2}},
		Gauges:   []GaugeSample{{Name: "connections", Help: "Open sockets.", Value: 12.5}},
		Procedures: []ProcedureStats{{
			Procedure: "ChatService.ListMessages", Calls: 2, Errors: 1,
			Sum: h.Sum(), Buckets: h.Buckets(),
		}},
		Jobs: []JobRecord{{
			Name: "file_sweep", LastSuccess: time.UnixMilli(1_700_000_000_250),
			LastDuration: 1500 * time.Millisecond,
		}},
	}
}

const golden = `# HELP stoop_bus_dropped_total Slow consumers dropped.
# TYPE stoop_bus_dropped_total counter
stoop_bus_dropped_total 2
# HELP stoop_connections Open sockets.
# TYPE stoop_connections gauge
stoop_connections 12.5
# HELP stoop_rpc_calls_total Unary RPC calls since start.
# TYPE stoop_rpc_calls_total counter
stoop_rpc_calls_total{procedure="ChatService.ListMessages"} 2
# HELP stoop_rpc_errors_total Unary RPC calls that failed, Canceled excluded.
# TYPE stoop_rpc_errors_total counter
stoop_rpc_errors_total{procedure="ChatService.ListMessages"} 1
# HELP stoop_rpc_duration_seconds Unary RPC duration.
# TYPE stoop_rpc_duration_seconds histogram
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.001"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.0016"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.0026"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.0043"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.007"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.011"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.018"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.03"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.048"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.078"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.13"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.21"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.34"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.55"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="0.89"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="1.4"} 1
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="2.3"} 2
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="3.8"} 2
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="6.2"} 2
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="10"} 2
stoop_rpc_duration_seconds_bucket{procedure="ChatService.ListMessages",le="+Inf"} 2
stoop_rpc_duration_seconds_sum{procedure="ChatService.ListMessages"} 2.001
stoop_rpc_duration_seconds_count{procedure="ChatService.ListMessages"} 2
# HELP stoop_job_last_success_timestamp_seconds When the job last succeeded; 0 if never.
# TYPE stoop_job_last_success_timestamp_seconds gauge
stoop_job_last_success_timestamp_seconds{job="file_sweep"} 1700000000.250
# HELP stoop_job_last_duration_seconds How long the job's last pass took.
# TYPE stoop_job_last_duration_seconds gauge
stoop_job_last_duration_seconds{job="file_sweep"} 1.5
`

func TestWriteTextGolden(t *testing.T) {
	var sb strings.Builder
	if err := WriteText(&sb, smallSnapshot()); err != nil {
		t.Fatal(err)
	}
	if sb.String() != golden {
		t.Errorf("output differs from golden:\n%s", sb.String())
	}
}

var (
	sampleLine = regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})? -?[0-9.e+]+$|^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})? \+Inf$`)
	labelPair  = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*="[^"]*"$`)
)

// TestWriteTextIsWellFormed checks every line: HELP then TYPE precede a
// family's samples, every label value is quoted, and the histogram ends
// in +Inf.
func TestWriteTextIsWellFormed(t *testing.T) {
	var sb strings.Builder
	if err := WriteText(&sb, smallSnapshot()); err != nil {
		t.Fatal(err)
	}
	typed := map[string]string{}
	lastHelp := ""
	sawInf := false
	for i, line := range strings.Split(strings.TrimSuffix(sb.String(), "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "# HELP "):
			lastHelp = strings.Fields(line)[2]
		case strings.HasPrefix(line, "# TYPE "):
			f := strings.Fields(line)
			if f[2] != lastHelp {
				t.Errorf("line %d: TYPE %s without a HELP just before it", i+1, f[2])
			}
			typed[f[2]] = f[3]
		default:
			m := sampleLine.FindStringSubmatch(line)
			if m == nil {
				t.Errorf("line %d: malformed sample %q", i+1, line)
				continue
			}
			name, labels := m[1]+m[3], m[2]+m[4]
			family := name
			if typ, ok := typed[family]; !ok || typ == "histogram" {
				for _, suffix := range []string{"_bucket", "_sum", "_count"} {
					family = strings.TrimSuffix(name, suffix)
					if typed[family] == "histogram" {
						break
					}
				}
			}
			if _, ok := typed[family]; !ok {
				t.Errorf("line %d: sample %s before its TYPE", i+1, name)
			}
			if strings.HasSuffix(name, "_total") && typed[family] != "counter" {
				t.Errorf("line %d: %s ends in _total but is a %s", i+1, name, typed[family])
			}
			for _, pair := range strings.Split(strings.Trim(labels, "{}"), ",") {
				if labels == "" {
					break
				}
				if !labelPair.MatchString(pair) {
					t.Errorf("line %d: label %q is not quoted", i+1, pair)
				}
				if pair == `le="+Inf"` {
					sawInf = true
				}
			}
		}
	}
	if !sawInf {
		t.Error("histogram has no +Inf bucket")
	}
}

func TestMetricName(t *testing.T) {
	cases := map[string]string{
		"connections":       "stoop_connections",
		"stoop_connections": "stoop_connections",
		"voice.rooms-open":  "stoop_voice_rooms_open",
	}
	for in, want := range cases {
		if got := metricName(in); got != want {
			t.Errorf("metricName(%q) = %q, want %q", in, got, want)
		}
	}
}
