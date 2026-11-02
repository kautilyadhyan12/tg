import type { ReactNode, RefObject } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "./colours";

/** A tab's page: the near-black page, its boxes one under another. `top` is its own picture, edge to
 *  edge from the top of the phone; a page with none starts clear of the phone's own top bar. `scroller` lets the page take the person to one of its boxes (another page's
 *  button that opens "the exact place"); `onDrag` says the person has started to scroll it themselves. */
export function Page({ top, children, scroller, onDrag }: { top?: ReactNode; children: ReactNode; scroller?: RefObject<ScrollView | null>; onDrag?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView ref={scroller} style={styles.page} keyboardShouldPersistTaps="handled" onScrollBeginDrag={onDrag}>
      {top}
      <View style={[styles.boxes, { paddingTop: top === undefined ? insets.top + sizes.edge : sizes.gap }]}>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  boxes: { paddingHorizontal: sizes.edge, paddingBottom: 24, gap: sizes.gap },
});
