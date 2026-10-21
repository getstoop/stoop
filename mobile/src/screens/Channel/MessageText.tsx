import { type Inline, parseMarkdown } from "@stoop/core/markdown";
import { type MentionRef, mentionText } from "@stoop/core/mentions";
import { Fragment, type ReactNode } from "react";
import { Linking, StyleSheet, Text } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A message's words through web's parser (core/markdown), drawn plainly
// for now: bold, code and the rest read as their text, lists and quotes
// as their lines, and a spoiler stays covered. Mentions and channel links show as highlighted names,
// the reader's own name filled in, and links open in the browser. An
// edited message says so after its words, as on web.
export default function MessageText({
  content,
  myUserId,
  edited,
}: {
  content: string;
  myUserId: string;
  edited: boolean;
}) {
  const styles = makeStyles(useTheme());
  const lines = parseMarkdown(content).flatMap((block) => {
    if (block.type === "codeblock") return [[{ type: "text", text: block.text } as Inline]];
    return block.type === "list" ? block.items.map((item) => item.content) : block.lines;
  });

  // Inside a spoiler everything is plain words, so a mention or a link
  // can't show through the cover.
  const draw = (nodes: Inline[], key: string, covered = false): ReactNode =>
    nodes.map((node, index) => {
      const at = `${key}.${index}`;
      if (covered && node.type !== "text" && node.type !== "code") {
        if (node.type === "mention") return <Fragment key={at}>{mentionText(node.mention)}</Fragment>;
        if (node.type === "link") return <Fragment key={at}>{node.label ? draw(node.label, at, true) : node.href}</Fragment>;
        return <Fragment key={at}>{draw(node.children, at, true)}</Fragment>;
      }
      switch (node.type) {
        case "text":
        case "code":
          return <Fragment key={at}>{node.text}</Fragment>;
        case "mention":
          return (
            <Text key={at} style={[styles.mention, mine(node.mention, myUserId) && styles.mine]}>
              {mentionText(node.mention)}
            </Text>
          );
        case "link":
          return (
            <Text
              key={at}
              style={styles.link}
              accessibilityRole="link"
              onPress={() => Linking.openURL(node.href).catch(() => {})}
            >
              {node.label ? draw(node.label, at) : node.href}
            </Text>
          );
        case "spoiler":
          // Hidden, not drawn plainly: revealing one on a tap comes with
          // the rest of the formatting.
          return (
            <Text key={at} style={styles.spoiler} accessibilityLabel="spoiler">
              {draw(node.children, at, true)}
            </Text>
          );
        default:
          return <Fragment key={at}>{draw(node.children, at)}</Fragment>;
      }
    });

  return (
    <Text style={styles.text}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          {draw(line, String(index))}
        </Fragment>
      ))}
      {edited && <Text style={styles.edited}> (edited)</Text>}
    </Text>
  );
}

const mine = (mention: MentionRef, myUserId: string) => mention.kind === "person" && mention.id === myUserId;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    text: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    mention: {
      color: theme.accent,
      fontWeight: "600",
    },
    mine: {
      backgroundColor: theme.accentSoft,
    },
    edited: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    spoiler: {
      color: theme.textMuted,
      backgroundColor: theme.textMuted,
    },
    link: {
      color: theme.accent,
      textDecorationLine: "underline",
    },
  });
}
