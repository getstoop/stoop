import { describe, expect, it } from "vitest";
import {
  buildVoiceChain,
  type ChainContext,
  disconnectVoiceChain,
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
  const node = (kind: string, params: Record<string, Param>) => ({
    kind,
    context: ctx,
    disconnect: () => ctx.disconnected.push(kind),
    ...params,
  });
  const chainCtx = {
    createGain: () => node("gain", { gain: param(1) }),
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

describe("buildVoiceChain", () => {
  it("is a gain node then a limiter, in that order", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1);
    expect(kinds(chain.nodes)).toEqual(["gain", "compressor"]);
    expect(chain.nodes[0]).toBe(chain.gain);
    expect(chain.nodes[1]).toBe(chain.limiter);
  });

  it("is unity at normal volume: our gain undoes the limiter's make-up", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1);
    expect(chain.gain.gain.value * MAKEUP).toBeCloseTo(1, 6);
    expect(buildVoiceChain(chainCtx, 0).gain.gain.value).toBe(0);
    expect(buildVoiceChain(chainCtx, 3).gain.gain.value * MAKEUP).toBeCloseTo(
      3,
      6,
    );
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
    const { limiter } = buildVoiceChain(chainCtx, 1);
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
    const chain = buildVoiceChain(chainCtx, 1);
    setChainGain(chain, 3);
    const p = chain.gain.gain as unknown as Param;
    expect(p.targets).toEqual([
      { target: 3 / MAKEUP, at: ctx.currentTime, tc: GAIN_RAMP_S },
    ]);
    expect(GAIN_RAMP_S).toBeLessThanOrEqual(0.02);
  });

  it("is how deafen silences a voice, and undeafen brings it back", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1.5);
    setChainGain(chain, 0);
    setChainGain(chain, 1.5);
    const p = chain.gain.gain as unknown as Param;
    expect(p.targets.map((t) => t.target)).toEqual([0, 1.5 / MAKEUP]);
    // The limiter is not touched by any of it.
    expect((chain.limiter.threshold as unknown as Param).targets).toEqual([]);
  });
});

describe("disconnectVoiceChain", () => {
  it("disconnects every node of ours", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1);
    disconnectVoiceChain(chain);
    expect(ctx.disconnected).toEqual(["gain", "compressor"]);
  });
});

describe("unlinkVoiceChain", () => {
  it("lets go of only the tail, the edge LiveKit's rewiring leaves behind", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1);
    unlinkVoiceChain(chain);
    expect(ctx.disconnected).toEqual(["compressor"]);
  });
});
