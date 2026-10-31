import NewMessage from "../../../screens/NewMessage";
import { useCurrentServer } from "../../../servers";

// /s/<id>/new-message: picking who to talk to, over the Messages tab.
export default function NewMessageRoute() {
  return <NewMessage server={useCurrentServer()} />;
}
