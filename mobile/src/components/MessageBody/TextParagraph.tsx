import { clusters, splitEmoji } from "@stoop/core/emojiText";
import { type MentionRef, mentionText, splitEveryone } from "@stoop/core/mentions";
import { Fragment, type ReactNode, useContext, useMemo } from "react";
import { Linking, Text } from "react-native";
import { useTheme } from "../../theme";
import { ChannelLinksContext } from "./channelLinks";
import { COVER, type ParagraphProps } from "./context";
import { anyCovered, coveredIn, firstCovered, mentionWords, type Node, nodePath, spoken } from "./lines";
import Spoiler from "./Spoiler";
import { decoration, makeStyles } from "./styles";

const ACTIVATE = [{ name: "activate" }];
const EM_SPACE = "\u2003";

// Where a node is drawn: under a covered spoiler (plain words, nothing
// to tap or show through), inside a link's words (one control: nothing
// in them takes a tap of its own but a spoiler), and under which
// decorations.
type Context = { covered: boolean; inLink: boolean; underline: boolean; strike: boolean };
const TOP: Context = { covered: false, inLink: false, underline: false, strike: false };

// Words under a spoiler's cover. Emoji draw in their own colours, through
// the cover's clear text, so each is an em space there instead.
const coverText = (text: string) =>
  splitEmoji(text)
    .map((run) => (run.emoji ? EM_SPACE.repeat(clusters(run.text).length) : run.text))
    .join("");

// A paragraph drawn with React Native's nested Text, for anything without
// our native view (NativeParagraph): the same marks by the same rules,
// its pills flat, since nested text takes no padding or rounded corners.
// A long press on anything tappable reaches the row's, since a touch
// there never reaches the row.
export default function TextParagraph({
  lines,
  emojiOnly = false,
  muted = false,
  prefix,
  edited = false,
  body,
}: ParagraphProps) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const links = useContext(ChannelLinksContext);
  const { compact, shown, reveal, myUserId } = body;
  const isCovered = (path: string) => compact || !shown.has(path);
  const hold = compact ? undefined : body.onLongPress;

  // Emoji among the words stay at the text's size: web's larger size
  // raises their line on iOS.
  const words = (text: string, at: string, context: Context): ReactNode => {
    if (context.covered) return coverText(text);
    return splitEveryone(text, body.mentionsEntireChannel, body.mentionsHere).map((part, index) =>
      part.everyone ? (
        <Text key={nodePath(at, index)} style={[styles.mention, styles.mentionMe]}>
          {part.text}
        </Text>
      ) : (
        <Fragment key={nodePath(at, index)}>{part.text}</Fragment>
      ),
    );
  };

  const mention = (ref: MentionRef, at: string, context: Context): ReactNode => {
    if (ref.kind === "channel") {
      const channel = links?.channels.get(ref.id);
      if (!channel) return <Fragment key={at}>{mentionText(ref)}</Fragment>;
      const tappable = !!links && !compact && !context.inLink;
      return (
        <Text
          key={at}
          style={styles.mention}
          accessibilityRole={tappable ? "link" : undefined}
          onPress={tappable ? () => links.open(channel) : undefined}
          onLongPress={tappable ? hold : undefined}
        >
          #{channel.name}
        </Text>
      );
    }
    // Not looked up: the app doesn't hold a channel's members or groups.
    const mine = ref.kind === "person" && ref.id === myUserId;
    return (
      <Text key={at} style={[styles.mention, mine && styles.mentionMe]}>
        {mentionText(ref)}
      </Text>
    );
  };

  const draw = (nodes: Node[], parent: string, context: Context): ReactNode =>
    nodes.map((node, index) => {
      const at = nodePath(parent, index);
      switch (node.type) {
        case "text":
          return <Fragment key={at}>{words(node.text, at, context)}</Fragment>;
        case "code":
          return context.covered ? (
            <Fragment key={at}>{coverText(node.text)}</Fragment>
          ) : (
            <Text key={at} style={styles.code}>
              {node.text}
            </Text>
          );
        case "mention":
          // The parser has a spoiler's tokens as words already.
          return context.covered ? (
            <Fragment key={at}>{coverText(mentionText(node.mention))}</Fragment>
          ) : (
            mention(node.mention, at, context)
          );
        case "link": {
          if (context.covered) {
            return <Fragment key={at}>{node.label ? draw(node.label, at, context) : coverText(node.href)}</Fragment>;
          }
          const inner = { ...context, inLink: true, underline: true };
          const href = node.href;
          // iOS reads a link out as its words, so one whose words hide a
          // covered spoiler is no link to it; the paragraph's label says it.
          const hides = !!node.label && coveredIn(node.label, at, isCovered);
          return (
            <Text
              key={at}
              style={[styles.link, decoration(true, context.strike)]}
              accessibilityRole={compact ? undefined : hides ? "none" : "link"}
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

  // Said in place of a covered spoiler's words, after a list row's
  // marker; the words alone otherwise.
  const covers = anyCovered(lines, isCovered);
  const said = (cover: string) =>
    `${spoken(lines, isCovered, cover, (ref) => mentionWords(ref, links?.channels))}${edited ? " (edited)" : ""}`;
  const label =
    covers || prefix ? `${prefix ?? ""}${said(compact ? "spoiler" : COVER)}` : undefined;
  // Activating the paragraph (a screen reader's double tap, the "activate"
  // action on both platforms: Text takes no onAccessibilityTap) reveals
  // its first covered spoiler, as the label says; with none covered it
  // does nothing, rather than tapping the paragraph's middle, maybe a link.
  const activate = () => {
    const path = firstCovered(lines, isCovered);
    if (path !== undefined) reveal(path);
  };

  return (
    <Text
      style={[styles.text, emojiOnly && styles.emojiOnly, muted && styles.muted]}
      accessibilityLabel={label}
      accessibilityActions={compact ? undefined : ACTIVATE}
      onAccessibilityAction={compact ? undefined : (event) => event.nativeEvent.actionName === "activate" && activate()}
    >
      {lines.map((line, index) => (
        <Fragment key={line.path}>
          {index > 0 && "\n"}
          {draw(line.nodes, line.path, TOP)}
        </Fragment>
      ))}
      {edited && <Text style={styles.edited}> (edited)</Text>}
    </Text>
  );
}
