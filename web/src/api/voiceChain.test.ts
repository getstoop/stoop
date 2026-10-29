import { describe, expect, it } from "vitest";
import {
  buildVoiceChain,
  type ChainContext,
  disconnectVoiceChain,
  EVEN_OUT,
  GAIN_RAMP_S,
  LIMITER,
  MAKEUP,
  setChainGain,
  unlinkVoiceChain,
} from "./voiceChain";

// There is no Web Audio under vitest, so a context stands in: nodes that
// are only their parameters, a clock, and a record of what was
// disconnected. What the chain is made of, in which order, and how the
// gain follows the volume are all decidable from that; what it sounds
// like is listened to on the dev server.

interface Param {
  value: number;
  targets: { target: number; at: number; tc: number }[];
  setTargetAtTime(target: number, at: number, tc: number): void;
}

const param = (value = 0): Param => ({
  value,
  targets: [],
  setTargetAtTime(target, at, tc) {
    this.targets.push({ target, at, tc });
  },
});

function stubContext() {
  const ctx = { currentTime: 1.5, disconnected: [] as string[] };
  let made = 0;
  // Each node is numbered in the order it was made, so a record of what
  // was disconnected tells the two compressors apart.
  const node = (kind: string, params: Record<string, Param>) => {
    const name = `${kind}${made++}`;
    return {
      kind,
      name,
      context: ctx,
      disconnect: () => ctx.disconnected.push(name),
      ...params,
    };
  };
  const chainCtx = {
    createGain: () => node("gain", { gain: param(1) }),
    // The browser's own defaults, which are the evener's settings but
    // for the ratio: a chain must set every value itself.
    createDynamicsCompressor: () =>
      node("compressor", {
        threshold: param(-24),
        ratio: param(12),
        knee: param(30),
        attack: param(0.003),
        release: param(0.25),
      }),
  } as unknown as ChainContext;
  return { ctx, chainCtx };
}

const kinds = (nodes: AudioNode[]) =>
  nodes.map((n) => (n as unknown as { kind: string }).kind);

const settings = (node: DynamicsCompressorNode) => ({
  threshold: node.threshold.value,
  ratio: node.ratio.value,
  knee: node.knee.value,
  attack: node.attack.value,
  release: node.release.value,
});

const off = { evenOut: false };
const on = { evenOut: true };

describe("buildVoiceChain", () => {
  it("is a gain node then a limiter, in that order, with the switch off", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, off);
    expect(kinds(chain.nodes)).toEqual(["gain", "compressor"]);
    expect(chain.nodes[0]).toBe(chain.gain);
    expect(chain.nodes[1]).toBe(chain.limiter);
    // Absent, not muted: nothing of the evener is made at all.
    expect(chain.compressor).toBeNull();
  });

  it("leads with the evener when the switch is on", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, on);
    expect(kinds(chain.nodes)).toEqual(["compressor", "gain", "compressor"]);
    expect(chain.nodes[0]).toBe(chain.compressor);
    expect(chain.nodes[1]).toBe(chain.gain);
    expect(chain.nodes[2]).toBe(chain.limiter);
  });

  it("sets the evener as the proposal has it, and the limiter as before", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, on);
    if (!chain.compressor) throw new Error("no evener");
    expect(settings(chain.compressor)).toEqual(EVEN_OUT);
    expect(settings(chain.limiter)).toEqual(LIMITER);
    // Evens rather than limits: well under full scale, a moderate
    // ratio, a wide knee, and release at speech's pace.
    expect(EVEN_OUT.threshold).toBeLessThanOrEqual(-18);
    expect(EVEN_OUT.ratio).toBeGreaterThanOrEqual(2);
    expect(EVEN_OUT.ratio).toBeLessThanOrEqual(6);
    expect(EVEN_OUT.knee).toBeGreaterThan(0);
    expect(EVEN_OUT.release).toBeGreaterThan(LIMITER.release);
  });

  it("is unity at normal volume: our gain undoes the limiter's make-up", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, off);
    expect(chain.gain.gain.value * MAKEUP).toBeCloseTo(1, 6);
    expect(buildVoiceChain(chainCtx, 0, off).gain.gain.value).toBe(0);
    expect(
      buildVoiceChain(chainCtx, 3, off).gain.gain.value * MAKEUP,
    ).toBeCloseTo(3, 6);
  });

  it("leaves the evener's own make-up in: that lift is what the switch is for", () => {
    const { chainCtx } = stubContext();
    const withIt = buildVoiceChain(chainCtx, 1, on);
    const without = buildVoiceChain(chainCtx, 1, off);
    expect(withIt.gain.gain.value).toBe(without.gain.gain.value);
  });

  it("derives the make-up from the limiter's settings", () => {
    // The spec's rule, worked again here from the constants: full scale
    // comes out at threshold + (0 - threshold) / ratio, and the node
    // lifts by (1 / that, linear) ^ 0.6.
    const fullScaleDb = LIMITER.threshold * (1 - 1 / LIMITER.ratio);
    expect(MAKEUP).toBeCloseTo((1 / 10 ** (fullScaleDb / 20)) ** 0.6, 10);
    // About +1.7 dB with the settings as they stand.
    expect(MAKEUP).toBeGreaterThan(1.2);
    expect(MAKEUP).toBeLessThan(1.25);
  });

  it("is a limiter, not an evener", () => {
    const { chainCtx } = stubContext();
    const { limiter } = buildVoiceChain(chainCtx, 1, off);
    // Bites just under full scale, holds anything over it flat, starts
    // exactly there, and catches one syllable without pumping the next.
    expect(limiter.threshold.value).toBeLessThanOrEqual(0);
    expect(limiter.threshold.value).toBeGreaterThan(-6);
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(10);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.attack.value).toBeLessThanOrEqual(0.005);
    expect(limiter.release.value).toBeLessThanOrEqual(0.1);
  });
});

