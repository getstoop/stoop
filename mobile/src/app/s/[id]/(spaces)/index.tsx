import Spaces from "../../../../screens/Spaces";
import { useCurrentServer } from "../../../../servers";

export default function SpacesTab() {
  return <Spaces server={useCurrentServer()} />;
}
