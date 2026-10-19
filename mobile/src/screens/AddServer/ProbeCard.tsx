import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { hostOf, MIN_SERVER_VERSION } from "../../api/probe";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import type { Check } from "./index";

// What the check of a typed address found: still asking, the server
// itself, or why the app can't use it. Nothing until there is an address.
export default function ProbeCard({ check }: { check: Check }) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  if (check.state === "idle") return null;

  if (check.state === "checking") {
    return (
      <View style={[styles.card, styles.row]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.textMuted} />
        <Text style={styles.muted}>Checking {check.host}…</Text>
      </View>
    );
  }

  const probe = check.probe;
  switch (probe.kind) {
    case "found":
      return (
        <View style={[styles.card, styles.row]} accessibilityLiveRegion="polite">
          <View style={styles.tile}>
            <Text style={styles.tileLetter}>{probe.name.trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.server}>
            <Text style={styles.name} numberOfLines={1}>
              {probe.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {hostOf(probe.origin)} · Stoop {probe.version}
            </Text>
          </View>
          <View accessible accessibilityLabel="Found">
            <CheckIcon color={theme.ok} />
          </View>
        </View>
      );
    case "too-old":
      return (
        <View style={[styles.card, styles.warn]} accessibilityRole="alert">
          <Text style={styles.heading}>{probe.name} needs an update</Text>
          <Text style={styles.body}>
            It runs Stoop {probe.version}, and this app needs {MIN_SERVER_VERSION} or newer. Ask
            whoever runs the server to update it.
          </Text>
        </View>
      );
    case "not-stoop":
      return (
        <View style={[styles.card, styles.danger]} accessibilityRole="alert">
          <Text style={styles.heading}>That isn't a Stoop server</Text>
          <Text style={styles.body}>
            {probe.detail} Check the address with whoever runs the server.
          </Text>
        </View>
      );
    case "unreachable":
      return (
        <View style={[styles.card, styles.danger]} accessibilityRole="alert">
          <Text style={styles.heading}>Can't reach that server</Text>
          <Text style={styles.body}>{probe.detail}</Text>
        </View>
      );
  }
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
    warn: {
      borderColor: theme.warn,
      backgroundColor: theme.warnSoft,
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
    },
    tileLetter: {
      color: theme.accent,
      fontSize: tokens.textXl,
      fontWeight: "700",
    },
    server: {
      flex: 1,
      gap: 2,
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
