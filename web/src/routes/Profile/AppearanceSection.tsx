import { ThemePicker } from "../../components/ThemePicker";

// How Stoop looks to you. A browser-side choice, so it says so.
export function AppearanceSection() {
  return (
    <section className="card appearance-section">
      <h3>Theme</h3>
      <p className="hint">
        Your choice, kept in this browser. Nothing a space or an admin sets can
        change it.
      </p>
      <ThemePicker />
    </section>
  );
}
