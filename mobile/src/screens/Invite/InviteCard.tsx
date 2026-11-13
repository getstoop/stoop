import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { fileUrl } from "../../api/files";
import { type InviteCheck, sentence } from "../../api/invites";
import { type Theme, tokens, useTheme } from "../../theme";
import ProbeCard from "../AddServer/ProbeCard";
import type { Check } from "./index";
import InviteNotice from "./InviteNotice";

// What the check of a pasted link found: still asking, the space it
// invites to, or why it can't be used. Nothing until there is a link.
// `member` is for an account already in the space the invite is to
// (Add a space knows; the Invite screen, with nobody signed in, never
// does): the card then says so in place of inviting. `aside` is a few
// words for the line under the space's name, in place of how many are
// in it: the line is one line, and a server's name can be long.
export default function InviteCard({
  check,
  member = false,
  aside,
}: {
  check: Check;
  member?: boolean;
  aside?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  if (check.state === "idle") return null;

  if (check.state === "not-link") {
    return (
      <InviteNotice
        heading="That isn't an invite link"
        body="Paste the whole link, starting with https://. It says which server to join."
      />
    );
  }

  if (check.state === "checking") {
    return (
      <View style={[styles.card, styles.row]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.textMuted} />
        <Text style={styles.muted}>Checking the invite…</Text>
      </View>
    );
  }

  return <Result result={check.result} member={member} aside={aside} styles={styles} />;
}

function Result({
  result,
  member,
  aside,
  styles,
}: {
  result: InviteCheck;
  member: boolean;
  aside: string | undefined;
  styles: ReturnType<typeof makeStyles>;
}) {
  switch (result.kind) {
    case "found": {
      const { preview } = result;
      const members = preview.memberCount === 1 ? "1 member" : `${preview.memberCount} members`;
      return (
        <View style={[styles.card, styles.row]} accessibilityLiveRegion="polite">
          <SpaceTile
            name={preview.spaceName}
            icon={
              preview.spaceIconFileId &&
              `${fileUrl(result.origin, preview.spaceIconFileId)}?invite=${encodeURIComponent(result.code)}`
            }
            styles={styles}
          />
          <View style={styles.space}>
            <Text style={styles.eyebrow}>{member ? "You're already in" : "You're invited to"}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {preview.spaceName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {result.serverName} · {aside ?? members}
            </Text>
          </View>
        </View>
      );
    }
    case "gone":
      return (
        <InviteNotice heading={sentence(result.message)} body="Ask whoever invited you for a fresh link." />
      );
    case "failed":
      return <InviteNotice heading="Couldn't check the invite" body={sentence(result.message)} />;
    case "server":
      return <ProbeCard check={{ state: "done", probe: result.probe }} />;
  }
}

// The space's icon, which the server shows to anyone holding a usable
// invite (web's fileUrl with an invite code), or its first letter when it
// has none or the icon won't load.
function SpaceTile({
  name,
  icon,
  styles,
}: {
  name: string;
  icon: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) {
    return <Image source={{ uri: icon }} style={styles.tile} onError={() => setFailed(true)} />;
  }
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLetter}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      padding: 16,
      gap: 6,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    muted: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
    },
    tile: {
      width: 48,
      height: 48,
      borderRadius: tokens.radiusLg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
      overflow: "hidden",
    },
    tileLetter: {
      color: theme.accent,
      fontSize: tokens.textXl,
      fontWeight: "700",
    },
    space: {
      flex: 1,
      gap: 2,
    },
    eyebrow: {
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    meta: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
