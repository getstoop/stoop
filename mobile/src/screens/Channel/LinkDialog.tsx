import { checkLink } from "@stoop/core/editor/links";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { LinkDraft } from "../../../modules/stoop-rich-text";
import { type Theme, tokens, useTheme } from "../../theme";

// The composer's link form, a dialog on both platforms (canvas
// "8f · Link dialog"): the words and the address, web's checks and
// wording (core/editor/links checkLink), Save, and Remove when editing a
// link. It opens with the field's draft (RichField linkDraft): the link
// at the caret, else the selected words. iOS puts Cancel and Save side by
// side under the fields, with Remove link a row above them; Android puts
// Remove at the left of its buttons.
export default function LinkDialog({
  draft,
  onSave,
  onRemove,
  onCancel,
}: {
  draft: LinkDraft;
  onSave: (text: string, href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [text, setText] = useState(draft.text);
  const [href, setHref] = useState(draft.href || "https://");
  const [errors, setErrors] = useState<{ text?: string; href?: string }>({});
  const [focused, setFocused] = useState<"text" | "href" | null>(null);
  const ios = Platform.OS === "ios";

  const save = () => {
    const found = checkLink(text, href);
    setErrors(found);
    if (!found.text && !found.href) onSave(text, href);
  };

  const title = draft.editing ? "Edit link" : "Add link";
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={ios ? "padding" : "height"} style={styles.scrim}>
        <Pressable accessibilityLabel="Cancel" style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View accessibilityViewIsModal style={[styles.card, ios ? styles.cardIos : styles.cardAndroid]}>
          <Text accessibilityRole="header" style={ios ? styles.titleIos : styles.titleAndroid}>
            {title}
          </Text>
          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.label}>Text</Text>
              <TextInput
                testID="link-text"
                accessibilityLabel="Text"
                value={text}
                onChangeText={setText}
                onFocus={() => setFocused("text")}
                onBlur={() => setFocused(null)}
                style={[styles.input, focused === "text" && styles.inputFocused, errors.text && styles.inputBad]}
              />
              {errors.text && (
                <Text style={styles.error} accessibilityRole="alert">
                  {errors.text}
                </Text>
              )}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Address</Text>
              <TextInput
                testID="link-href"
                accessibilityLabel="Address"
                value={href}
                onChangeText={setHref}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={save}
                onFocus={() => setFocused("href")}
                onBlur={() => setFocused(null)}
                style={[styles.input, focused === "href" && styles.inputFocused, errors.href && styles.inputBad]}
              />
              {errors.href && (
                <Text style={styles.error} accessibilityRole="alert">
                  {errors.href}
                </Text>
              )}
            </View>
          </View>
          {ios ? (
            <>
              {draft.editing && (
                <Pressable accessibilityRole="button" onPress={onRemove} style={[styles.rowButton, styles.rule]}>
                  <Text style={[styles.rowText, styles.danger]}>Remove link</Text>
                </Pressable>
              )}
              <View style={[styles.iosButtons, styles.rule]}>
                <Pressable accessibilityRole="button" onPress={onCancel} style={styles.rowButton}>
                  <Text style={styles.rowText}>Cancel</Text>
                </Pressable>
                <View style={styles.divider} />
                <Pressable accessibilityRole="button" onPress={save} style={styles.rowButton}>
                  <Text style={[styles.rowText, styles.accent, styles.strong]}>Save</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.androidButtons}>
              {draft.editing && (
                <Pressable accessibilityRole="button" onPress={onRemove} style={styles.textButton}>
                  <Text style={[styles.textButtonText, styles.danger]}>Remove</Text>
                </Pressable>
              )}
              <View style={styles.spacer} />
              <Pressable accessibilityRole="button" onPress={onCancel} style={styles.textButton}>
                <Text style={[styles.textButtonText, styles.accent]}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={save} style={styles.textButton}>
                <Text style={[styles.textButtonText, styles.accent]}>Save</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 32,
      backgroundColor: theme.scheme === "dark" ? "rgba(0, 0, 0, 0.45)" : "rgba(30, 25, 20, 0.3)",
    },
    card: {
      backgroundColor: theme.panel,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 28,
      overflow: "hidden",
    },
    cardIos: {
      paddingTop: 20,
    },
    cardAndroid: {
      paddingTop: 24,
      paddingHorizontal: 24,
      paddingBottom: 12,
      gap: 20,
    },
    titleIos: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
      marginBottom: 12,
    },
    titleAndroid: {
      color: theme.text,
      fontSize: 22,
    },
    fields: {
      gap: 12,
      paddingHorizontal: Platform.OS === "ios" ? 16 : 0,
      paddingBottom: Platform.OS === "ios" ? 16 : 0,
    },
    field: {
      gap: 6,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    input: {
      height: 44,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.raised,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    inputFocused: {
      borderColor: theme.accent,
    },
    inputBad: {
      borderColor: theme.danger,
    },
    error: {
      color: theme.danger,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    rule: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    rowButton: {
      flex: 1,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: {
      color: theme.text,
      fontSize: 17,
    },
    iosButtons: {
      flexDirection: "row",
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
    androidButtons: {
      flexDirection: "row",
      alignItems: "center",
      marginRight: -12,
    },
    textButton: {
      height: 40,
      paddingHorizontal: 12,
      borderRadius: 20,
      justifyContent: "center",
    },
    textButtonText: {
      fontSize: 14,
      fontWeight: "500",
    },
    spacer: {
      flex: 1,
    },
    accent: {
      color: theme.accent,
    },
    danger: {
      color: theme.danger,
    },
    strong: {
      fontWeight: "600",
    },
  });
}
