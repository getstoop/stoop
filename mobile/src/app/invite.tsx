import { useLocalSearchParams } from "expo-router";
import Invite from "../screens/Invite";

// /invite, from Welcome, or /invite?link=<invite link> when the web's
// open-in-app page hands one over (+native-intent.tsx).
export default function InviteRoute() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  return <Invite initialLink={link ?? ""} />;
}
