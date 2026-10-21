import SignedIn from "../../../../screens/SignedIn";
import { useCurrentServer } from "../../../../servers";

export default function YouTab() {
  return <SignedIn server={useCurrentServer()} />;
}