describe("setChainGain", () => {
  it("moves the gain to the volume, now, over a short ramp", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, off);
    setChainGain(chain, 3);
    const p = chain.gain.gain as unknown as Param;
    expect(p.targets).toEqual([
      { target: 3 / MAKEUP, at: ctx.currentTime, tc: GAIN_RAMP_S },
    ]);
    expect(GAIN_RAMP_S).toBeLessThanOrEqual(0.02);
  });

  it("is how deafen silences a voice, and undeafen brings it back", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1.5, off);
    setChainGain(chain, 0);
    setChainGain(chain, 1.5);
    const p = chain.gain.gain as unknown as Param;
    expect(p.targets.map((t) => t.target)).toEqual([0, 1.5 / MAKEUP]);
    // The limiter is not touched by any of it.
    expect((chain.limiter.threshold as unknown as Param).targets).toEqual([]);
  });

  it("drives the same node whether or not the evener leads", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, on);
    setChainGain(chain, 2);
    expect((chain.gain.gain as unknown as Param).targets).toHaveLength(1);
    if (!chain.compressor) throw new Error("no evener");
    expect((chain.compressor.threshold as unknown as Param).targets).toEqual(
      [],
    );
  });
});

describe("disconnectVoiceChain", () => {
  it("disconnects every node of ours", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, off);
    disconnectVoiceChain(chain);
    expect(ctx.disconnected).toEqual(["gain0", "compressor1"]);
  });

  it("the evener included", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, on);
    disconnectVoiceChain(chain);
    expect(ctx.disconnected).toEqual(["compressor0", "gain1", "compressor2"]);
  });
});

describe("unlinkVoiceChain", () => {
  it("lets go of only the tail, the edge LiveKit's rewiring leaves behind", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1, off);
    unlinkVoiceChain(chain);
    expect(ctx.disconnected).toEqual(["compressor1"]);
  });
});

// Flipping the switch mid-call is a rebuild (api/voice.ts): the old
// chain is let go of whole, a new one is built at the volume of the
// moment, and LiveKit is handed the new nodes. Modelled here with the
// same calls, so the record says what is connected afterwards.
describe("toggling", () => {
  it("leaves exactly the new chain, at the gain the old one had", () => {
    const { ctx, chainCtx } = stubContext();
    const before = buildVoiceChain(chainCtx, 2.5, off);
    disconnectVoiceChain(before);
    const after = buildVoiceChain(chainCtx, 2.5, on);
    // Everything of the old chain was dropped, nothing of the new one.
    expect(ctx.disconnected).toEqual(["gain0", "compressor1"]);
    expect(kinds(after.nodes)).toEqual(["compressor", "gain", "compressor"]);
    expect(after.gain.gain.value).toBe(before.gain.gain.value);
    expect(after.gain).not.toBe(before.gain);
  });

  it("and back off, deafened, is a gain node at zero then the limiter", () => {
    const { ctx, chainCtx } = stubContext();
    const before = buildVoiceChain(chainCtx, 1, on);
    disconnectVoiceChain(before);
    const after = buildVoiceChain(chainCtx, 0, off);
    expect(ctx.disconnected).toEqual(["compressor0", "gain1", "compressor2"]);
    expect(kinds(after.nodes)).toEqual(["gain", "compressor"]);
    expect(after.compressor).toBeNull();
    expect(after.gain.gain.value).toBe(0);
  });
});
