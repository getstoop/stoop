import { useContext, useMemo, useState } from "react";
import { Linking, useWindowDimensions } from "react-native";
import type { richText } from "../../../modules/stoop-rich-text";
import { useTheme } from "../../theme";
import { ChannelLinksContext } from "./channelLinks";
import { COVER, type ParagraphProps } from "./context";
import { paragraphWidth } from "./insets";
import { buildDoc } from "./native";

// A paragraph drawn by our native view (modules/stoop-rich-text: TextKit
// on iOS, a StaticLayout on Android), which gives pills, code and
// spoilers web's rounded, padded boxes. The words are measured
// synchronously at the width the row will give them (the window's less
// the place's inset and the block's indent, insets.ts), so the row
// renders at its height the first time; onLayout corrects that width
// when it was wrong. A long press is the row's: the view takes only taps.
export default function NativeParagraph({
  native,
  lines,
  indent,
  emojiOnly = false,
  muted,
  prefix,
  edited = false,
  body,
}: ParagraphProps & { native: NonNullable<typeof richText> }) {
  const theme = useTheme();
  const links = useContext(ChannelLinksContext);
  const window = useWindowDimensions();
  const { compact, shown, reveal } = body;
  const [laidOut, setLaidOut] = useState<number | null>(null);
  const width = laidOut ?? paragraphWidth(window.width, body.place, indent);

  const { doc, spoilers } = useMemo(
    () =>
      buildDoc({
        lines,
        emojiOnly,
        muted,
        prefix,
        theme,
        myUserId: body.myUserId,
        mentionsEntireChannel: body.mentionsEntireChannel,
        mentionsHere: body.mentionsHere,
        links,
        compact,
        edited,
        fontScale: window.fontScale,
        isCovered: (path) => compact || !shown.has(path),
        cover: compact ? "spoiler" : COVER,
      }),
    [
      lines,
      emojiOnly,
      muted,
      prefix,
      theme,
      body.myUserId,
      body.mentionsEntireChannel,
      body.mentionsHere,
      links,
      compact,
      edited,
      shown,
      window.fontScale,
    ],
  );
  const height = useMemo(() => native.measure(doc, width), [native, doc, width]);

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
