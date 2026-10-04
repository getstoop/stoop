import { ReachabilityForm } from "../../components/ReachabilityForm";

// Its own tab: set up once, but long enough that it crowded everything
// else when it shared a page.
export function ReachabilitySection() {
  return (
    <section className="card reach-section">
      <h3>Hosting</h3>
      <p className="hint">
        The server's environment fills these in once; after that, change them
        here.
      </p>
      <ReachabilityForm />
    </section>
  );
}
