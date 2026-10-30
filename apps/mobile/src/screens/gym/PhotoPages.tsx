import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { slideDrag, slideTo } from "./zoom";
import { ZoomPhoto } from "./ZoomPhoto";

interface PhotoPagesProps {
  /** Open while it is not null: which photo is shown, and of what. */
  viewing: { listKey: string; ids: readonly string[]; index: number } | null;
  photo: (id: string) => ReactNode;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** Photos one at a time, the whole screen; slid left and right (Kd's click-through, 2026-10-30), and stepped by a screen
 *  reader's swipe up and down. A post's photos, and a post's photos before it goes up. */
export function PhotoPages({ viewing, photo, onIndex, onClose }: PhotoPagesProps) {
  const insets = useSafeAreaInsets();
  const ids = viewing?.ids ?? [];
  const index = viewing === null ? 0 : Math.min(viewing.index, ids.length - 1);
  // One photo is the width the viewer is given.
  const [width, setWidth] = useState(0);
  const at = useRef(new Animated.Value(0)).current;
  const opened = viewing !== null;
  const settle = (to: number) => {
    Animated.timing(at, { toValue: -to * width, duration: 200, useNativeDriver: true }).start();
  };
  // Where the row of photos stands: at once on opening or a new width, and sliding when the photo changes.
  const shownAt = useRef({ index: -1, width: 0 });
  useEffect(() => {
    if (!opened) {
      shownAt.current = { index: -1, width: 0 };
      return;
    }
    if (shownAt.current.index === -1 || shownAt.current.width !== width) at.setValue(-index * width);
    else settle(index);
    shownAt.current = { index, width };
    // settle reads this render's width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, index, width, at]);
  const go = (to: number) => {
    if (to < 0 || to >= ids.length) return;
    onIndex(to);
  };
  const counted = ids.length === 0 ? "" : `Photo ${String(index + 1)} of ${String(ids.length)}`;
  return (
    <Modal visible={viewing !== null} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="photo-viewer" style={[styles.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <Txt colour="text" style={styles.grow}>
            {counted}
          </Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={onClose} style={styles.close}>
            <Icon name="x" size={18} />
          </Pressable>
        </View>
        <View
          testID="photo-pages"
          style={styles.grow}
          onLayout={(e) => {
            setWidth(e.nativeEvent.layout.width);
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={counted}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            go(e.nativeEvent.actionName === "increment" ? index + 1 : index - 1);
          }}
        >
          {viewing === null || width === 0 ? null : (
            <Animated.View key={viewing.listKey} style={[styles.row, { width: width * ids.length, transform: [{ translateX: at }] }]}>
              {ids.map((id) => (
                <View key={id} style={{ width, height: "100%" }}>
                  <ZoomPhoto
                    onSlide={(dx) => {
                      at.setValue(-index * width + slideDrag(dx, index, ids.length));
                    }}
                    onSlideEnd={(dx, vx) => {
                      const to = slideTo(index, dx, vx, ids.length, width);
                      // The same photo: it goes back to its place.
                      if (to === index) settle(index);
                      else onIndex(to);
                    }}
                  >
                    {photo(id)}
                  </ZoomPhoto>
                </View>
              ))}
            </Animated.View>
          )}
        </View>
        {ids.length < 2 ? null : (
          <View style={styles.dots}>
            {ids.map((id, i) => (
              <View key={id} style={[styles.dot, i === index ? styles.dotOn : null]} />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: colours.page, paddingHorizontal: sizes.edge, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1, overflow: "hidden" },
  row: { flexDirection: "row", height: "100%" },
  close: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: sizes.round, backgroundColor: colours.textFaint },
  dotOn: { backgroundColor: colours.orange },
});
