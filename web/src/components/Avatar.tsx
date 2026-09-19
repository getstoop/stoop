import type { CSSProperties } from "react";
import { fileUrl } from "../api/files";
import { isBot } from "../api/identity";
import type { IdentityKind } from "../gen/stoop/access/v1/access_pb";
import { BotIcon } from "./Icons";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return (letters.join("") || "?").toUpperCase();
}

// The uploaded image as a background on the same element the initials
// use, so each context's size and rounding apply unchanged. Fit is inline
// so no context's `background:` shorthand can reset it. SpaceIcon shares it.
export function imageStyle(fileId: string): CSSProperties {
  return {
    backgroundImage: `url(${fileUrl(fileId)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

// A user's avatar: one .avatar span in every context, showing the
// uploaded image or the initials when there is none. The kit's .avatar
// rule draws it; size picks 24, 40 or 64px, and none is 40px. The image is
// decorative — the name is always rendered beside it. data-file-id lets
// specs find image avatars.
export function Avatar({
  name,
  fileId,
  kind,
  size = "",
  children,
}: {
  name: string;
  fileId?: string;
  // A bot with no image wears the bot face rather than initials.
  kind?: IdentityKind;
  size?: "" | "small" | "medium" | "large";
  children?: React.ReactNode;
}) {
  return (
    <span
      className={`avatar ${size}`.trim()}
      style={fileId ? imageStyle(fileId) : undefined}
      data-file-id={fileId || undefined}
    >
      {fileId ? null : isBot(kind) ? <BotIcon /> : initials(name)}
      {children}
    </span>
  );
}
