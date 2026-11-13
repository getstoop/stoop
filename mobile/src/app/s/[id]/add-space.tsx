import { useLocalSearchParams } from "expo-router";
import AddSpace from "../../../screens/AddSpace";
import { useCurrentServer } from "../../../servers";

// /s/<id>/add-space: joining a space with an invite link, over the
// Spaces tab; with ?link=<invite link> when the web's open-in-app page
// hands one over for a server the phone has saved
// (links/OpenInviteLink.tsx).
export default function AddSpaceRoute() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  // Keyed by the link, as the Invite route: a second hand-over while
  // the sheet is open starts it afresh.
  return <AddSpace key={link ?? ""} server={useCurrentServer()} initialLink={link ?? ""} />;
}
