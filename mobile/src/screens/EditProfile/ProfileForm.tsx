import { BIO_MAX, DISPLAY_NAME_MAX, PRONOUNS_MAX, profileEdits } from "@stoop/core/profile";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Keyboard, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../api/clients";
import { errorText, fieldOf, unreached } from "../../api/errors";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import AvatarPicker from "./AvatarPicker";
import Field from "./Field";
import SaveButton from "./SaveButton";
import { backOptions } from "./backOptions";
import { confirmDiscard } from "./confirmDiscard";
import { saveItem } from "./saveItem";

// The form: one Save for all four fields, which wakes when any differs from
// what the server has, and returns to You once the server has taken them. A
// refusal goes under the field the server named; anything else, under the
// fields, each brought into view; if the screen has been left by then, in an
// alert. Leaving with unsaved edits asks first. On iOS the scroll view makes
// room for the keyboard itself.

const SAVE_TIMEOUT_MS = 10000;

type FieldName = "displayName" | "username" | "pronouns" | "bio";
const FIELDS: readonly string[] = ["displayName", "username", "pronouns", "bio"];

function usernameNote(me: User): string {
  if (me.usernameFrozen) return "How people mention you. Locked by a server admin.";
  if (me.usernamePending) return "How people mention you. This one came from your login provider. Make it yours.";
  return "How people mention you. 3 to 32 letters, numbers or underscores.";
}

export default function ProfileForm({ server, token, me }: { server: SavedServer; token: string; me: User }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [pronouns, setPronouns] = useState(me.pronouns);
  const [bio, setBio] = useState(me.bio);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Whether a save is out (a ref, so a second tap before the redraw sends
  // nothing), and whether the screen is still up. Leaving isn't blocked
  // meanwhile, and nothing is ever blocked natively: Android's stack doesn't
  // hold up a blocked back (it crashed redrawing the header after one).
  const savingNow = useRef(false);
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  // The bio, the last field and the only one that grows, stays above the
  // keyboard while it is being written: as it opens, and line by line.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const inBio = useRef(false);
  const followBio = () => {
    if (inBio.current) scroll.current?.scrollToEnd({ animated: true });
  };
  useEffect(followBio, [keyboard]);

  const edits = profileEdits(me, { displayName, username, pronouns, bio });
  const canSave = edits !== null && displayName.trim() !== "" && !saving;

  // The keyboard goes as a save starts, so what comes back isn't under it.
  // A save that worked stays "saving" on its way out, as the screen goes.
  const save = async () => {
    if (!edits || savingNow.current) return;
    savingNow.current = true;
    Keyboard.dismiss();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await authClient(server.origin, token).updateProfile(edits, { timeoutMs: SAVE_TIMEOUT_MS });
      if (open.current) router.back();
    } catch (err) {
      savingNow.current = false;
      const message = unreached(err) ? "Check your connection and try again." : errorText(err);
      if (!open.current) {
        Alert.alert("Couldn't save your profile", message);
        return;
      }
      setSaving(false);
      const field = fieldOf(err);
      if (field && FIELDS.includes(field)) setErrors({ [field]: errorText(err) });
      else setFormError(unreached(err) ? `Couldn't save your profile. ${message}` : message);
    }
  };

  // A refusal is brought into view: the names are at the top of the form,
  // the rest and the form's own line at the foot.
  useEffect(() => {
    const atFoot = formError || errors.pronouns || errors.bio;
    if (!atFoot && !errors.displayName && !errors.username) return;
    const frame = requestAnimationFrame(() => {
      if (atFoot) scroll.current?.scrollToEnd({ animated: true });
      else scroll.current?.scrollTo({ y: 0, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [errors, formError]);

  // Leaving asks while there are edits no save has taken; once one is out, or
  // has worked, it just goes. Asking happens on the screen's own back button
  // and Android's back, and iOS's swipe, which can't ask, is off meanwhile.
  const unsaved = edits !== null && !saving;
  const askToLeave = () => {
    if (!unsaved) return false;
    confirmDiscard(() => router.back());
    return true;
  };
  const latestAsk = useRef(askToLeave);
  latestAsk.current = askToLeave;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => latestAsk.current());
      return () => sub.remove();
    }, []),
  );

  // A field's refusal goes as soon as it is being put right.
  const editing = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((held) => (held[field] ? { ...held, [field]: undefined } : held));
  };

  // Typing mustn't rebuild the bar button: the header's options change only
  // when what it shows does, and it calls the latest save through a ref.
  const latestSave = useRef(save);
  latestSave.current = save;
  const label = saving ? "Saving" : "Save";
  const options = useMemo(() => {
    const props = { label, disabled: !canSave, onPress: () => latestSave.current() };
    const back = backOptions(() => {
      if (!latestAsk.current()) router.back();
    }, theme.text);
    return Platform.OS === "ios"
      ? { ...back, gestureEnabled: !unsaved, unstable_headerRightItems: () => [saveItem(props, theme.accent)] }
      : { ...back, headerRight: () => <SaveButton {...props} /> };
  }, [label, canSave, unsaved, router, theme.accent, theme.text]);
  return (
    <View style={[styles.screen, { paddingBottom: Platform.OS === "android" ? keyboard : 0 }]}>
      <Stack.Screen options={options} />
      <ScrollView
        ref={scroll}
        onContentSizeChange={followBio}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <AvatarPicker server={server} token={token} me={me} />
        <Field
          label="Display name"
          testID="profile-name"
          value={displayName}
          onChangeText={editing("displayName", setDisplayName)}
          maxLength={DISPLAY_NAME_MAX}
          autoCapitalize="words"
          autoCorrect={false}
          error={errors.displayName}
        />
        <Field
          label="Username"
          testID="profile-username"
          value={username}
          onChangeText={editing("username", setUsername)}
          note={usernameNote(me)}
          error={errors.username}
          locked={me.usernameFrozen}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="Pronouns"
          testID="profile-pronouns"
          value={pronouns}
          onChangeText={editing("pronouns", setPronouns)}
          maxLength={PRONOUNS_MAX}
          counted
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.pronouns}
        />
        <Field
          label="Bio"
          testID="profile-bio"
          value={bio}
          onChangeText={editing("bio", setBio)}
          maxLength={BIO_MAX}
          counted
          multiline
          error={errors.bio}
          onFocus={() => {
            inBio.current = true;
            followBio();
          }}
          onBlur={() => {
            inBio.current = false;
          }}
        />
        {formError && (
          <Text style={styles.formError} accessibilityRole="alert">
            {formError}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    content: {
      gap: 14,
      paddingTop: 8,
      paddingHorizontal: 16,
    },
    formError: {
      marginHorizontal: 4,
      color: theme.danger,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
