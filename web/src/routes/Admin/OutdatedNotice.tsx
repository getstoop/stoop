import { useBuildInfo, useUpdate } from "../../api/queries";

const RELEASES = "https://github.com/getstoop/stoop/releases";

// Shown while this server is older than the oldest supported release
// (docs/architecture/runtime.md → The update check).
export function OutdatedNotice() {
  const { data: build } = useBuildInfo(true);
  const { data: update } = useUpdate(true);
  if (!build || !update?.outdated) return null;
  return (
    <p className="callout warn outdated-notice" data-testid="outdated-notice">
      v{build.version} is no longer supported. Update to{" "}
      <a
        href={`${RELEASES}/tag/v${update.latest}`}
        target="_blank"
        rel="noreferrer"
      >
        v{update.latest}
      </a>
      : run <code>./stoop upgrade</code> on the host.
    </p>
  );
}
