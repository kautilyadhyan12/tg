import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, shadows, sizes } from "./colours";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** The box from the bottom: a question, or a short task, over the page it was opened from. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable accessible={false} onPress={onClose} style={styles.scrim} />
      {/* Lifted over the keyboard, so a box being typed in is never under it. */}
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.lift}>
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Txt kind="h2" style={styles.title}>
              {title}
            </Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Icon name="x" size={18} />
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colours.scrim },
  lift: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
  sheet: {
    gap: 14,
    paddingTop: 10,
    paddingHorizontal: sizes.edge,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colours.lineStrong,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    boxShadow: shadows.sheet,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 999, backgroundColor: colours.grab },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1 },
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
});
