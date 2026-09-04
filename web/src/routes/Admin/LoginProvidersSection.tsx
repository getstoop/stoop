import { LoginProvidersForm } from "../../components/LoginProvidersForm";

// Its own tab: sign-in with an identity people already have (OIDC).
export function LoginProvidersSection() {
  return (
    <section className="card">
      <h3>Login providers</h3>
      <p className="hint">
        Let people sign in with an identity they already have — a self-hosted
        IdP (Authentik, Keycloak, Pocket ID) or Google/Microsoft. Register the
        callback URL in the provider's console and paste the client id and
        secret here.
      </p>
      <LoginProvidersForm />
    </section>
  );
}
