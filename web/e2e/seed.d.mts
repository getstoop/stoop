// Types for seed.mjs, which is plain JavaScript because both suites import
// it — the puppeteer specs are .mjs and cannot carry types of their own.
//
// The generics are the point. `seed({ users: ["ada", "bea"] })` gives back
// `tokens.ada` and `tokens.bea` and nothing else, so a typo is a compile
// error rather than an `undefined` token that fails later as a confusing
// 401. Same for channels.

export const BASE: string;
export const SESSION_COOKIE: string;

export interface SeededSpace {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface SeededInvite {
  code: string;
  url: string;
}

export interface SeedOptions<
  U extends readonly string[],
  C extends readonly string[],
  I extends boolean,
> {
  users?: U;
  space?: string;
  channels?: C;
  password?: string;
  // Who joins the space. Omitted means everyone; naming a subset leaves the
  // rest registered but outside it.
  members?: readonly U[number][] | null;
  invite?: I;
}

export interface Seeded<
  U extends readonly string[],
  C extends readonly string[],
  I extends boolean,
> {
  // Keeps usernames unique across runs; specs match on `ada${suffix}`.
  suffix: string;
  tokens: Record<U[number], string>;
  ids: Record<U[number], string>;
  space: SeededSpace;
  channels: Record<C[number], string>;
  password: string;
  // Only minted when asked for, so a spec that asked gets it without a
  // null check and a spec that did not cannot reach for one.
  invite: I extends true ? SeededInvite : null;
}

export function seed<
  const U extends readonly string[] = ["ada", "bea"],
  const C extends readonly string[] = ["general", "random"],
  const I extends boolean = false,
>(options?: SeedOptions<U, C, I>): Promise<Seeded<U, C, I>>;

export function joinSpace(token: string, code: string): Promise<unknown>;
