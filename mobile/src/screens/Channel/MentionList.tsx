import { isChannelOrHere, type MentionCandidate } from "@stoop/core/mentions";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import { PeopleIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "./Surface";

// The rows the composer offers while a @handle or #name is typed: web's
// MentionPicker on the phone (@channel and @here, then groups, then
// people; or the space's channels), drawn over the composer's card in its
// surface. No row is chosen ahead: only a tap picks, as Return makes a
// new line.

const ROW = 52;
// Four rows and half the next, so a list that scrolls says so.
const SHOWN = 4.5;

export default function MentionList({
  candidates,
  onPick,
  origin,
  token,
}: {
  candidates: MentionCandidate[];
  onPick: (candidate: MentionCandidate) => void;
  origin: string;
  token: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const mark = glass ? styles.glassMark : styles.mark;

  return (
    <Surface glass={glass} style={styles.list}>
      <ScrollView keyboardShouldPersistTaps="always" testID="mention-list">
        {candidates.map((candidate) => {
          const row = rowOf(candidate);
          return (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={row.label}
              onPress={() => onPick(candidate)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {candidate.kind === "member" && !isChannelOrHere(candidate.member.userId) ? (
                <Avatar
                  name={row.name}
                  fileId={candidate.member.avatarFileId}
                  origin={origin}
                  token={token}
                  size={32}
                />
              ) : (
                <View style={[styles.markShape, mark]}>
                  {candidate.kind === "group" ? (
                    <PeopleIcon color={theme.textMuted} />
                  ) : (
                    <Text style={styles.markText}>{candidate.kind === "channel" ? "#" : "@"}</Text>
                  )}
                </View>
              )}
              <View style={styles.words}>
                <Text numberOfLines={1} style={styles.name}>
                  {row.name}
                  {row.count && <Text style={styles.count}> {row.count}</Text>}
                </Text>
                {row.sub ? (
                  <Text numberOfLines={1} style={styles.sub}>
                    {row.sub}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Surface>
  );
}

type Row = { key: string; name: string; count?: string; sub: string; label: string };

// What a row shows, and says to a screen reader.
function rowOf(candidate: MentionCandidate): Row {
  if (candidate.kind === "channel") {
    const { id, name, topic } = candidate.channel;
    return { key: `channel:${id}`, name, sub: topic, label: topic ? `channel ${name}, ${topic}` : `channel ${name}` };
  }
  if (candidate.kind === "group") {
    const { id, name, handle, userIds } = candidate.group;
    const people = userIds.length === 1 ? "1 person" : `${userIds.length} people`;
    return {
      key: `group:${id}`,
      name,
      count: `(${userIds.length})`,
      sub: `@${handle}`,
      label: `${name}, ${people}, at ${handle}`,
    };
  }
  const { userId, username, displayName } = candidate.member;
  // @channel and @here carry what they reach as their display name.
  if (isChannelOrHere(userId)) {
    return { key: userId, name: `@${username}`, sub: displayName, label: `at ${username}, ${displayName}` };
  }
  const name = displayName || username;
  return { key: userId, name, sub: `@${username}`, label: `${name}, at ${username}` };
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: {
      maxHeight: ROW * SHOWN + 8,
      borderRadius: 20,
      padding: 4,
    },
    row: {
      minHeight: ROW,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
    },
    pressed: {
      backgroundColor: theme.accentSoft,
    },
    markShape: {
      width: 32,
      height: 32,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
    },
    mark: {
      backgroundColor: theme.raised,
    },
    // On glass a solid disc reads as a hole: the composer's translucent one.
    glassMark: {
      backgroundColor: theme.scheme === "dark" ? "rgba(255, 255, 255, 0.10)" : "rgba(0, 0, 0, 0.06)",
    },
    markText: {
      color: theme.textMuted,
      fontSize: 15,
      fontWeight: "700",
    },
    words: {
      flex: 1,
      gap: 1,
    },
    name: {
      color: theme.text,
      fontSize: 15,
      fontWeight: "600",
    },
    count: {
      color: theme.textMuted,
      fontWeight: "400",
    },
    sub: {
      color: theme.textMuted,
      fontSize: 13,
    },
  });
}

