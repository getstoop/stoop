import { useNavigate } from "@tanstack/react-router";
import { useRecentSignIn } from "../../api/recentSignIn";

// On the Security tab while the session is too old for the changes below
// it (the .needs-confirm sections, dimmed while it shows): one way
// through, instead of a password field on every form.
export function ConfirmBanner() {
  const recent = useRecentSignIn();
  const navigate = useNavigate();
  if (recent !== false) return null;
  return (
    <div className="callout confirm-banner" role="status">
      <p>
        <strong>Confirm it's you to change the settings below.</strong> Your
        email, password, linked sign-ins, tokens and account wait until then.
      </p>
      <button
        type="button"
        className="primary"
        onClick={() =>
          void navigate({
            to: "/confirm",
            search: { next: "/profile?tab=security" },
          })
        }
      >
        Confirm it's you
      </button>
    </div>
  );
}
