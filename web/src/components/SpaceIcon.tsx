import { imageStyle } from "./Avatar";

// A space's icon for the rail pill and the sidebar header: the image on a
// span that fills its box, or the name's first letters.
export function SpaceIcon({
  name,
  fileId,
  className,
}: {
  name: string;
  fileId?: string;
  className?: string;
}) {
  if (fileId) {
    return (
      <span
        className={className ?? "space-icon"}
        style={imageStyle(fileId)}
        data-file-id={fileId}
        aria-hidden="true"
      />
    );
  }
  return <>{name.slice(0, 2).toUpperCase()}</>;
}
