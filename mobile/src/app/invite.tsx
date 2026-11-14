import { useLocalSearchParams } from "expo-router";
import Invite from "../screens/Invite";

// /invite, from Welcome, or /invite?link=<invite link> when the web's
// open-in-app page hands one over for a server the phone hasn't saved
// (links/OpenInviteLink.tsx), or Add a space passes one on.
export default function InviteRoute() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  // Keyed by the link, so a second hand-over while this screen is open
  // (which sets the param) starts it afresh rather than leaving the
  // first one in the field.
  return <Invite key={link ?? ""} initialLink={link ?? ""} />;
}
