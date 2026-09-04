import { useBuildInfo } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";

const RELEASES = "https://github.com/Jhut89/stoop/releases";

// Which Stoop this is. Read-only rows; the version links to its release
// notes when it is a release rather than a local build.
export function AboutSection() {
  const { data: build } = useBuildInfo(true);
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
