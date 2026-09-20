package diag

import (
	"bytes"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// WriteText writes s in the Prometheus text exposition format (0.0.4).
// Every name is prefixed "stoop_"; counters end in "_total".
func WriteText(w io.Writer, s Snapshot) error {
	b := &text{}
	for _, c := range s.Counters {
		name := metricName(c.Name)
		if !strings.HasSuffix(name, "_total") {
			name += "_total"
		}
		family(b, name, c.Help, "counter")
		b.printf("%s %d\n", name, c.Value)
	}
	for _, g := range s.Gauges {
		name := metricName(g.Name)
		family(b, name, g.Help, "gauge")
		b.printf("%s %s\n", name, float(g.Value))
	}
	if len(s.Procedures) > 0 {
		writeProcedures(b, s.Procedures)
	}
	if len(s.Jobs) > 0 {
		writeJobs(b, s.Jobs)
	}
	_, err := w.Write(b.Bytes())
	return err
}

// text buffers the exposition; a buffer write cannot fail.
type text struct{ bytes.Buffer }

func (t *text) printf(format string, args ...any) { _, _ = fmt.Fprintf(t, format, args...) }

func writeProcedures(b *text, procs []ProcedureStats) {
	family(b, "stoop_rpc_calls_total", "Unary RPC calls since start.", "counter")
	for _, p := range procs {
		b.printf("stoop_rpc_calls_total{procedure=%s} %d\n", label(p.Procedure), p.Calls)
	}
	family(b, "stoop_rpc_errors_total", "Unary RPC calls that failed, Canceled excluded.", "counter")
	for _, p := range procs {
		b.printf("stoop_rpc_errors_total{procedure=%s} %d\n", label(p.Procedure), p.Errors)
	}
	family(b, "stoop_rpc_duration_seconds", "Unary RPC duration.", "histogram")
	for _, p := range procs {
		proc := label(p.Procedure)
		for _, bk := range p.Buckets {
			le := "+Inf"
			if bk.Le != InfBucket {
				le = float(bk.Le.Seconds())
			}
			b.printf("stoop_rpc_duration_seconds_bucket{procedure=%s,le=%q} %d\n", proc, le, bk.Count)
		}
		b.printf("stoop_rpc_duration_seconds_sum{procedure=%s} %s\n", proc, float(p.Sum.Seconds()))
		b.printf("stoop_rpc_duration_seconds_count{procedure=%s} %d\n", proc, p.Calls)
	}
}

func writeJobs(b *text, jobs []JobRecord) {
	family(b, "stoop_job_last_success_timestamp_seconds", "When the job last succeeded; 0 if never.", "gauge")
	for _, j := range jobs {
		b.printf("stoop_job_last_success_timestamp_seconds{job=%s} %s\n", label(j.Name), unixSeconds(j.LastSuccess))
	}
	family(b, "stoop_job_last_duration_seconds", "How long the job's last pass took.", "gauge")
	for _, j := range jobs {
		b.printf("stoop_job_last_duration_seconds{job=%s} %s\n", label(j.Name), float(j.LastDuration.Seconds()))
	}
}

func family(b *text, name, help, typ string) {
	if help != "" {
		b.printf("# HELP %s %s\n", name, helpEscaper.Replace(help))
	}
	b.printf("# TYPE %s %s\n", name, typ)
}

// metricName prefixes stoop_ and replaces anything outside [a-zA-Z0-9_:].
func metricName(name string) string {
	var sb strings.Builder
	sb.WriteString("stoop_")
	for _, r := range strings.TrimPrefix(name, "stoop_") {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == ':':
			sb.WriteRune(r)
		default:
			sb.WriteByte('_')
		}
	}
	return sb.String()
}

// helpEscaper is the 0.0.4 HELP escaping; label values use strconv.Quote.
var helpEscaper = strings.NewReplacer(`\`, `\\`, "\n", `\n`)

func label(v string) string { return strconv.Quote(v) }

func float(v float64) string { return strconv.FormatFloat(v, 'g', -1, 64) }

func unixSeconds(t time.Time) string {
	if t.IsZero() {
		return "0"
	}
	return strconv.FormatFloat(float64(t.UnixMilli())/1000, 'f', 3, 64)
}
