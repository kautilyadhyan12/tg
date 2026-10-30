import { useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";

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
  const list = useRef<FlatList<string>>(null);
  const go = (to: number) => {
    if (to < 0 || to >= ids.length) return;
    onIndex(to);
    list.current?.scrollToIndex({ index: to, animated: true });
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
            <FlatList
              key={viewing.listKey}
              ref={list}
              data={ids}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(id) => id}
              initialScrollIndex={index}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              onMomentumScrollEnd={(e) => {
                onIndex(Math.round(e.nativeEvent.contentOffset.x / width));
              }}
              renderItem={({ item }) => <View style={{ width, height: "100%" }}>{photo(item)}</View>}
            />
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
  grow: { flex: 1 },
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
