import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "./colours";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

interface CoverPageProps {
  open: boolean;
  /** The bar's small title. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Held at the bottom while the page scrolls: the page's one action. */
  foot?: ReactNode;
}

/** A page that opens over the tab for one task, closed by its ✕, its action held at the bottom. */
export function CoverPage({ open, title, onClose, children, foot }: CoverPageProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView accessibilityViewIsModal behavior="padding" style={styles.page}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Icon name="x" size={20} />
          </Pressable>
          <Txt kind="h3" numberOfLines={1} style={styles.title}>
            {title}
          </Txt>
          <View style={styles.close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {children}
        </ScrollView>
        {foot === undefined ? null : <View style={[styles.foot, { paddingBottom: insets.bottom + 12 }]}>{foot}</View>}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  close: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center", borderRadius: sizes.round },
  title: { flex: 1, textAlign: "center" },
  body: { paddingHorizontal: sizes.edge, paddingTop: 8, paddingBottom: 24, gap: 24 },
  foot: {
    gap: 6,
    paddingTop: 12,
    paddingHorizontal: sizes.edge,
    borderTopWidth: 1,
    borderTopColor: colours.line,
    backgroundColor: colours.page,
  },
});
