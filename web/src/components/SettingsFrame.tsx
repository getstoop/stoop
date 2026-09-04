import type { ReactNode } from "react";

// The frame the profile, space settings and server admin pages share
// (docs/proposals/settings-layout.md): a nav column in the channel
// sidebar's slot — the page's identity, then one link per section and
// whatever `foot` adds under them — and a content column beside it
// headed by the section's name. On a phone the nav sits above the
// content as a scrolling strip (styles/mobile.css).
export function SettingsFrame({
  label,
  head,
  tabs,
  foot,
  title,
  hint,
  children,
}: {
  label: string;
  head: ReactNode;
  tabs: ReactNode;
  foot?: ReactNode;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-page">
      <div className="settings-nav">
        {head}
        <nav className="settings-tabs" aria-label={label}>
          {tabs}
          {foot}
        </nav>
      </div>
      <main className="settings-main">
        <div className="settings-content">
          <header className="settings-head">
            <h1 className="settings-title">{title}</h1>
            {hint && <p className="hint">{hint}</p>}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
