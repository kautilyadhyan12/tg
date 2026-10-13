import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "./colours";

/** A tab's page: the near-black page, its boxes one under another, clear of the phone's own top bar. */
export function Page({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.boxes, { paddingTop: insets.top + sizes.edge }]}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  boxes: { paddingHorizontal: sizes.edge, paddingBottom: 24, gap: sizes.gap },
});
