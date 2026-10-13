import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { colours, sizes } from "./colours";
import { fonts, Txt } from "./Txt";

interface FieldProps {
  /** Above the box, and what a screen reader calls it. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboard?: TextInputProps["keyboardType"];
  /** What the phone may offer to fill in: its saved email, or a code from a message. */
  fills?: TextInputProps["autoComplete"];
  maxLength?: number;
  /** Wide-set digits, for a code. */
  spaced?: boolean;
  onDone?: () => void;
}

/** One line to type in, as tall as a main button. */
export function Field({ label, value, onChange, placeholder, keyboard, fills, maxLength, spaced = false, onDone }: FieldProps) {
  return (
    <View style={styles.field}>
      <Txt kind="tiny" style={styles.label}>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colours.textFaint}
        keyboardType={keyboard}
        autoComplete={fills}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={maxLength}
        onSubmitEditing={onDone}
        selectionColor={colours.orange}
        style={[styles.box, spaced ? styles.spaced : null]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  box: {
    height: sizes.button,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.field,
    color: colours.text,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  spaced: { fontSize: 18, letterSpacing: 7 },
});
