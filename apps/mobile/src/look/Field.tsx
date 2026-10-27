import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { colours, shadows, sizes } from "./colours";
import { fonts, Txt } from "./Txt";

interface FieldProps {
  /** Above the box, and what a screen reader calls it. */
  label: string;
  /** No words above the box: its own faint words say what goes in it. */
  bare?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboard?: TextInputProps["keyboardType"];
  /** What the phone may offer to fill in: its saved email, or a code from a message. */
  fills?: TextInputProps["autoComplete"];
  maxLength?: number;
  /** Wide-set digits, for a code. */
  spaced?: boolean;
  /** Opens with the keyboard up: the one thing this step is for. */
  ready?: boolean;
  onDone?: () => void;
  /** A person's name: each word starts with a capital. */
  name?: boolean;
}

/** One line to type in, as tall as a main button; its edge turns orange while it is typed in.
 *  The box is a View round the input: Android drops an input's own padding when its edge is restyled. */
export function Field({ label, bare = false, value, onChange, placeholder, keyboard, fills, maxLength, spaced = false, ready = false, onDone, name = false }: FieldProps) {
  const [on, setOn] = useState(false);
  return (
    <View style={styles.field}>
      {bare ? null : (
        <Txt kind="tiny" style={styles.label}>
          {label}
        </Txt>
      )}
      <View style={[styles.box, on ? styles.on : null]}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colours.textFaint}
          keyboardType={keyboard}
          autoComplete={fills}
          autoCapitalize={name ? "words" : "none"}
          autoCorrect={false}
          maxLength={maxLength}
          autoFocus={ready}
          onSubmitEditing={onDone}
          onFocus={() => {
            setOn(true);
          }}
          onBlur={() => {
            setOn(false);
          }}
          selectionColor={colours.orange}
          style={[styles.input, spaced && value !== "" ? styles.spaced : null]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  box: {
    height: sizes.button,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.fieldLine,
    backgroundColor: colours.field,
    paddingHorizontal: 16,
  },
  input: { height: sizes.button - 2, padding: 0, color: colours.text, fontFamily: fonts.regular, fontSize: 15 },
  on: { borderColor: colours.fieldOnLine, backgroundColor: colours.fieldOn, boxShadow: shadows.fieldOn },
  spaced: { fontSize: 18, letterSpacing: 7 },
});
