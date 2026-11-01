import EditProfile from "../../../screens/EditProfile";
import { useCurrentServer } from "../../../servers";

// /s/<id>/edit-profile: changing who you are on this server, over the You tab.
export default function EditProfileRoute() {
  return <EditProfile server={useCurrentServer()} />;
}
