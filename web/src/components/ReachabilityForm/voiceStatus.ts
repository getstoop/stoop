import type { GetReachabilityResponse } from "../../gen/stoop/instance/v1/instance_pb";

// voiceStatus reports what the saved settings actually mean for voice,
// rather than what anyone said they were setting up. LiveKit's media
// ports are what a browser needs to reach; a relay stands in when it
// can't, and the tailnet is a route when the built-in node carries those
// ports itself, or when the Tailscale app is on this machine.
export function voiceStatus(r: GetReachabilityResponse | undefined): string {
  if (!r) return "";
  if (!r.voiceConfigured) {
    return "Voice isn't configured on this server (no LiveKit), so none of the relay settings apply yet.";
  }
  const hasRelay =
    !!r.reachability?.cloudflare?.hasApiToken ||
    (r.reachability?.turn?.urls.length ?? 0) > 0;
  if (hasRelay) {
    return "Voice works from anywhere; a relay is configured, so browsers that can't reach the media ports go through it.";
  }
  if (r.tailscale?.state === "running" && r.tailscale.carriesVoice) {
    return "Voice works for tailnet devices: this node carries LiveKit's media ports, so audio and video ride the tailnet.";
  }
  if (r.tailscale?.state === "running" && r.hostTailscale) {
    return "Voice works for tailnet devices; audio rides the tailnet, because the Tailscale app is on this machine too.";
  }
  if (r.tailscale?.state === "running") {
    return "Voice is silent for tailnet devices: this node isn't carrying LiveKit's media ports. Turn that back on (STOOP_TAILSCALE_VOICE), install the Tailscale app on this machine, or set a relay above.";
  }
  return "Voice is direct only. Browsers must reach LiveKit's media ports themselves (7881/tcp and 50000–50100/udp forwarded to this machine). Behind a tunnel, add a relay above.";
}
