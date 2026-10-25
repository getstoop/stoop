import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { useContext, useMemo, useState } from "react";
import { Linking, useWindowDimensions } from "react-native";
import type { richText } from "../../../modules/stoop-rich-text";
import { useTheme } from "../../theme";
import { ChannelLinksContext } from "./channelLinks";
import { BODY_INSETS, type BodyPlace } from "./insets";
import { parse } from "./lines";
import { buildDoc } from "./native";

const COVER = "spoiler, double tap to reveal";
const NO_PATHS: ReadonlySet<string> = new Set();

// MessageBody drawn by our native view (modules/stoop-rich-text: TextKit
// on iOS, a StaticLayout on Android), which gives pills, code and
// spoilers web's rounded, padded boxes. The words
// are measured synchronously at the width the row will give them (the
// window's less the place's inset, insets.ts), so the row renders at its
// height the first time; onLayout corrects that width when it was wrong.
// A long press is the row's: the view takes only taps.
export default function NativeBody({
  native,
  content,
  myUserId,
  editedAt,
  mentionsEntireChannel,
  mentionsHere,
  compact = false,
  place,
}: {
  native: NonNullable<typeof richText>;
  content: string;
  myUserId: string;
  editedAt?: Timestamp;
  mentionsEntireChannel: boolean;
  mentionsHere: boolean;
  compact?: boolean;
  place: BodyPlace;
}) {
  const theme = useTheme();
  const links = useContext(ChannelLinksContext);
  const window = useWindowDimensions();
  const parsed = useMemo(() => parse(content), [content]);
  const edited = !!editedAt;
  // The spoilers revealed, by path, for this version of the message: an
  // edit starts over, even back to the same words.
  const version = `${editedAt?.seconds ?? ""}.${editedAt?.nanos ?? ""}\n${content}`;
  const [revealed, setRevealed] = useState({ version, paths: NO_PATHS });
  const shown = revealed.version === version ? revealed.paths : NO_PATHS;
  const [laidOut, setLaidOut] = useState<number | null>(null);
  const width = laidOut ?? window.width - BODY_INSETS[place];

  const { doc, spoilers } = useMemo(
    () =>
      buildDoc({
        parsed,
        theme,
        myUserId,
        mentionsEntireChannel,
        mentionsHere,
        links,
        compact,
        edited,
        fontScale: window.fontScale,
        isCovered: (path) => compact || !shown.has(path),
        cover: compact ? "spoiler" : COVER,
      }),
    [parsed, theme, myUserId, mentionsEntireChannel, mentionsHere, links, compact, edited, shown, window.fontScale],
  );
  const height = useMemo(() => native.measure(doc, width), [native, doc, width]);

  const reveal = (path: string) =>
    setRevealed((before) => ({
      version,
      paths: new Set(before.version === version ? before.paths : []).add(path),
    }));

  return (
    <native.View
      doc={doc}
      style={{ height }}
      onLayout={(event) => {
        const actual = event.nativeEvent.layout.width;
        if (actual !== width) setLaidOut(actual);
      }}
      onReveal={
        compact
          ? undefined
          : (event) => {
              const path = spoilers[event.nativeEvent.id];
              if (path !== undefined) reveal(path);
            }
      }
      onPressLink={
        compact
          ? undefined
          : (event) => {
              const url = event.nativeEvent.url;
              if (url.startsWith("channel:")) {
                const channel = links?.channels.get(url.slice("channel:".length));
                if (channel) links?.open(channel);
              } else {
                Linking.openURL(url).catch(() => {});
              }
            }
      }
    />
  );
}
