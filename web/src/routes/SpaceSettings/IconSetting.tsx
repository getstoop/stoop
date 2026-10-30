import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { filesClient } from "../../api/files";
import { ImagePicker } from "../../components/ImagePicker";
import { SpaceIcon } from "../../components/SpaceIcon";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";

// The icon row of General: a SettingRow by hand, so the preview can
// stand left of the words, square and as tall as they are, drawn the
// way the rail draws the open space. The side is measured from the
// words rather than left to aspect-ratio, which WebKit does not apply
// to a stretched flex item. A wider square narrows the words and makes
// them taller, so the side is capped — at MAX_SIDE, and at a share of
// the column where the column is narrow — and the measuring settles.
// The upload applies at once; it is not part of the form's Save.
const MIN_SIDE = 56;
const MAX_SIDE = 104;

export function IconSetting({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const text = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<number>();

  useLayoutEffect(() => {
    const el = text.current;
    const column = el?.parentElement;
    if (!el || !column) return;
    // Next frame, so a resize this causes is a new observation rather
    // than a loop inside this one.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cap = Math.min(MAX_SIDE, column.clientWidth * 0.3);
        const h = el.getBoundingClientRect().height;
        setSide(Math.round(Math.max(MIN_SIDE, Math.min(cap, h))));
      });
    });
    observer.observe(el);
    observer.observe(column);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Re-encoded server-side to a 512 px square PNG; members see it in the
  // rail as soon as the SpaceUpdated event lands.
  const upload = async (bytes: Uint8Array) => {
    await filesClient.uploadSpaceIcon({ spaceId: space.id, data: bytes });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  };

  return (
    <div className="setting-row icon-setting">
      <div className="icon-setting-text">
        <span
          className="icon-preview"
          style={side ? { width: side, height: side } : undefined}
          aria-hidden="true"
        >
          <SpaceIcon name={space.name} fileId={space.iconFileId} />
        </span>
        <div className="setting-text" ref={text}>
          <strong>Icon</strong>
          <div className="hint">
            In the space list and at the top of the sidebar. PNG, JPEG, GIF or
            WebP up to 2 MB, cropped to a square. Applies as soon as it uploads.
          </div>
        </div>
      </div>
      <div className="setting-control">
        <ImagePicker
          label={space.iconFileId ? "Change icon" : "Upload icon"}
          onPick={upload}
        />
      </div>
    </div>
  );
}
