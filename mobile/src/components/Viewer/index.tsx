import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, type LayoutChangeEvent, Modal, Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { downloadAttachment, shareDownloaded } from "../../api/downloads";
import { tokens } from "../../theme";
import Bars, { type Sharing } from "./Bars";
import { isVideo, itemKey, pageLabel, type ViewerItem } from "./items";
import Page from "./Page";
import Pager from "./Pager";
import VideoPage from "./VideoPage";

// The full-screen viewer, the phone's counterpart of web's MediaPreview,
// opened by a tap on a picture in a channel or a thread (useViewer): the
// picture on black, fitted, with the screen's other pictures and videos
// a swipe sideways away (web's list, items.ts), a video playing
// (VideoPage). A modal over the screen, as the message menu is, not a
// route, so a cold open never lands here. A single tap hides and shows
// the bars, which never hide while a screen reader is on, nor over a
// video, whose touches are its controls'; Close, Android's back, a drag
// down on a picture (Page) and the screen reader's escape close it.
// Share hands the original, never the thumbnail, to the system's sheet:
// the copy expo-image already holds when there is one, else a download
// (api/downloads). The status bar hides while it is open.

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
  // The pages are as big as the modal turns out to be, which on Android
  // need not be the window's size.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Android's modal copies the activity's system bars as it is shown
  // (ReactModalHostView.updateSystemAppearance), so the status bar is
  // hidden a moment before it.
  const [ready, setReady] = useState(Platform.OS !== "android");
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

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    if (ready) {
      shown.value = withTiming(1, { duration: tokens.dur });
      return;
    }
    const timer = setTimeout(() => !closing.current && setReady(true), BARS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, shown]);

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

  // Back before the modal is up (it takes its own once shown) closes the
  // viewer rather than the screen under it.
  useEffect(() => {
    if (ready) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [ready, close]);

  const paged = useCallback((next: number) => {
    setIndex(next);
    setZoomed(false);
  }, []);

  // Where a screen reader's focus goes next: the page it opened on, then
  // the page each increment or decrement reaches. Each request is taken
  // once, so a page drawn again later doesn't take the focus back.
  const focusTo = useRef<number | null>(start);
  const takeFocus = (at: number) => {
    if (focusTo.current !== at) return false;
    focusTo.current = null;
    return true;
  };
  const step = (from: number, delta: number) => {
    const next = from + delta;
    if (next < 0 || next >= items.length) return;
    focusTo.current = next;
    paged(next);
  };
  const measured = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout;
    if (width !== size?.width || height !== size?.height) setSize({ width, height });
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
    opacity: shown.value * interpolate(Math.abs(dragY.value), [0, (size?.height ?? 0) / 2], [1, 0.1], "clamp"),
  }));
  const content = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [
      { translateX: dragX.value },
      { translateY: dragY.value },
      { scale: interpolate(Math.abs(dragY.value), [0, size?.height ?? 0], [1, 0.7], "clamp") },
    ],
  }));
  const chrome = useAnimatedStyle(() => ({
    opacity: shown.value * interpolate(Math.abs(dragY.value), [0, 80], [1, 0], "clamp"),
  }));

  return (
    <>
      <StatusBar hidden />
      {ready && (
        <Modal
          transparent
          visible
          animationType="none"
          onRequestClose={close}
          statusBarTranslucent
          navigationBarTranslucent
        >
          <GestureHandlerRootView
            style={styles.root}
            onLayout={measured}
            accessibilityViewIsModal
            onAccessibilityEscape={close}
          >
            <Animated.View style={[StyleSheet.absoluteFill, styles.black, backdrop]} />
            <Animated.View style={[styles.root, content]}>
              {size && (
                <Pager
                  count={items.length}
                  index={index}
                  width={size.width}
                  height={size.height}
                  enabled={!zoomed && !isVideo(items[index])}
                  keyOf={(at) => itemKey(items[at])}
                  onIndex={paged}
                  renderPage={(at) =>
                    isVideo(items[at]) ? (
                      <VideoPage
                        item={items[at]}
                        origin={origin}
                        token={token}
                        active={at === index}
                        label={pageLabel(items[at], at, items.length)}
                        takeFocus={() => takeFocus(at)}
                        onShare={share}
                        onStep={(delta) => step(at, delta)}
                      />
                    ) : (
                      <Page
                        item={items[at]}
                        origin={origin}
                        token={token}
                        width={size.width}
                        height={size.height}
                        active={at === index}
                        label={pageLabel(items[at], at, items.length)}
                        takeFocus={() => takeFocus(at)}
                        drag={{ x: dragX, y: dragY }}
                        onTap={() => setBars((on) => !on)}
                        onZoom={setZoomed}
                        onSwipeClose={close}
                        onStep={(delta) => step(at, delta)}
                      />
                    )
                  }
                />
              )}
            </Animated.View>
            {item && (bars || reader || isVideo(item)) && (
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
      )}
    </>
  );
}

const BARS_SETTLE_MS = 100;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // A picture is looked at on black, whatever the theme.
  black: {
    backgroundColor: "#000000",
  },
});
