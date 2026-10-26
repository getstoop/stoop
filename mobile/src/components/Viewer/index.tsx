import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, Modal, StyleSheet, useWindowDimensions, type ListViewToken } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { downloadAttachment, shareDownloaded } from "../../api/downloads";
import { tokens } from "../../theme";
import Bars, { type Sharing } from "./Bars";
import { pageLabel, type ViewerItem } from "./items";
import Page from "./Page";

// The full-screen viewer, the phone's counterpart of web's MediaPreview,
// opened by a tap on a picture in a channel or a thread (useViewer): the
// picture on black, fitted, with the screen's other pictures a swipe
// sideways away (web's list, items.ts). A modal over the screen, as the
// message menu is, not a route, so a cold open never lands here. A
// single tap hides and shows the bars, which never hide while a screen
// reader is on; Close, Android's back, a drag down (Page) and the
// screen reader's escape close it. Share hands the original, never the
// thumbnail, to the system's sheet: the copy expo-image already holds
// when there is one, else a download (api/downloads). The status bar
// hides while it is open.

export default function Viewer({
  items,
  start,
  origin,
  token,
  onClose,
}: {
  items: ViewerItem[];
  start: number;
  origin: string;
  token: string;
  onClose: () => void;
}) {
  const window = useWindowDimensions();
  const list = useRef<FlatList<ViewerItem>>(null);
  const [index, setIndex] = useState(start);
  const [bars, setBars] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [reader, setReader] = useState(false);
  const [sharing, setSharing] = useState<{ fileId: string; state: Sharing }>({ fileId: "", state: "idle" });
  const mounted = useRef(true);
  const closing = useRef(false);
  // In and out, and how far a drag down has taken the picture.
  const shown = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(1, { duration: tokens.dur });
    return () => {
      mounted.current = false;
    };
  }, [shown]);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then((on) => mounted.current && setReader(on));
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setReader);
    return () => sub.remove();
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    shown.value = withTiming(0, { duration: tokens.dur }, () => {
      scheduleOnRN(onClose);
    });
  }, [shown, onClose]);

  // The page more than half on screen is the one shown.
  const viewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const shownNow = viewableItems[0]?.index;
    if (shownNow == null) return;
    setIndex(shownNow);
    setZoomed(false);
  }).current;

  // A screen reader's increment and decrement.
  const step = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    list.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  };

  const item = items[index];
  const share = () => {
    if (sharing.state === "going") return;
    const { attachment } = item;
    setSharing({ fileId: attachment.fileId, state: "going" });
    downloadAttachment(origin, token, attachment, () => {}).then(
      (uri) => {
        if (!mounted.current) return;
        setSharing({ fileId: attachment.fileId, state: "idle" });
        shareDownloaded(uri, attachment).catch(() => {});
      },
      () => mounted.current && setSharing({ fileId: attachment.fileId, state: "failed" }),
    );
  };

  // The black fades as the picture is dragged down, and the picture
  // shrinks a little as it follows the finger.
  const backdrop = useAnimatedStyle(() => ({
    opacity: shown.value * interpolate(Math.abs(dragY.value), [0, window.height / 2], [1, 0.1], "clamp"),
  }));
  const content = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [
      { translateX: dragX.value },
      { translateY: dragY.value },
      { scale: interpolate(Math.abs(dragY.value), [0, window.height], [1, 0.7], "clamp") },
    ],
  }));
  const chrome = useAnimatedStyle(() => ({
    opacity: shown.value * interpolate(Math.abs(dragY.value), [0, 80], [1, 0], "clamp"),
  }));

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <StatusBar hidden />
      <GestureHandlerRootView style={styles.root} accessibilityViewIsModal onAccessibilityEscape={close}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.black, backdrop]} />
        <Animated.View style={[styles.root, content]}>
          <FlatList
            ref={list}
            horizontal
            pagingEnabled
            data={items}
            keyExtractor={(entry) => entry.attachment.fileId}
            initialScrollIndex={start}
            getItemLayout={(_data, at) => ({ length: window.width, offset: window.width * at, index: at })}
            initialNumToRender={1}
            windowSize={3}
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            onViewableItemsChanged={viewable}
            viewabilityConfig={VIEWABILITY}
            renderItem={({ item: entry, index: at }) => (
              <Page
                item={entry}
                origin={origin}
                token={token}
                width={window.width}
                height={window.height}
                active={at === index}
                label={pageLabel(entry, at, items.length)}
                focus={at === start}
                drag={{ x: dragX, y: dragY }}
                onTap={() => setBars((on) => !on)}
                onZoom={setZoomed}
                onSwipeClose={close}
                onStep={step}
              />
            )}
          />
        </Animated.View>
        {(bars || reader) && item && (
          <Animated.View style={[StyleSheet.absoluteFill, chrome]} pointerEvents="box-none">
            <Bars
              item={item}
              index={index}
              count={items.length}
              sharing={sharing.fileId === item.attachment.fileId ? sharing.state : "idle"}
              onClose={close}
              onShare={share}
            />
          </Animated.View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // A picture is looked at on black, whatever the theme.
  black: {
    backgroundColor: "#000000",
  },
});
