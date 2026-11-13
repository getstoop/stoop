import AddSpace from "../../../screens/AddSpace";
import { useCurrentServer } from "../../../servers";

// /s/<id>/add-space: joining a space with an invite link, over the
// Spaces tab.
export default function AddSpaceRoute() {
  return <AddSpace server={useCurrentServer()} />;
}
