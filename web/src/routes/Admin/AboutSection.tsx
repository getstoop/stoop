import { useBuildInfo, useUpdate } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";

const RELEASES = "https://github.com/getstoop/stoop/releases";

// Which Stoop this is. Read-only rows; the version links to its release
// notes when it is a release rather than a local build. A newer release
// gets a row of its own.
export function AboutSection() {
  const { data: build } = useBuildInfo(true);
  const { data: update } = useUpdate(true);
  if (!build) return null;
  const isRelease = build.version !== "dev";
  return (
    <section className="card" data-testid="about-section">
      <SettingRow title="Version" description="What this server is running.">
        {isRelease ? (
          <a
            href={`${RELEASES}/tag/v${build.version}`}
            target="_blank"
            rel="noreferrer"
          >
            v{build.version}
          </a>
        ) : (
          <span>{build.version}</span>
        )}
      </SettingRow>
      {update?.available && (
        <SettingRow
          title="Update Available"
          description={
            <>
              Run <code>./stoop upgrade</code> on the host.
            </>
          }
          data-testid="update-available"
        >
          <a
            href={`${RELEASES}/tag/v${update.latest}`}
            target="_blank"
            rel="noreferrer"
          >
            v{update.latest} available
          </a>
        </SettingRow>
      )}
      {build.commit && (
        <SettingRow title="Commit">
          <code>{build.commit}</code>
        </SettingRow>
      )}
      {build.builtAt && (
        <SettingRow title="Built">
          <span>{new Date(build.builtAt).toLocaleString()}</span>
        </SettingRow>
      )}
      <SettingRow title="Go">
        <span>{build.goVersion}</span>
      </SettingRow>
    </section>
  );
}
