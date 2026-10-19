import { useLocalSearchParams } from "expo-router";
import { useServer } from "../../../servers";
import SignedIn from "../../../screens/SignedIn";

export default function ServerHome() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);
  return server ? <SignedIn server={server} /> : null;
}
