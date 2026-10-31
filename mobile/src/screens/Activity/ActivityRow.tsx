import { timestampDate } from "@bufbuild/protobuf/wkt";
import { activityTime, activityVerb } from "@stoop/core/activity";
import { splitPreview } from "@stoop/core/activityPreview";
import { type ActivityItem, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import { MutedIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import KindGlyph from "./KindGlyph";

const AVATAR = 40;

// One thing that happened to you, as web's ActivityRow: who did it, with
// the kind on their avatar's corner; what they did and where on one
// line, with when at its end; and two lines of the message, your handle
// (or @channel, @here) lit while it is new. A new row is a card; a read
// one is flat with a rule under it, the first of its day carrying the
// day, so its time needs only the time of day. A direct message names no
// place, the verb already does. A press opens where it happened.
export default memo(function ActivityRow({
  item,
  unread,
  day,
  last = false,
  channelName,
  spaceName,
  handle,
  origin,
  token,
  onPress,
}: {
  item: ActivityItem;
  unread: boolean;
  // The day this row opens, on the first read row of a day.
  day?: string;
  // The last read row, which has no rule under it.
  last?: boolean;
  // The channel's name, undefined while it isn't known.
  channelName?: string;
  // The space's name, when the account is in more than one.
  spaceName?: string;
  // The reader's username, which the preview lights.
  handle: string;
  origin: string;
  token: string;
  onPress: (item: ActivityItem) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const who = item.actor?.displayName || item.actor?.username || "Someone";
  const when = item.createdAt ? activityTime(timestampDate(item.createdAt), unread) : "";
  const verb = activityVerb(item.kind);
  const dm = item.kind === ActivityKind.DM || !item.spaceId;
  const channel = channelName ? `#${channelName}` : "…";
  const place = dm ? "" : ` · ${channel}${spaceName ? ` · ${spaceName}` : ""}`;
  const said = item.preview || "Message deleted";
  const label = [
    day,
    `${who} ${verb}${dm ? "" : ` in ${channel}${spaceName ? `, ${spaceName}` : ""}`}`,
    item.muted && "muted",
    unread && "unread",
    when,
  ]
    .filter(Boolean)
    .join(", ");

  const body = (
    <>
      <View style={styles.avatar}>
        <Avatar name={who} fileId={item.actor?.avatarFileId ?? ""} origin={origin} token={token} size={AVATAR} />
        <KindGlyph kind={item.kind} unread={unread} ring={unread ? theme.panel : theme.surface} />
      </View>
      <View style={styles.main}>
        <View style={styles.titleLine}>
          <Text style={styles.title}>
            <Text style={styles.who}>{who}</Text>
            {item.actor?.deleted && <Text style={styles.muted}> (deleted)</Text>}
            <Text style={styles.muted}>
              {" "}
              {verb}
              {place}
            </Text>
            {item.muted && (
              <>
                {" "}
                <MutedIcon color={theme.textMuted} size={13} />
              </>
            )}
          </Text>
          <Text style={styles.time}>{when}</Text>
        </View>
        {item.preview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {unread
              ? splitPreview(item.preview, handle).map((part, i) =>
                  part.mention ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
                    <Text key={i} style={styles.mention}>
                      {part.text}
                    </Text>
                  ) : (
                    part.text
                  ),
                )
              : item.preview}
          </Text>
        ) : (
          <Text style={[styles.preview, styles.gone]}>Message deleted</Text>
        )}
      </View>
    </>
  );

  const shape = [unread ? styles.card : styles.flat, !unread && last && styles.lastFlat];
  const inner = day ? (
    <>
      <Text style={styles.day}>{day}</Text>
      <View style={styles.row}>{body}</View>
    </>
  ) : (
    body
  );
  const content = day ? styles.column : styles.row;

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${said}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [content, ...shape, pressed && (unread ? styles.cardPressed : styles.flatPressed)]}
    >
      {inner}
    </Pressable>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: 12,
    },
    column: {
      gap: 6,
    },
    card: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    cardPressed: {
      backgroundColor: theme.raised,
    },
    flat: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    lastFlat: {
      borderBottomWidth: 0,
    },
    flatPressed: {
      backgroundColor: theme.hover,
    },
    day: {
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    avatar: {
      width: AVATAR,
      height: AVATAR,
    },
    main: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    titleLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
    },
    title: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingUi,
    },
    who: {
      fontWeight: "700",
    },
    muted: {
      color: theme.textMuted,
    },
    time: {
      flexShrink: 0,
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    preview: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingUi,
    },
    mention: {
      fontWeight: "600",
      backgroundColor: theme.accentSoft,
    },
    gone: {
      color: theme.textMuted,
      fontStyle: "italic",
    },
  });
}
