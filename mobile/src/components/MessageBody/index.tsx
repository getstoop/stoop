import { clusters, splitEmoji } from "@stoop/core/emojiText";
import type { Inline } from "@stoop/core/markdown";
import { type MentionRef, mentionText, splitEveryone } from "@stoop/core/mentions";
import { Fragment, type ReactNode, useContext, useMemo, useState } from "react";
import { Linking, Text } from "react-native";
import { useTheme } from "../../theme";
import { ChannelLinksContext } from "./channelLinks";
import { anyCovered, linePath, nodePath, parse, spoken } from "./lines";
import Spoiler from "./Spoiler";
import { decoration, makeStyles } from "./styles";

const COVER = "spoiler, double tap to reveal";
const NO_PATHS: ReadonlySet<string> = new Set();
const EM_SPACE = "\u2003";

// Where a node is drawn: under a covered spoiler (plain words, nothing
// to tap or show through) and under which decorations.
type Context = { covered: boolean; underline: boolean; strike: boolean };
const TOP: Context = { covered: false, underline: false, strike: false };

// A message's words, drawn from web's parser (core/markdown) as web's
// MessageBody draws them: bold, italic, underline, strike, inline code,
// links that open in the browser, and spoilers covered until tapped,
// each staying revealed while the row is mounted. Mentions are pills,
// the reader's own filled, as are @channel and @here when the message
// carried them (core splitEveryone); a channel link opens the channel
// when the screen's ChannelLinks has it. A message of only emoji is
// drawn large. Quotes, lists and code blocks still read as their lines.
// An edited message says so after its words. A long press on anything
// tappable reaches the row's, since a touch there never reaches the
// row. `compact` (the message menu's card) taps nothing and reveals
// nothing.
export default function MessageBody({
  content,
  myUserId,
  edited,
  mentionsEntireChannel,
  mentionsHere,
  onLongPress,
  compact = false,
}: {
  content: string;
  myUserId: string;
  edited: boolean;
  mentionsEntireChannel: boolean;
  mentionsHere: boolean;
  onLongPress?: () => void;
  compact?: boolean;
}) {
  const styles = makeStyles(useTheme());
  const links = useContext(ChannelLinksContext);
  const parsed = useMemo(() => parse(content), [content]);
  // The spoilers revealed, by path, for this content: an edit starts over.
  const [revealed, setRevealed] = useState({ content, paths: NO_PATHS });
  const shown = revealed.content === content ? revealed.paths : NO_PATHS;
  const reveal = (path: string) =>
    setRevealed((before) => ({
      content,
      paths: new Set(before.content === content ? before.paths : []).add(path),
    }));
  const isCovered = (path: string) => compact || !shown.has(path);
  const hold = compact ? undefined : onLongPress;

  const words = (text: string, at: string, context: Context): ReactNode => {
    if (context.covered) {
      // Emoji draw in their own colours, through the cover's clear text,
      // so under it each is an em space instead.
      return splitEmoji(text)
        .map((run) => (run.emoji ? EM_SPACE.repeat(clusters(run.text).length) : run.text))
        .join("");
    }
    // Emoji among the words stay at the text's size: web's larger size
    // raises their line on iOS.
    return splitEveryone(text, mentionsEntireChannel, mentionsHere).map((part, index) =>
      part.everyone ? (
        <Text key={nodePath(at, index)} style={[styles.mention, styles.mentionMe]}>
          {part.text}
        </Text>
      ) : (
        <Fragment key={nodePath(at, index)}>{part.text}</Fragment>
      ),
    );
  };

  const mention = (ref: MentionRef, at: string): ReactNode => {
    const channel = ref.kind === "channel" ? links?.channels.get(ref.id) : undefined;
    if (channel && links && !compact) {
      return (
        <Text
          key={at}
          style={styles.mention}
          accessibilityRole="link"
          onPress={() => links.open(channel)}
          onLongPress={hold}
        >
          #{channel.name}
        </Text>
      );
    }
    const mine = ref.kind === "person" && ref.id === myUserId;
    return (
      <Text key={at} style={[styles.mention, mine && styles.mentionMe]}>
        {channel ? `#${channel.name}` : mentionText(ref)}
      </Text>
    );
  };

  const draw = (nodes: Inline[], parent: string, context: Context): ReactNode =>
    nodes.map((node, index) => {
      const at = nodePath(parent, index);
      switch (node.type) {
        case "text":
          return <Fragment key={at}>{words(node.text, at, context)}</Fragment>;
        case "code":
          return context.covered ? (
            <Fragment key={at}>{node.text}</Fragment>
          ) : (
            <Text key={at} style={styles.code}>
              {node.text}
            </Text>
          );
        case "mention":
          // The parser has a spoiler's tokens as words already.
          return context.covered ? <Fragment key={at}>{mentionText(node.mention)}</Fragment> : mention(node.mention, at);
        case "link": {
          if (context.covered) {
            return <Fragment key={at}>{node.label ? draw(node.label, at, context) : node.href}</Fragment>;
          }
          const inner = { ...context, underline: true };
          const href = node.href;
          return (
            <Text
              key={at}
              style={[styles.link, decoration(true, context.strike)]}
              accessibilityRole={compact ? undefined : "link"}
              onPress={compact ? undefined : () => Linking.openURL(href).catch(() => {})}
              onLongPress={hold}
            >
              {node.label ? draw(node.label, at, inner) : href}
            </Text>
          );
        }
        case "bold":
          return (
            <Text key={at} style={styles.bold}>
              {draw(node.children, at, context)}
            </Text>
          );
        case "italic":
          return (
            <Text key={at} style={styles.italic}>
              {draw(node.children, at, context)}
            </Text>
          );
        case "underline":
        case "strike": {
          const inner = {
            ...context,
            underline: context.underline || node.type === "underline",
            strike: context.strike || node.type === "strike",
          };
          return (
            <Text key={at} style={decoration(inner.underline, inner.strike)}>
              {draw(node.children, at, inner)}
            </Text>
          );
        }
        case "spoiler": {
          const covered = context.covered || isCovered(at);
          return (
            <Spoiler
              key={at}
              covered={covered}
              styles={styles}
              onReveal={compact || !covered ? undefined : () => reveal(at)}
              onLongPress={hold}
            >
              {draw(node.children, at, { ...context, covered })}
            </Spoiler>
          );
        }
        default:
          return null;
      }
    });

  const { lines, emojiOnly } = parsed;
  // Said in place of a covered spoiler's words; the words alone otherwise.
  const label = anyCovered(lines, isCovered)
    ? `${spoken(lines, isCovered, compact ? "spoiler" : COVER)}${edited ? " (edited)" : ""}`
    : undefined;

  return (
    <Text style={[styles.text, emojiOnly && styles.emojiOnly]} accessibilityLabel={label}>
      {lines.map((line, index) => (
        <Fragment key={linePath(index)}>
          {index > 0 && "\n"}
          {draw(line, linePath(index), TOP)}
        </Fragment>
      ))}
      {edited && <Text style={styles.edited}> (edited)</Text>}
    </Text>
  );
}
