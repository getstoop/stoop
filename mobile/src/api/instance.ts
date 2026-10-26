import { MAX_ATTACHMENT_BYTES } from "@stoop/core/attachments";
import { serverOrigins } from "@stoop/core/shareLinks";
import { useEffect, useMemo, useState } from "react";
import { instanceClient } from "./clients";

const TIMEOUT_MS = 10000;

export type ServerStatus = {
  // The cap on one file (max_upload_bytes), so a file over it fails
  // before uploading: the server's own ceiling until it answers, or if it
  // doesn't; the server enforces the cap either way.
  maxUploadBytes: number;
  // The origins a link to this server carries: the address the phone was
  // given, and the public one (public_url) once known (core/shareLinks
  // serverOrigins), for telling a link to one of its messages.
  origins: string[];
};

// What a screen of messages needs of GetInstanceStatus, read as it opens.
export function useServerStatus(origin: string): ServerStatus {
  const [cap, setCap] = useState(MAX_ATTACHMENT_BYTES);
  const [publicUrl, setPublicUrl] = useState("");
  useEffect(() => {
    let live = true;
    instanceClient(origin)
      .getInstanceStatus({}, { timeoutMs: TIMEOUT_MS })
      .then((status) => {
        if (!live) return;
        const bytes = Number(status.maxUploadBytes);
        if (bytes > 0) setCap(bytes);
        setPublicUrl(status.publicUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [origin]);
  const origins = useMemo(() => serverOrigins(origin.replace(/\/+$/, ""), publicUrl), [origin, publicUrl]);
  return { maxUploadBytes: cap, origins };
}
