import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { pickAvatar, prepareAvatar, uploadAvatar } from "../../api/avatar";
import { errorText, unreached } from "../../api/errors";
import { loadMe } from "../../api/me";
import Avatar from "../../components/Avatar";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";

// Your avatar and the way to change it, which acts at once, apart from the
// form's Save, as on web. The server takes the picture, finishes it in a job
// and then says the account changed, so the new one shows when the socket
// says so; only the picture is read from that, leaving what is being typed
// in the form alone. Leaving isn't held up by an upload, and whoever may have
// left or be typing lower down by the time one fails, so a failure is always
// said in an alert.

const RELOAD_DELAY_MS = 300;
const TITLE = "Couldn't change your avatar";

export default function AvatarPicker({ server, token, me }: { server: SavedServer; token: string; me: User }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [fileId, setFileId] = useState(me.avatarFileId);
  const [uploading, setUploading] = useState(false);

  // Whether a pick or upload is under way (a ref, so a second tap before the
  // redraw opens nothing), and whether the screen is still up.
  const busy = useRef(false);
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const change = async () => {
    if (busy.current) return;
    busy.current = true;
    Keyboard.dismiss();
    let sending = false;
    try {
      const asset = await pickAvatar();
      if (!asset) return;
      setUploading(true);
      const data = await prepareAvatar(asset);
      sending = true;
      await uploadAvatar(server.origin, token, data);
    } catch (err) {
      if (!sending) Alert.alert("Couldn't use that photo", "Try another one.");
      else Alert.alert(TITLE, unreached(err) ? "Check your connection and try again." : errorText(err));
    } finally {
      busy.current = false;
      if (open.current) setUploading(false);
    }
  };

  // One change arrives once per space the account is in, so a moment's quiet
  // goes before one reload. An older answer never replaces a newer one, but
  // stands if the newer one fails. A failure leaves what is shown, and You
  // asks again when it comes back into view.
  const asked = useRef(0);
  const shown = useRef(0);
  const reload = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reload.current), []);
  useServerEvents(server.id, (event) => {
    const { payload } = event;
    if (payload.case !== "ready" && !(payload.case === "memberUpdated" && payload.value.userId === me.id)) return;
    clearTimeout(reload.current);
    reload.current = setTimeout(() => {
      const mine = ++asked.current;
      loadMe(server.origin, token)
        .then((user) => {
          if (!user || mine < shown.current || !open.current) return;
          shown.current = mine;
          setFileId(user.avatarFileId);
        })
        .catch(() => {});
    }, RELOAD_DELAY_MS);
  });

  return (
    <View style={styles.picker}>
      <Avatar
        name={me.displayName || me.username}
        fileId={fileId}
        origin={server.origin}
        token={token}
        size={84}
        label={fileId ? "Your avatar" : "No avatar yet"}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: uploading }}
        disabled={uploading}
        onPress={change}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={[styles.label, uploading && styles.uploading]}>{uploading ? "Uploading" : "Change avatar"}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    picker: {
      alignItems: "center",
      gap: 4,
    },
    button: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.7,
    },
    label: {
      color: theme.accent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    uploading: {
      color: theme.textMuted,
    },
  });
}
