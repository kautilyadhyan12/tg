import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "./colours";

/** A tab's page: the near-black page, its boxes one under another. `top` is its own picture, edge to
 *  edge from the top of the phone; a page with none starts clear of the phone's own top bar. */
export function Page({ top, children }: { top?: ReactNode; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.page} keyboardShouldPersistTaps="handled">
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
