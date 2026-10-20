import { useLocalSearchParams } from "expo-router";
import Invite from "../screens/Invite";

// /invite, from Welcome, or /invite?link=<invite link> when the web's
// open-in-app page hands one over (+native-intent.tsx).
export default function InviteRoute() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  // Keyed by the link, so a second hand-over while this screen is open
  // starts it afresh rather than leaving the first one in the field.
  return <Invite key={link ?? ""} initialLink={link ?? ""} />;
}
