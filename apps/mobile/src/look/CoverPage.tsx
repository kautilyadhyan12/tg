import type { ReactNode } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Modal } from "./Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "./colours";
import { Icon } from "./Icon";
import type { PictureName } from "./pictures";
import { PictureTop } from "./PictureTop";
import { Txt } from "./Txt";

interface CoverPageProps {
  open: boolean;
  /** The bar's small title. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Held at the bottom while the page scrolls: the page's one action. */
  foot?: ReactNode;
  /** The page's own picture across its top, the title over it and the ✕ on it, in place of the bar. */
  picture?: PictureName;
}

/** A page that opens over the tab for one task, closed by its ✕, its action held at the bottom. */
export function CoverPage({ open, title, onClose, children, foot, picture }: CoverPageProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView accessibilityViewIsModal behavior="padding" style={styles.page}>
        {picture === undefined ? (
          <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Icon name="x" size={20} />
            </Pressable>
            <Txt kind="h3" numberOfLines={1} style={styles.title}>
              {title}
            </Txt>
            <View style={styles.close} />
          </View>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, picture === undefined ? null : styles.underPicture]}>
          {picture === undefined ? null : (
            <View style={styles.bleed}>
              <PictureTop picture={picture} tall={0.62} title={title} />
            </View>
          )}
          {children}
        </ScrollView>
        {picture === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={[styles.close, styles.onPicture, { top: insets.top + 8 }]}
          >
            <Icon name="x" size={20} />
          </Pressable>
        )}
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
  underPicture: { paddingTop: 0, gap: 16 },
  bleed: { marginHorizontal: -sizes.edge },
  onPicture: { position: "absolute", left: 8, backgroundColor: colours.veil },
  foot: {
    gap: 6,
    paddingTop: 12,
    paddingHorizontal: sizes.edge,
    borderTopWidth: 1,
    borderTopColor: colours.line,
    backgroundColor: colours.page,
  },
});
