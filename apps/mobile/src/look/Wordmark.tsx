import { StyleSheet, View } from "react-native";
import { colours, shadows } from "./colours";
import { fonts, Txt } from "./Txt";

/** The app's name as Kd's posters write it: heavy, slanted, black with its Z orange, on a white pill so it
 *  reads over a bright picture. A screen reader says the name once. */
export function Wordmark() {
  return (
    <View style={styles.pill} accessible accessibilityRole="image" accessibilityLabel="KWAZO">
      {/* Slanted as the posters write it: the font has no slanted letters, so the phone leans them. */}
      <View style={styles.slant}>
        <Txt colour="brandInk" style={styles.name}>
          KWA
        </Txt>
        <Txt colour="orange" style={styles.name}>
          Z
        </Txt>
        <Txt colour="brandInk" style={styles.name}>
          O
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colours.brandPill,
    boxShadow: shadows.lightButton,
  },
  slant: { flexDirection: "row" },
  name: { fontFamily: fonts.bold, fontStyle: "italic", fontWeight: "bold", fontSize: 22, lineHeight: 28, letterSpacing: 0.5 },
});
