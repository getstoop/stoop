import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "../../api/clients";
import { confirm } from "../../stores/dialogs";

// The last entry of the account nav, under the sections.
export function LogoutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = async () => {
    if (
      !(await confirm({
        title: "Log out?",
        body: "You'll need to sign in again on this device.",
        action: "Log out",
        danger: true,
      }))
    ) {
      return;
    }
    await authClient.logout({});
    queryClient.clear();
    navigate({ to: "/login" });
  };
  return (
    <button type="button" className="logout-link" onClick={logout}>
      Log out
    </button>
  );
}
