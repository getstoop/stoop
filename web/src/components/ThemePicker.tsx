import { THEMES, type ThemeId, useThemeStore } from "../api/theme";

// Profile → Appearance. Each card is a miniature of the app painted by the
// real theme CSS (the card scopes data-theme to its own subtree), so what
// you see is what you get. Clicking applies immediately — a wrong choice
// costs one more click, so there is nothing to save.
export function ThemePicker() {
  const pref = useThemeStore((s) => s.pref);
  const active = useThemeStore((s) => s.active);
  const setPref = useThemeStore((s) => s.setPref);

  const choose = (id: ThemeId) => {
    const kind = THEMES.find((t) => t.id === id)?.kind ?? "dark";
    if (pref.mode === "system") {
      // In system mode a click updates the half of the pair it belongs to.
      setPref({ ...pref, [kind]: id });
    } else {
      setPref({ ...pref, theme: id, [kind]: id });
    }
  };

  return (
    <div className="theme-picker">
      <div className="theme-cards">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            data-theme={t.id}
            className={`theme-card ${active === t.id ? "active" : ""} ${
              pref.mode === "system" &&
              (pref.dark === t.id || pref.light === t.id)
                ? "paired"
                : ""
            }`}
            onClick={() => choose(t.id)}
            aria-pressed={active === t.id}
          >
            <span className="theme-mock" aria-hidden="true">
              <span className="theme-mock-rail">
                <span className="theme-mock-pill on" />
                <span className="theme-mock-pill" />
              </span>
              <span className="theme-mock-side">
                <span className="theme-mock-line active" />
                <span className="theme-mock-line" />
                <span className="theme-mock-line" />
              </span>
              <span className="theme-mock-main">
                <span className="theme-mock-msg">
                  <span className="theme-mock-av" />
                  <span className="theme-mock-text">
                    <span className="theme-mock-who" />
                    <span className="theme-mock-body" />
                  </span>
                </span>
                <span className="theme-mock-msg">
                  <span className="theme-mock-av" />
                  <span className="theme-mock-text">
                    <span className="theme-mock-who" />
                    <span className="theme-mock-body short" />
                  </span>
                </span>
                <span className="theme-mock-composer" />
              </span>
            </span>
            <span className="theme-card-name">
              {t.name}
              <span className="theme-card-kind">{t.kind}</span>
            </span>
            <span className="theme-card-blurb">{t.blurb}</span>
          </button>
        ))}
      </div>
      <label className="theme-system">
        <input
          type="checkbox"
          checked={pref.mode === "system"}
          onChange={(e) =>
            setPref({ ...pref, mode: e.target.checked ? "system" : "theme" })
          }
        />
        Follow the system's light/dark setting
        {pref.mode === "system" && (
          <span className="hint">
            {" "}
            — {THEMES.find((t) => t.id === pref.dark)?.name} when dark,{" "}
            {THEMES.find((t) => t.id === pref.light)?.name} when light. Click a
            card to change either.
          </span>
        )}
      </label>
    </div>
  );
}
