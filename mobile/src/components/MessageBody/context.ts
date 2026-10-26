import type { BodyPlace } from "./insets";
import type { Line } from "./lines";

export const COVER = "spoiler, double tap to reveal";

// What every paragraph of one message shares: whose it is, how it was
// sent, where it is drawn, and its spoilers revealed (by path, across
// all its blocks) with how to reveal one.
export type BodyContext = {
  myUserId: string;
  mentionsEntireChannel: boolean;
  mentionsHere: boolean;
  // The message menu's card: taps nothing, reveals nothing.
  compact: boolean;
  place: BodyPlace;
  onLongPress?: () => void;
  shown: ReadonlySet<string>;
  reveal: (path: string) => void;
};

// One paragraph: a lines block, a quote's words or a list row's.
export type ParagraphProps = {
  lines: Line[];
  // How much narrower than the message's words it is (blocks.ts).
  indent: number;
  emojiOnly?: boolean;
  // A quote's words, in the quote's colour.
  muted?: boolean;
  // Read before the words (a list row's marker).
  prefix?: string;
  // Ends with "(edited)": the message's last words.
  edited?: boolean;
  body: BodyContext;
};
