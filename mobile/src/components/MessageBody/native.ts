import { clusters, splitEmoji } from "@stoop/core/emojiText";
import { type MentionRef, mentionText, splitEveryone } from "@stoop/core/mentions";
import type { RichDoc, RichRun } from "../../../modules/stoop-rich-text";
import type { Theme } from "../../theme";
// Straight from the generated values, not the theme's index, so this
// file needs no React Native and its tests run in Node.
import { markdown, tokens } from "../../theme/generated";
import type { ChannelLinks } from "./channelLinks";
import { anyCovered, coveredIn, linePath, mentionWords, type Node, nodePath, type Parsed, spoken } from "./lines";

// A message as the styled runs our TextKit view draws (NativeBody,
// modules/stoop-rich-text), from the same parser tree and by the same
// rules as ReactNativeBody (index.tsx): the view gets the marks resolved,
// never Markdown.

// Words under a spoiler's cover, as ReactNativeBody covers them: each
// emoji an em space, since emoji draw through the cover's clear text.
const EM_SPACE = "\u2003";
const coverText = (text: string) =>
  splitEmoji(text)
    .map((run) => (run.emoji ? EM_SPACE.repeat(clusters(run.text).length) : run.text))
    .join("");

type Context = {
  covered: boolean;
  inLink: boolean;
  underline: boolean;
  strike: boolean;
  bold: boolean;
  italic: boolean;
  link?: { id: number; url: string; hidden: boolean };
  spoiler?: { id: number; covered: boolean };
};

export type BuildInput = {
  parsed: Parsed;
  theme: Theme;
  myUserId: string;
  mentionsEntireChannel: boolean;
  mentionsHere: boolean;
  links: ChannelLinks | null;
  compact: boolean;
  edited: boolean;
  fontScale: number;
  isCovered: (path: string) => boolean;
  cover: string;
};

// The doc, and each spoiler's path by its id, for a reveal.
export function buildDoc(input: BuildInput): { doc: RichDoc; spoilers: string[] } {
  const { parsed, theme, myUserId, links, compact, isCovered, fontScale } = input;
  const body = tokens.textBody * fontScale;
  const size = parsed.emojiOnly ? body * markdown.emojiOnlyScale : body;
  const lineHeight = parsed.emojiOnly ? size * tokens.leadingTight : body * tokens.leadingBody;
  const runs: RichRun[] = [];
  const spoilers: string[] = [];
  let nextLink = 0;
  let nextFill = 0;

  const push = (text: string, context: Context, extra: Partial<RichRun> = {}) => {
    if (text === "") return;
    runs.push({
      text,
      size,
      weight: context.bold ? 700 : 400,
      italic: context.italic || undefined,
      underline: context.underline || undefined,
      strike: context.strike || undefined,
      color: context.link ? theme[markdown.linkColor] : undefined,
      link: context.link?.url,
      linkId: context.link?.id,
      linkHidden: context.link?.hidden || undefined,
      spoiler: context.spoiler?.id,
      covered: context.spoiler?.covered || undefined,
      spoilerFill: context.spoiler ? theme[markdown.spoilerBg] : undefined,
      ...extra,
    });
  };

  const pill = (text: string, context: Context, me: boolean, link?: { id: number; url: string }) =>
    push(text, context, {
      weight: markdown.mentionWeight,
      color: theme[me ? markdown.mentionMeColor : markdown.mentionColor],
      fill: theme[me ? markdown.mentionMeBg : markdown.mentionBg],
      fillId: nextFill++,
      fillPad: markdown.mentionPadX,
      ...(link ? { link: link.url, linkId: link.id, linkHidden: undefined } : {}),
    });

  const mention = (ref: MentionRef, context: Context) => {
    if (ref.kind === "channel") {
      const channel = links?.channels.get(ref.id);
      if (!channel) return push(mentionText(ref), context);
      const tappable = !!links && !compact && !context.inLink;
      return pill(`#${channel.name}`, context, false, tappable ? { id: nextLink++, url: `channel:${ref.id}` } : undefined);
    }
    pill(mentionText(ref), context, ref.kind === "person" && ref.id === myUserId);
  };

  const draw = (nodes: Node[], parent: string, context: Context) => {
    nodes.forEach((node, index) => {
      const at = nodePath(parent, index);
      switch (node.type) {
        case "literal":
          return push(node.text, context);
        case "text":
          if (context.covered) return push(coverText(node.text), context);
          for (const part of splitEveryone(node.text, input.mentionsEntireChannel, input.mentionsHere)) {
            if (part.everyone) pill(part.text, context, true);
            else push(part.text, context);
          }
          return;
        case "code":
          if (context.covered) return push(coverText(node.text), context);
          return push(node.text, context, {
            mono: true,
            size: size * markdown.codeScale,
            fill: theme[markdown.codeBg],
            fillId: nextFill++,
            fillPad: markdown.codePadX,
          });
        case "mention":
          if (context.covered) return push(coverText(mentionText(node.mention)), context);
          return mention(node.mention, context);
        case "link": {
          if (context.covered) {
            if (node.label) return draw(node.label, at, context);
            return push(coverText(node.href), context);
          }
          const hides = !!node.label && coveredIn(node.label, at, isCovered);
          const inner: Context = {
            ...context,
            inLink: true,
            underline: true,
            link: compact ? undefined : { id: nextLink++, url: node.href, hidden: hides },
          };
          if (node.label) draw(node.label, at, inner);
          else push(node.href, inner);
          return;
        }
        case "bold":
          return draw(node.children, at, { ...context, bold: true });
        case "italic":
          return draw(node.children, at, { ...context, italic: true });
        case "underline":
          return draw(node.children, at, { ...context, underline: true });
        case "strike":
          return draw(node.children, at, { ...context, strike: true });
        case "spoiler": {
          const covered = context.covered || isCovered(at);
          const id = spoilers.length;
          spoilers.push(at);
          // Under a cover, nothing is a link. A spoiler inside a covered
          // one is part of its cover: its words carry the outer id, so a
          // tap on them reveals what covers them.
          return draw(node.children, at, {
            ...context,
            covered,
            link: covered ? undefined : context.link,
            spoiler: context.spoiler?.covered ? context.spoiler : { id, covered },
          });
        }
        default:
          return;
      }
    });
  };

  const top: Context = { covered: false, inLink: false, underline: false, strike: false, bold: false, italic: false };
  parsed.lines.forEach((line, index) => {
    if (index > 0) push("\n", top);
    draw(line, linePath(index), top);
  });
  if (input.edited) {
    runs.push({ text: " (edited)", size: tokens.textSm * fontScale, color: theme.textMuted });
  }

  const label = anyCovered(parsed.lines, isCovered)
    ? `${spoken(parsed.lines, isCovered, input.cover, (ref) => mentionWords(ref, links?.channels))}${input.edited ? " (edited)" : ""}`
    : runs.map((run) => run.text).join("");

  return {
    doc: {
      runs,
      lineHeight,
      bodySize: size,
      textColor: theme.text,
      spoilerPad: markdown.spoilerPadX,
      radius: tokens.radiusSm,
      label,
    },
    spoilers,
  };
}
