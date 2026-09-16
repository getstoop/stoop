// A session's User-Agent as a person would name it: "Firefox on macOS",
// "Stoop desktop on Windows". Only the family is read, never the version.

const BROWSERS: [RegExp, string][] = [
  // Order matters: Edge and Opera also say Chrome, and Chrome says Safari.
  [/Stoop-Desktop\//, "Stoop desktop"],
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(ua: string): string {
  if (!ua.trim()) return "Unknown device";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser || system) return (browser ?? system) as string;
  // A script or an unfamiliar client: its own first word says most.
  return ua.split(/[\s/]/)[0] || "Unknown device";
}

export type SessionKind = "desktop" | "mobile" | "web" | "unknown";

// Which kind of client a session is, for the count on Profile → Security.
// The desktop app first: it says Chrome too.
export function sessionKind(ua: string): SessionKind {
  if (/Stoop-Desktop\//.test(ua)) return "desktop";
  if (/iPhone|iPad|iPod|Android/.test(ua)) return "mobile";
  if (BROWSERS.some(([re]) => re.test(ua))) return "web";
  return "unknown";
}
