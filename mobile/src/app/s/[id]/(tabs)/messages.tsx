import Messages from "../../../../screens/Messages";
import { useCurrentServer } from "../../../../servers";

export default function MessagesTab() {
  return <Messages server={useCurrentServer()} />;
}
