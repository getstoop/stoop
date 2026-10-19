import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../theme";

// The first screen someone sees with no server added: the mark, a line
// on what Stoop is, and the two ways in. The buttons lead nowhere yet;
// Add a server and the invite link screen come next.

export default function Welcome() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Image
          source={require("../../assets/mark.png")}
          style={styles.mark}
          tintColor={theme.accent}
          accessibilityRole="image"
          accessibilityLabel="Stoop"
        />
        <Text style={styles.title} accessibilityRole="header">
          Stoop
        </Text>
        <Text style={styles.tagline}>
          Chat with your people, on a server one of you runs.
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
        >
          <Text style={[styles.label, styles.primaryLabel]}>Add a server</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.label}>I have an invite link</Text>
        </Pressable>
        <Text style={styles.hint}>
          Whoever runs your community's server can give you its address or an
          invite link.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
      paddingTop: 56,
      paddingHorizontal: 24,
      paddingBottom: 40,
    },
    hero: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    mark: {
      width: 96,
      height: 96,
    },
    title: {
      marginTop: 8,
      color: theme.text,
      fontSize: tokens.textDisplay,
      lineHeight: tokens.textDisplay * tokens.leadingTight,
      fontWeight: "700",
    },
    tagline: {
      maxWidth: 280,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
      textAlign: "center",
    },
    actions: {
      gap: 12,
    },
    button: {
      height: 50,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: {
      backgroundColor: theme.accent,
    },
    secondary: {
      backgroundColor: theme.panel,
      borderWidth: 1,
      borderColor: theme.border,
    },
    pressed: {
      opacity: 0.85,
    },
    label: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    primaryLabel: {
      color: theme.onAccent,
    },
    hint: {
      marginTop: 8,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
      textAlign: "center",
    },
  });
}
