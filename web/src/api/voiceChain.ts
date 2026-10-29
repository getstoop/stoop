// The Web Audio nodes every remote voice plays through, in order: the
// "even out voices" compressor when its switch is on, then our gain
// node (the slider's volume, or 0 while deafened), then a compressor
// set as a limiter. LiveKit wires them between the track's source and
// its own gain node (RemoteAudioTrack.setWebAudioPlugins: source →
// plugins → gain → destination), so the limiter is the last thing of
// ours a voice passes before the speakers. docs/architecture/voice.md →
// Voice volume.
//
// Why a gain node of ours and not LiveKit's: the limiter has to come
// *after* the volume, since it is the boost that pushes a shout past
// full scale, and nothing can follow LiveKit's gain node. So the volume
// becomes a node in the plugin list and LiveKit's gain is left at 1.
//
// Why the evener is first: it evens the voice as sent, and the slider
// scales the result. Off, it is not in the list at all, so the call
// sounds exactly as it does without the switch; a chain is rebuilt when
// the switch flips (api/voice.ts).
//
// Nothing here touches a real AudioContext directly; the nodes come from
// whatever is passed in, so the construction is testable with a stub.

// The slice of a BaseAudioContext the chain needs.
export interface ChainContext {
  createGain(): GainNode;
  createDynamicsCompressor(): DynamicsCompressorNode;
}

export interface ChainOptions {
  // Whether the evener leads the chain (the "Even out voices" switch).
  evenOut: boolean;
}

export interface VoiceChain {
  // In playing order, as setWebAudioPlugins wants them, unconnected: the
  // SDK links them when the track attaches.
  nodes: AudioNode[];
  // The evener, or null when the switch is off: absent, not muted.
  compressor: DynamicsCompressorNode | null;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
}

// How voices are evened. A low threshold so most of a voice is over it,
// a moderate ratio that brings a shout down without flattening it, a
// wide knee so the change is gradual, and an attack and release at
// speech's own pace: fast enough to catch a syllable, slow enough not
// to pump between words. The Web Audio spec gives every
// DynamicsCompressorNode a fixed make-up gain, and with these settings
// (full scale lands inside the knee, about 7 dB down) it is about +4 dB.
// That lift is the point of the switch, not an
// accident to undo: quiet talkers come up by it and loud ones only by
// what the ratio leaves, so it is not compensated anywhere. It is also
// why the popover warns that louder volumes may distort: a lifted
// shout at 300% lands on the limiter harder, and the limiter is what
// keeps that from clipping.
export const EVEN_OUT = {
  threshold: -24,
  ratio: 4,
  knee: 30,
  attack: 0.003,
  release: 0.25,
} as const;

// Where the limiter bites. It does nothing until a peak is within about
// a decibel of full scale, so at normal volume it is inaudible: a
// threshold a little under full scale leaves headroom, a steep ratio
// holds anything over it flat, no knee so it starts exactly there, and
// a fast attack with a short release catches a single loud syllable
// without pumping the ones after. The proposal's open question 3: if
// the top of the slider sounds squashed, the fix is less gain before
// it, not a higher threshold.
export const LIMITER = {
  threshold: -3,
  ratio: 20,
  knee: 0,
  attack: 0.001,
  release: 0.05,
} as const;

// What the limiter adds on its own. The Web Audio spec gives every
// DynamicsCompressorNode a fixed make-up gain of (1 / curve(1.0)) ^ 0.6,
// where curve(1.0) is the level full scale comes out at: with no knee
// that is threshold + (0 - threshold) / ratio, here -2.85 dB, so the
// node lifts everything by about 1.7 dB whatever the volume. Our gain
// node takes exactly that back out, so at 100% a voice is as sent and
// the limiter is unity until it bites. Derived from the settings above
// so the two can never drift apart. Only the limiter's: the evener's
// make-up is left in, as said above.
const CURVE_AT_FULL_SCALE_DB =
  LIMITER.threshold + (0 - LIMITER.threshold) / LIMITER.ratio;
export const MAKEUP = (1 / 10 ** (CURVE_AT_FULL_SCALE_DB / 20)) ** 0.6;

// How quickly the gain moves to a new value: a time constant in seconds,
// so a step of the slider lands in a few milliseconds without the click
// an instant jump makes, and deafen is silence before it can be heard.
export const GAIN_RAMP_S = 0.005;

type CompressorSettings = typeof EVEN_OUT | typeof LIMITER;

function compressorWith(
  ctx: ChainContext,
  settings: CompressorSettings,
): DynamicsCompressorNode {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = settings.threshold;
  node.ratio.value = settings.ratio;
  node.knee.value = settings.knee;
  node.attack.value = settings.attack;
  node.release.value = settings.release;
  return node;
}

export function buildVoiceChain(
  ctx: ChainContext,
  gain: number,
  { evenOut }: ChainOptions,
): VoiceChain {
  const compressor = evenOut ? compressorWith(ctx, EVEN_OUT) : null;
  const g = ctx.createGain();
  g.gain.value = gain / MAKEUP;
  const limiter = compressorWith(ctx, LIMITER);
  const nodes: AudioNode[] = compressor
    ? [compressor, g, limiter]
    : [g, limiter];
  return { nodes, compressor, gain: g, limiter };
}

export function setChainGain(chain: VoiceChain, gain: number) {
  chain.gain.gain.setTargetAtTime(
    gain / MAKEUP,
    chain.gain.context.currentTime,
    GAIN_RAMP_S,
  );
}

// Drop the edge from our last node to whatever LiveKit connected it to.
// Every time LiveKit rewires a track (its startAudio does, for every
// track, on the "Enable audio" click and whenever it opens a mic or a
// shared screen's audio of its own) it disconnects only its source and
// gain node, makes a new gain node and connects our tail to that: the
// edge to the old one would stay, a dead-end node per track per rewire.
// So after each of those (a microtask later, which follows LiveKit's
// synchronous rewiring whichever listener was registered first),
// api/voice.ts unlinks the tail and has LiveKit connect the chain again,
// which remakes every edge from a clean slate.
export function unlinkVoiceChain(chain: VoiceChain) {
  chain.nodes[chain.nodes.length - 1]?.disconnect();
}

// Undo the links LiveKit made. Its own disconnect drops the source and
// its gain node; what we put between them it leaves connected to each
// other, and to its gain node, until we let go.
export function disconnectVoiceChain(chain: VoiceChain) {
  for (const node of chain.nodes) node.disconnect();
}
