import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useTheme } from "../../theme";
import { type BodyBlock, blockGaps, parse } from "./blocks";
import CodeBlock from "./CodeBlock";
import type { BodyContext } from "./context";
import type { BodyPlace } from "./insets";
import type { Line } from "./lines";
import List from "./List";
import Paragraph from "./Paragraph";
import Quote from "./Quote";
import { makeStyles, type Styles } from "./styles";

const NO_PATHS: ReadonlySet<string> = new Set();
const NO_LINES: Line[] = [];

// A message's words, drawn from web's parser (core/markdown) as web's
// MessageBody draws them: a column of blocks (lines, quotes with their
// bar, lists with their markers by depth, code blocks that scroll
// sideways), and in their words bold, italic, underline, strike, inline
// code, links that open in the browser, and spoilers covered until
// tapped, each staying revealed while the row is mounted. Mentions of
// people and groups are pills, the reader's own filled, as are @channel
// and @here when the message carried them (core splitEveryone); a
// channel link is a pill that opens the channel when the screen's
// ChannelLinks has it, and its saved #name as words when it doesn't. A
// message of only emoji is drawn large. An edited message says so after
// its last words, or on a line of its own after a block, as web does. A
// long press anywhere reaches the row's. `compact` (the message menu's
// card) taps nothing and reveals nothing.
//
// Each paragraph is drawn by our native view where it is there
// (Paragraph); `place` names where the message is drawn, for its
// measure (insets.ts).
type Props = {
  content: string;
  myUserId: string;
  editedAt?: Timestamp;
  mentionsEntireChannel: boolean;
  mentionsHere: boolean;
  onLongPress?: () => void;
  compact?: boolean;
  place: BodyPlace;
  // Whether "(edited)" closes the words: false where the row puts it
  // after the message's files and link cards, as web's row does.
  markEdited?: boolean;
};

export default function MessageBody({
  content,
  myUserId,
  editedAt,
  mentionsEntireChannel,
  mentionsHere,
  onLongPress,
  compact = false,
  place,
  markEdited = true,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { blocks, emojiOnly } = useMemo(() => parse(content), [content]);
  const gaps = useMemo(() => blockGaps(blocks), [blocks]);
  const edited = !!editedAt && markEdited;

  // The spoilers revealed, by path, for this version of the message: an
  // edit starts over, even back to the same words.
  const version = `${editedAt?.seconds ?? ""}.${editedAt?.nanos ?? ""}\n${content}`;
  const [revealed, setRevealed] = useState({ version, paths: NO_PATHS });
  const shown = revealed.version === version ? revealed.paths : NO_PATHS;
  const reveal = useCallback(
    (path: string) =>
      setRevealed((before) => ({
        version,
        paths: new Set(before.version === version ? before.paths : []).add(path),
      })),
    [version],
  );
  const body: BodyContext = useMemo(
    () => ({ myUserId, mentionsEntireChannel, mentionsHere, compact, place, onLongPress, shown, reveal }),
    [myUserId, mentionsEntireChannel, mentionsHere, compact, place, onLongPress, shown, reveal],
  );

  // "(edited)" follows the last words when they are a paragraph's, and
  // after a quote, a list or a code block starts a line of its own.
  const last = blocks.at(-1);
  const editedInline = edited && last?.type === "lines";

  return (
    <View style={{ paddingBottom: edited && !editedInline ? 0 : gaps.after }}>
      {blocks.map((block, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: one parse of one message
          key={index}
          style={{ marginTop: gaps.before[index] }}
        >
          {drawBlock(block, styles, body, emojiOnly, editedInline && block === last)}
        </View>
      ))}
      {edited && !editedInline && (
        <View style={{ marginTop: gaps.after }}>
          <Paragraph lines={NO_LINES} indent={0} edited body={body} />
        </View>
      )}
    </View>
  );
}

function drawBlock(block: BodyBlock, styles: Styles, body: BodyContext, emojiOnly: boolean, edited: boolean): ReactNode {
  switch (block.type) {
    case "lines":
      return <Paragraph lines={block.lines} indent={0} emojiOnly={emojiOnly} edited={edited} body={body} />;
    case "quote":
      return <Quote lines={block.lines} styles={styles} body={body} />;
    case "list":
      return <List rows={block.rows} styles={styles} body={body} />;
    case "code":
      return <CodeBlock text={block.text} styles={styles} onLongPress={body.compact ? undefined : body.onLongPress} />;
  }
}
