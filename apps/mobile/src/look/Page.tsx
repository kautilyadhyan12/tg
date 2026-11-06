import type { ReactNode, RefObject } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomRoom } from "./BottomRoom";
import { colours, sizes } from "./colours";

/** A tab's page: the near-black page, its boxes one under another. `top` is its own picture, edge to
 *  edge from the top of the phone; a page with none starts clear of the phone's own top bar. `scroller` lets the page take the person to one of its boxes (another page's
 *  button that opens "the exact place"); `onDrag` says the person has started to scroll it themselves.
 *  `room`: space kept free at its foot for what stays over the page there (the Running page's START);
 *  the run's bar, while a run is put away, keeps its own (`BottomRoom`), and the larger of the two is kept. */
export function Page({ top, children, scroller, onDrag, room = 0 }: { top?: ReactNode; children: ReactNode; scroller?: RefObject<ScrollView | null>; onDrag?: () => void; room?: number }) {
  const insets = useSafeAreaInsets();
  const below = Math.max(room, useBottomRoom());
  return (
    <ScrollView ref={scroller} style={styles.page} keyboardShouldPersistTaps="handled" onScrollBeginDrag={onDrag}>
      {top}
      <View testID="page-boxes" style={[styles.boxes, { paddingTop: top === undefined ? insets.top + sizes.edge : sizes.gap, paddingBottom: 24 + below }]}>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  boxes: { paddingHorizontal: sizes.edge, paddingBottom: 24, gap: sizes.gap },
});
