import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMembers } from "../api/queries";
import { joinVoice } from "../api/voice";
import { useSpeaking } from "../hooks/useSpeaking";
import { useTileFlip } from "../hooks/useTileFlip";
import {
  participantsIn,
  trackKey,
  useVoiceStore,
  type VideoTrackRef,
} from "../stores/voice";
import { Avatar } from "./Avatar";
import { StageBar } from "./StageBar";
import { MicIcon } from "./VoiceIcons";

// The stage above a voice channel's chat while we're in it: a spotlight
// (the newest screen share, or whatever tile was clicked) and a strip of
// tiles — cameras, or avatars with the speaking ring. Video comes from
// the voice store's track registry; each tile attaches its track to a
// <video> and the SFU sends only the layer that size needs. Before there
// is any video the stage carries the join's status: "Connecting…", or
// why it failed and a way to try again.
const HEIGHT_KEY = "stoop.stageHeight";
const MIN_STAGE = 160;
const MIN_CHAT = 220;
const TILE_GAP = 8;

function loadStageHeight(): number | null {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return v >= MIN_STAGE ? v : null;
  } catch {
    return null;
  }
}

// Drag handle between the stage and the chat; the height is kept per
// browser. Double-click goes back to the default (42% of the pane).
function useStageResize(ref: React.RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(loadStageHeight);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = el.getBoundingClientRect().height;
    const paneH = el.parentElement?.getBoundingClientRect().height ?? Infinity;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const next = Math.min(
        Math.max(MIN_STAGE, startH + (ev.clientY - startY)),
        paneH - MIN_CHAT,
      );
      setHeight(next);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setHeight((h) => {
        try {
          if (h) localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
        } catch {
          // fine
        }
        return h;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const reset = () => {
    setHeight(null);
    try {
      localStorage.removeItem(HEIGHT_KEY);
    } catch {
      // fine
    }
  };
  // Keyboard: arrows nudge by 24px, Home resets.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const step = e.key === "ArrowDown" ? 24 : e.key === "ArrowUp" ? -24 : 0;
    if (e.key === "Home") {
      e.preventDefault();
      reset();
      return;
    }
    if (!step) return;
    e.preventDefault();
    const paneH = el.parentElement?.getBoundingClientRect().height ?? Infinity;
    const next = Math.min(
      Math.max(MIN_STAGE, el.getBoundingClientRect().height + step),
      paneH - MIN_CHAT,
    );
    setHeight(next);
    try {
      localStorage.setItem(HEIGHT_KEY, String(Math.round(next)));
    } catch {
      // fine
    }
  };
  return { height, onPointerDown, onKeyDown, reset };
}

// Tiles-only mode: the biggest 16:9 tile that fits this many of them.
// Each candidate row count is sized by whichever axis runs out first;
// sizing by width alone and then asking whether the height happened to
// fit — what this did before — never traded a little width for an extra
// row, so a short, wide stage sat two-thirds empty.
//
// Only a width comes out of here: the strip is flex-wrap, so the row
// break is the browser's to make, and it fits as many as physically
// can. Choosing the row count here would take forcing the wrap too.
function fitTiles(width: number, height: number, n: number): number {
  let best = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min(
      (width - TILE_GAP * (cols + 1)) / cols,
      ((height - TILE_GAP * (rows + 1)) / rows) * (16 / 9),
    );
    if (w > best) best = w;
  }
  return Math.max(120, Math.floor(best));
}

