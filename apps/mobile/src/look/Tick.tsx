import { Pressable, StyleSheet, View } from "react-native";
import { colours, orangeGradient, sizes } from "./colours";
import { Icon } from "./Icon";
import { fonts, Txt } from "./Txt";

interface TickProps {
  label: string;
  ticked: boolean;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}

/** A box to tick, with its words beside it; the whole row takes the press. */
export function Tick({ label, ticked, onPress, disabled = false, busy = false, testID }: TickProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: ticked, disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={styles.row}
    >
      <View testID={testID} style={[styles.box, ticked ? styles.on : null]}>
        {ticked ? <Icon name="check" size={13} colour="onOrange" /> : null}
      </View>
      <Txt colour={ticked ? "text" : "textSoft"} style={styles.label}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.press },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colours.textFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  on: { borderColor: colours.orange, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
});
