import { imageStyle } from "./Avatar";

// A space's icon for the rail pill and the sidebar header: the image on a
// span that fills its box, or the name's first letters. inviteCode is for
// the invite page, where nobody is signed in yet.
export function SpaceIcon({
  name,
  fileId,
  className,
  inviteCode,
}: {
  name: string;
  fileId?: string;
  className?: string;
  inviteCode?: string;
}) {
  if (fileId) {
    return (
      <span
        className={className ?? "space-icon"}
        style={imageStyle(fileId, inviteCode)}
        data-file-id={fileId}
        aria-hidden="true"
      />
    );
  }
  return <>{name.slice(0, 2).toUpperCase()}</>;
}
