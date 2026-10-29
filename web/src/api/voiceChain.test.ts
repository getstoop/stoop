import { describe, expect, it } from "vitest";
import {
  buildVoiceChain,
  type ChainContext,
  disconnectVoiceChain,
  GAIN_RAMP_S,
  LIMITER,
  setChainGain,
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

  it("starts at the gain it is given", () => {
    const { chainCtx } = stubContext();
    expect(buildVoiceChain(chainCtx, 2.4).gain.gain.value).toBe(2.4);
    expect(buildVoiceChain(chainCtx, 0).gain.gain.value).toBe(0);
  });

  it("sets the compressor up as a limiter", () => {
    const { chainCtx } = stubContext();
    const { limiter } = buildVoiceChain(chainCtx, 1);
    expect(limiter.threshold.value).toBe(LIMITER.threshold);
    expect(limiter.ratio.value).toBe(LIMITER.ratio);
    expect(limiter.knee.value).toBe(LIMITER.knee);
    expect(limiter.attack.value).toBe(LIMITER.attack);
    expect(limiter.release.value).toBe(LIMITER.release);
    // A limiter, not an evener: it bites just under full scale and
    // holds anything over it flat.
    expect(LIMITER.threshold).toBeLessThan(0);
    expect(LIMITER.threshold).toBeGreaterThanOrEqual(-6);
    expect(LIMITER.ratio).toBeGreaterThanOrEqual(10);
    expect(LIMITER.knee).toBe(0);
  });
});

describe("setChainGain", () => {
  it("moves the gain to the volume, now, over a short ramp", () => {
    const { ctx, chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1);
    setChainGain(chain, 3);
    const p = chain.gain.gain as unknown as Param;
    expect(p.targets).toEqual([
      { target: 3, at: ctx.currentTime, tc: GAIN_RAMP_S },
    ]);
    expect(GAIN_RAMP_S).toBeLessThanOrEqual(0.02);
  });

  it("is how deafen silences a voice, and undeafen brings it back", () => {
    const { chainCtx } = stubContext();
    const chain = buildVoiceChain(chainCtx, 1.5);
    setChainGain(chain, 0);
    setChainGain(chain, 1.5);
    const p = chain.gain.gain as unknown as Param;
    expect(p.targets.map((t) => t.target)).toEqual([0, 1.5]);
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
