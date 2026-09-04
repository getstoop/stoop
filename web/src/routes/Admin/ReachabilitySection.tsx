import { ReachabilityForm } from "../../components/ReachabilityForm";

// Its own tab: set up once, but long enough that it crowded everything
// else when it shared a page.
export function ReachabilitySection() {
  return (
    <section className="card reach-section">
      <h3>Hosting</h3>
      <p className="hint">
        Saved values here override the server's environment; clear one to fall
        back to it.
      </p>
      <ReachabilityForm />
    </section>
  );
}
