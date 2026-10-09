// The wizard's steps, in order. Adding a step is one entry here plus its
// screen in index.tsx; the indicator, Back, and resume read this list.

export type StepId =
  | "account"
  | "space"
  | "remote"
  | "address"
  | "voice"
  | "invite";

// What the server knows that decides which steps apply.
export type StepContext = { voiceAvailable: boolean };

export type Step = {
  id: StepId;
  title: string;
  // Can be left for later; it is all in Server admin.
  optional?: boolean;
  // Creates something, so there is no going back to it.
  once?: boolean;
  // Left out when this says so.
  shown?: (ctx: StepContext) => boolean;
};

export const STEPS: readonly Step[] = [
  { id: "account", title: "Your account", once: true },
  { id: "space", title: "Your space", once: true },
  { id: "remote", title: "Remote access", optional: true },
  { id: "address", title: "Address" },
  {
    id: "voice",
    title: "Voice and video",
    optional: true,
    shown: (ctx) => ctx.voiceAvailable,
  },
  { id: "invite", title: "Invite people" },
];

export function visibleSteps(ctx: StepContext): readonly Step[] {
  return STEPS.filter((s) => s.shown?.(ctx) ?? true);
}

// How people will come in, picked on the remote access step. The later
// steps fill themselves in from it.
export type Access = "home" | "proxy" | "tunnel" | "tailscale";

export type StepState = "done" | "skipped";

export type Progress = {
  steps: Partial<Record<StepId, StepState>>;
  space?: { id: string; channelId: string; name: string };
  access?: Access;
  // The invite code the last step minted, so it mints only once.
  invite?: string;
};

export const NO_PROGRESS: Progress = { steps: {} };

// The first step not yet done or skipped; the last one when all are.
export function nextStep(steps: readonly Step[], progress: Progress): Step {
  return (
    steps.find((s) => progress.steps[s.id] === undefined) ??
    steps[steps.length - 1]
  );
}

// Where Back goes from a step: the one before it, unless that one
// created something.
export function previousStep(
  steps: readonly Step[],
  id: StepId,
): Step | undefined {
  const i = steps.findIndex((s) => s.id === id);
  const prev = i > 0 ? steps[i - 1] : undefined;
  return prev && !prev.once ? prev : undefined;
}
