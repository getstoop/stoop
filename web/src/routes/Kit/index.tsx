import { THEMES, type ThemeId, useThemeStore } from "../../api/theme";
import { Buttons } from "./Buttons";
import { Fields } from "./Fields";
import { Foundations } from "./Foundations";
import { Parts } from "./Parts";
import { Surfaces } from "./Surfaces";
import "../../styles/kit.css";

// Every shared part of the kit on one page, so a change to controls.css,
// fields.css or surfaces.css can be eyeballed in every theme at once.
// Registered by router.tsx in dev builds only.
export function KitPage() {
  const { pref, setPref } = useThemeStore();
  return (
    <main className="kit-page">
      <header className="kit-section">
        <h1>Kit</h1>
        <label className="toggle-row">
          Theme
          <select
            value={pref.mode === "system" ? "" : pref.theme}
            onChange={(e) =>
              setPref(
                e.target.value
                  ? { ...pref, mode: "theme", theme: e.target.value as ThemeId }
                  : { ...pref, mode: "system" },
              )
            }
          >
            <option value="">Follow system</option>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <Foundations />
      <Buttons />
      <Fields />
      <Surfaces />
      <Parts />
    </main>
  );
}
