import You from "../../../../screens/You";
import { useCurrentServer } from "../../../../servers";

export default function YouTab() {
  return <You server={useCurrentServer()} />;
}
