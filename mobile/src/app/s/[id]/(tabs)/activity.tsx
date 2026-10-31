import Activity from "../../../../screens/Activity";
import { useCurrentServer } from "../../../../servers";

export default function ActivityTab() {
  return <Activity server={useCurrentServer()} />;
}
