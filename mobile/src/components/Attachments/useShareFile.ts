import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useEffect, useRef, useState } from "react";
import { downloadAttachment, shareDownloaded } from "../../api/downloads";

export type Sharing =
  | { fileId: string; state: "idle" }
  | { fileId: string; state: "going"; written: number }
  | { fileId: string; state: "failed" };

// A file handed to the system's share sheet: downloaded into the app's
// cache (api/downloads), then the sheet on it. One at a time: a share
// asked for while one downloads does nothing. A failure stays until the
// next share. `countBytes` reports what has arrived as it comes (a
// card's progress line); without it the state changes only as the
// download starts and ends, so a screen that shows no count doesn't
// redraw for every chunk. Nothing is set once the caller has gone.
export function useShareFile(origin: string, token: string, countBytes = false) {
  const [sharing, setSharing] = useState<Sharing>({ fileId: "", state: "idle" });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const share = (attachment: Attachment) => {
    if (sharing.state === "going") return;
    const { fileId } = attachment;
    setSharing({ fileId, state: "going", written: 0 });
    const progress = (written: number) => {
      if (countBytes && mounted.current) setSharing({ fileId, state: "going", written });
    };
    downloadAttachment(origin, token, attachment, progress).then(
      (uri) => {
        if (!mounted.current) return;
        setSharing({ fileId, state: "idle" });
        shareDownloaded(uri, attachment).catch(() => {});
      },
      () => mounted.current && setSharing({ fileId, state: "failed" }),
    );
  };
  return { sharing, share };
}