export function VoiceStage({
  spaceId,
  channelId,
  chatHidden,
  onToggleChat,
}: {
  spaceId: string;
  channelId: string;
  chatHidden: boolean;
  onToggleChat: () => void;
}) {
  const all = useVoiceStore((s) => s.participants);
  // The stage stays put through a failed join: the error belongs here,
  // not in a pane that vanishes out from under it.
  const status = useVoiceStore((s) =>
    s.connection?.channelId === channelId ? s.connection.status : null,
  );
  const joinError = useVoiceStore((s) =>
    s.connection?.channelId === channelId ? s.connection.error : undefined,
  );
  const live = status === "connected";
  const tracks = useVoiceStore((s) => s.tracks);
  const speaking = useSpeaking();
  const { data: members } = useMembers(spaceId);
  const [pinned, setPinned] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const { height, onPointerDown, onKeyDown, reset } = useStageResize(ref);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  const participants = participantsIn(all, channelId);
  const nameOf = (id: string) => {
    const m = members?.find((x) => x.userId === id);
    return m?.displayName || m?.username || "…";
  };
  // Muted shows on the tile, not the sidebar: the face you are looking
  // at is where you wonder why someone has gone quiet. Deafened implies
  // muted, so a deafened participant carries the marker too.
  const mutedIds = new Set(
    participants.filter((p) => p.muted).map((p) => p.userId),
  );
  const list = Object.values(tracks).sort((a, b) => a.order - b.order);
  const shares = list.filter((t) => t.source === "screen");
  const spotlightKey =
    pinned && tracks[pinned] ? pinned : (shares.at(-1)?.key ?? null);
  const spotlight = spotlightKey ? tracks[spotlightKey] : null;

  // Tiles: every participant once (camera or avatar), plus any share
  // that isn't in the spotlight.
  const tiles: { key: string; node: React.ReactNode }[] = [];
  for (const p of participants) {
    const cam = tracks[trackKey(p.userId, "camera")];
    const isSpeaking = speaking.has(p.userId);
    if (cam && cam.key !== spotlightKey) {
      tiles.push({
        key: cam.key,
        node: (
          <VideoTile
            t={cam}
            name={nameOf(p.userId)}
            muted={mutedIds.has(p.userId)}
            speaking={isSpeaking}
            onClick={() => setPinned(cam.key)}
          />
        ),
      });
    } else if (!cam) {
      tiles.push({
        key: p.userId,
        node: (
          <div className={`stage-tile avatar ${isSpeaking ? "speaking" : ""}`}>
            <Avatar
              name={nameOf(p.userId)}
              fileId={members?.find((m) => m.userId === p.userId)?.avatarFileId}
              size="large"
            />
            <TileName name={nameOf(p.userId)} muted={mutedIds.has(p.userId)} />
          </div>
        ),
      });
    }
  }
  for (const t of shares) {
    if (t.key === spotlightKey) continue;
    tiles.push({
      key: t.key,
      node: (
        <VideoTile
          t={t}
          name={`${nameOf(t.participantId)} · screen`}
          muted={mutedIds.has(t.participantId)}
          speaking={false}
          onClick={() => setPinned(t.key)}
        />
      ),
    });
  }

  // Size the tiles to the strip. Only the strip's own box is tracked in
  // state — it does not depend on the head count — and the width is
  // derived below during render, so a join lays out once at its final
  // size instead of rendering at the old width and being corrected.
  const tileCount = tiles.length;
  const tilesOnly = !spotlight;
  useLayoutEffect(() => {
    const el = tilesRef.current;
    if (!el || !live || !tilesOnly) {
      setBox(null);
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      // fitTiles counts the strip's own padding as its outer gaps, so it
      // wants the border box: contentRect has that padding taken off
      // already, and every tile would come out a gap short.
      const size = entry.borderBoxSize?.[0];
      if (size) {
        setBox({ w: size.inlineSize, h: size.blockSize });
        return;
      }
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    // Measure once up front so the first render already has a size and
    // the tiles never paint at the stylesheet's fallback width.
    const first = el.getBoundingClientRect();
    setBox({ w: first.width, h: first.height });
    ro.observe(el);
    return () => ro.disconnect();
  }, [live, tilesOnly]);

  const tileWidth =
    tilesOnly && box && tileCount ? fitTiles(box.w, box.h, tileCount) : null;

  // Who is on stage, and in what arrangement: the two things the tile
  // animation gates on.
  const keys = tiles.map((t) => t.key).join(" ");
  useTileFlip(tilesRef, keys, tilesOnly ? "grid" : "strip", tileWidth);

  const fullscreen = () => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <section
      ref={ref}
      className={`voice-stage ${chatHidden ? "no-chat" : ""} ${live ? (spotlight ? "" : "tiles-only") : (status ?? "")}`}
      data-channel-id={channelId}
      // With the chat hidden the stage takes the whole pane, so the
      // dragged height steps aside and comes back when chat does.
      style={height && !chatHidden ? { height, flexBasis: height } : undefined}
    >
      {status === "connecting" && (
        <p className="stage-status" aria-live="polite">
          Connecting…
        </p>
      )}
      {status === "error" && (
        <div className="stage-status error" role="alert">
          <strong>Couldn't join voice</strong>
          <span>{joinError}</span>
          <button
            type="button"
            className="chip"
            onClick={() => joinVoice(spaceId, channelId)}
          >
            Try again
          </button>
        </div>
      )}
      {live && spotlight && (
        <div className="stage-spotlight">
          <VideoTile
            t={spotlight}
            name={
              spotlight.source === "screen"
                ? `${nameOf(spotlight.participantId)} · screen`
                : nameOf(spotlight.participantId)
            }
            muted={mutedIds.has(spotlight.participantId)}
            // The ring says who is talking, so it belongs to the person
            // not to the screen they are showing.
            speaking={
              spotlight.source !== "screen" &&
              speaking.has(spotlight.participantId)
            }
            onClick={() => setPinned(null)}
            large
          />
        </div>
      )}
      {live && (
        <div
          ref={tilesRef}
          className="stage-tiles"
          style={
            tilesOnly && tileWidth
              ? ({ "--tile-width": `${tileWidth}px` } as React.CSSProperties)
              : undefined
          }
        >
          {tiles.map((t) => (
            <div key={t.key} data-tile-key={t.key}>
              {t.node}
            </div>
          ))}
        </div>
      )}
      <StageBar
        stageRef={ref}
        chatHidden={chatHidden}
        onToggleChat={onToggleChat}
        onFullscreen={fullscreen}
      />
      {/* Nothing below to resize against while the chat is hidden. */}
      {!chatHidden && (
        <button
          type="button"
          className="stage-resizer"
          aria-label="Resize the video area (drag, or arrow keys; Home resets)"
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onDoubleClick={reset}
          onKeyDown={onKeyDown}
        />
      )}
    </section>
  );
}

// The name plate on a tile: the muted marker never truncates, the name
// does.
function TileName({ name, muted }: { name: string; muted: boolean }) {
  return (
    <span className="tile-name">
      {muted && (
        <span className="tile-muted" title="Muted">
          <MicIcon off />
        </span>
      )}
      <span className="tile-label">{name}</span>
    </span>
  );
}

function VideoTile({
  t,
  name,
  muted,
  speaking,
  onClick,
  large = false,
}: {
  t: VideoTrackRef;
  name: string;
  muted: boolean;
  speaking: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    t.track.attach(el);
    return () => {
      t.track.detach(el);
    };
  }, [t.track]);
  const mirror = t.local && t.source === "camera";
  return (
    <button
      type="button"
      className={`stage-tile video ${large ? "large" : ""} ${speaking ? "speaking" : ""} ${mirror ? "mirror" : ""}`}
      onClick={onClick}
      title={large ? "Unpin" : "Pin to the spotlight"}
    >
      <video ref={ref} autoPlay playsInline muted />
      <TileName name={name} muted={muted} />
    </button>
  );
}
