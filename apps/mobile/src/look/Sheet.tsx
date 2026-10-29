import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, shadows, sizes } from "./colours";
import { Icon } from "./Icon";
import { MIDDLE_INSET } from "./sizing";
import { Txt } from "./Txt";

/** A step back inside a box: true where it went back a step, false where it had none to go. */
type Step = () => boolean;
type Steps = { add: (depth: number, step: Step) => () => void };
const BackSteps = createContext<Steps | null>(null);

/** The phone's back button goes back one step inside the box, as Android's own apps do (Kd's
 *  click-through, 32b-ii-b: back from a dish's Edit closed the whole box). `depth` says how deep the
 *  step sits: the deepest step that can go back does, and the box closes only where none can. */
export function useSheetBack(depth: number, step: Step): void {
  const steps = useContext(BackSteps);
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => (steps === null ? undefined : steps.add(depth, () => latest.current())), [steps, depth]);
}

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** "middle": a box in the middle of the screen, for a thing to be shown rather than answered (the pass). */
  place?: "bottom" | "middle";
  /** The box's own step back, after any deeper one (`useSheetBack`): true where it went back a step. */
  onBack?: () => boolean;
}

/** The box from the bottom, or in the middle (`place`): a question, or a short task, over the page it
 *  was opened from. */
export function Sheet({ open, title, onClose, children, place = "bottom", onBack }: SheetProps) {
  const middle = place === "middle";
  const insets = useSafeAreaInsets();
  const registered = useRef<{ depth: number; step: Step }[]>([]);
  const steps = useMemo<Steps>(
    () => ({
      add: (depth, step) => {
        const entry = { depth, step };
        registered.current.push(entry);
        return () => {
          registered.current = registered.current.filter((e) => e !== entry);
        };
      },
    }),
    [],
  );
  const back = useCallback(() => {
    const deepest = [...registered.current].sort((a, b) => b.depth - a.depth);
    if (deepest.some((e) => e.step()) || onBack?.() === true) return;
    onClose();
  }, [onClose, onBack]);
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={back}
      testID="sheet"
    >
      <Pressable accessible={false} onPress={onClose} style={styles.scrim} />
      {/* Lifted over the keyboard, so a box being typed in is never under it. */}
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={[styles.lift, middle ? styles.liftMiddle : null]}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, middle ? styles.sheetMiddle : { paddingBottom: insets.bottom + 24 }]}
        >
          {middle ? null : <View style={styles.grab} />}
          <View style={styles.head}>
            <Txt kind="h2" style={styles.title}>
              {title}
            </Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Icon name="x" size={18} />
            </Pressable>
          </View>
          <BackSteps.Provider value={steps}>{children}</BackSteps.Provider>
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
  liftMiddle: { justifyContent: "center", paddingHorizontal: sizes.edge },
  sheetMiddle: { paddingTop: 16, paddingBottom: 20, paddingHorizontal: MIDDLE_INSET - sizes.edge, borderBottomWidth: 1, borderRadius: 24 },
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
