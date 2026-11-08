import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { colours, shadows } from "./colours";
import { MOST_TEXT_GROWTH } from "./sizing";
import { fonts, Txt } from "./Txt";

/** How tall each of the six boxes is drawn; it grows with the phone's largest text. */
const BOX = 56;

interface CodeBoxesProps {
  /** What a screen reader calls it. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  length: number;
  onDone?: () => void;
}

/** A code as one white box for each digit (on sign-in's orange box), the next one ringed dark. Under them lies one ordinary input, unseen, so typing,
 *  pasting and the phone's offer of a code from a message work as in any box. */
export function CodeBoxes({ label, value, onChange, length, onDone }: CodeBoxesProps) {
  const [on, setOn] = useState(false);
  const digits = Array.from({ length }, (_, at) => value[at] ?? "");
  const next = Math.min(value.length, length - 1);
  return (
    <View style={styles.row}>
      {digits.map((digit, at) => (
        <View key={at} style={[styles.box, on && at === next ? styles.lit : null]}>
          {on && at === next && digit === "" ? <View style={styles.caret} /> : <Txt style={styles.digit}>{digit}</Txt>}
        </View>
      ))}
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus
        caretHidden
        contextMenuHidden={false}
        maxFontSizeMultiplier={MOST_TEXT_GROWTH}
        onSubmitEditing={onDone}
        onFocus={() => {
          setOn(true);
        }}
        onBlur={() => {
          setOn(false);
        }}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  box: {
    flex: 1,
    minHeight: BOX,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.light,
    backgroundColor: colours.light,
    alignItems: "center",
    justifyContent: "center",
  },
  lit: { borderColor: colours.darkButton, borderWidth: 2, boxShadow: shadows.darkButton },
  caret: { width: 2, height: 24, borderRadius: 1, backgroundColor: colours.orange },
  digit: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, color: colours.onLight },
  // Over the boxes and unseen: a press anywhere on them opens the keyboard.
  input: { position: "absolute", top: 0, left: 0, right: 0, height: BOX, opacity: 0.02, color: colours.text },
});
