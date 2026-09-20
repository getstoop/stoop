// The tab's two clocks, how long the server has been up and how long ago
// something was read, and the Requests panel's durations.

export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Microseconds as "0.4 ms", "6 ms", "48 ms", "1.2 s", "12 s".
export function formatDuration(us: number): string {
  const ms = Math.max(0, us) / 1000;
  if (ms < 10) return `${trim(ms)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${trim(s)} s`;
  return `${Math.round(s)} s`;
}

// One decimal, dropped when it is zero: "6", not "6.0".
function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}
