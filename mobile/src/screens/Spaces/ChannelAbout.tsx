import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Sheet from "../../components/Sheet";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelMark from "./ChannelMark";

// The most of the screen's height a topic takes before it scrolls.
const TOPIC_HEIGHT = 0.5;

// About this channel, from a channel's menu: a sheet (Sheet) with the
// channel's name, marked as its row marks it, over its topic in full,
// as plain text, which is what web shows. Only to read. A topic too
// long for the sheet scrolls in it.
export default function ChannelAbout({
  channel,
  topic,
  onClose,
}: {
  channel: Channel;
  topic: string;
  onClose: () => void;
}) {
  const styles = makeStyles(useTheme());
  const most = useWindowDimensions().height * TOPIC_HEIGHT;
  // The topic's height as drawn. One that fits does not scroll, which
  // leaves a swipe down on it to the sheet; one that scrolls keeps the
  // swipe while it is away from its top, to scroll back by.
  const [height, setHeight] = useState(0);
  // Where the topic starts, below the sheet's top edge.
  const top = useRef(0);

  return (
    <Sheet label={`About ${channel.name}`} closeTestID="channel-about-close" onClose={onClose}>
      {({ hold }) => (
        <>
          <View style={styles.title}>
            <ChannelMark channel={channel} />
            <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
              {channel.name}
            </Text>
          </View>
          <ScrollView
            style={{ maxHeight: most }}
            contentContainerStyle={styles.body}
            scrollEnabled={height > most}
            onContentSizeChange={(_width, drawn) => setHeight(drawn)}
            onLayout={(event) => {
              top.current = event.nativeEvent.layout.y;
            }}
            onScroll={(event) => hold(event.nativeEvent.contentOffset.y > 0 ? top.current : null)}
            scrollEventThrottle={16}
          >
            <Text style={styles.topic} selectable>
              {topic}
            </Text>
          </ScrollView>
        </>
      )}
    </Sheet>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    title: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 32,
      paddingHorizontal: 12,
    },
    name: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textLg,
      fontWeight: "700",
    },
    body: {
      paddingTop: 8,
      paddingBottom: 12,
      paddingHorizontal: 12,
    },
    topic: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
