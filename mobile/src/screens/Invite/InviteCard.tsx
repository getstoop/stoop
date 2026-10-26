import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { fileUrl } from "../../api/files";
import type { InviteCheck } from "../../api/invites";
import { type Theme, tokens, useTheme } from "../../theme";
import ProbeCard from "../AddServer/ProbeCard";
import type { Check } from "./index";

// What the check of a pasted link found: still asking, the space it
// invites to, or why it can't be used. Nothing until there is a link.
export default function InviteCard({ check }: { check: Check }) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  if (check.state === "idle") return null;

  if (check.state === "not-link") {
    return (
      <View style={[styles.card, styles.danger]} accessibilityRole="alert">
        <Text style={styles.heading}>That isn't an invite link</Text>
        <Text style={styles.body}>
          Paste the whole link, starting with https://. It says which server to join.
        </Text>
      </View>
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

  return <Result result={check.result} styles={styles} />;
}

function Result({ result, styles }: { result: InviteCheck; styles: ReturnType<typeof makeStyles> }) {
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
            <Text style={styles.eyebrow}>You're invited to</Text>
            <Text style={styles.name} numberOfLines={1}>
              {preview.spaceName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {result.serverName} · {members}
            </Text>
          </View>
        </View>
      );
    }
    case "gone":
      return (
        <View style={[styles.card, styles.danger]} accessibilityRole="alert">
          <Text style={styles.heading}>{sentence(result.message)}</Text>
          <Text style={styles.body}>Ask whoever invited you for a fresh link.</Text>
        </View>
      );
    case "failed":
      return (
        <View style={[styles.card, styles.danger]} accessibilityRole="alert">
          <Text style={styles.heading}>Couldn't check the invite</Text>
          <Text style={styles.body}>{sentence(result.message)}</Text>
        </View>
      );
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

// The server's messages are lower case with no stop ("this invite has
// expired"); on their own they read as a sentence.
function sentence(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
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
    danger: {
      borderColor: theme.danger,
      backgroundColor: theme.dangerSoft,
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
    heading: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    body: {
      color: theme.text,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
