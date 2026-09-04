import { useInstanceStatus } from "../api/queries";

// "Continue with X" buttons on the login and setup cards. Plain anchors:
// the flow is server-side redirects (COOP forbids popup flows), and the
// session comes back as a cookie so the SPA has nothing to store.
export function LoginProviders({
  redirect,
  invite,
  divider = true,
}: {
  redirect?: string;
  invite?: string;
  // The "or" line below the buttons; off when there's no form under it.
  divider?: boolean;
}) {
  const { data: status } = useInstanceStatus();
  const providers = status?.loginProviders ?? [];
  if (providers.length === 0) return null;
  return (
    <>
      <div className="login-providers">
        {providers.map((p) => (
          <a
            key={p.id}
            className="provider-button"
            data-provider={p.id}
            href={startURL(p.id, { redirect, invite })}
          >
            <ProviderIcon icon={p.icon} />
            {p.displayName}
          </a>
        ))}
      </div>
      {divider && (
        <div className="login-divider" aria-hidden="true">
          <span>or</span>
        </div>
      )}
    </>
  );
}

export function startURL(
  id: string,
  opts: { redirect?: string; invite?: string; link?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (opts.redirect) params.set("redirect", opts.redirect);
  if (opts.invite) params.set("invite", opts.invite);
  if (opts.link) params.set("link", "1");
  const qs = params.toString();
  return `/auth/oidc/${encodeURIComponent(id)}/start${qs ? `?${qs}` : ""}`;
}

// A provider's label is the button's entire text ("Continue with Google").
// Elsewhere — the linked-accounts list, notices — the short name reads
// better, so strip the usual verb phrase.
export function providerShortName(label: string): string {
  return label.replace(/^(continue|sign in|log in|login)\s+with\s+/i, "");
}

// The fixed icon set the admin picks from ("none" draws nothing). Inline
// SVG: the CSP allows no external images.
export function ProviderIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "none":
      return null;
    case "google":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="#4285f4"
            d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.4h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.8z"
          />
          <path
            fill="#34a853"
            d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.6-2.8c-1 .7-2.4 1.2-4.3 1.2-3.1 0-5.8-2-6.8-4.9l-3.9 3C3.2 21.4 7.3 24 12 24z"
          />
          <path
            fill="#fbbc05"
            d="M5.2 14.6c-.2-.7-.4-1.5-.4-2.6s.2-1.9.4-2.6l-3.9-3C.5 8.3 0 10.1 0 12s.5 3.7 1.3 5.3l3.9-2.7z"
          />
          <path
            fill="#ea4335"
            d="M12 4.6c2.2 0 3.7.9 4.5 1.7l3.3-3.2C17.9 1.2 15.2 0 12 0 7.3 0 3.2 2.6 1.3 6.4l3.9 3c1-2.8 3.7-4.8 6.8-4.8z"
          />
        </svg>
      );
    case "microsoft":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect fill="#f25022" x="1" y="1" width="10" height="10" />
          <rect fill="#7fba00" x="13" y="1" width="10" height="10" />
          <rect fill="#00a4ef" x="1" y="13" width="10" height="10" />
          <rect fill="#ffb900" x="13" y="13" width="10" height="10" />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="7.5" cy="15.5" r="4.5" />
          <path d="m11 12 8.5-8.5M16 7l3 3" />
        </svg>
      );
  }
}
