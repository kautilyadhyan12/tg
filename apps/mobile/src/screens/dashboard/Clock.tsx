import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { colours } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { clockDateWords, clockWords, msToNextSecond } from "./words";

/** The time with its seconds and the date under it, in the phone's own time zone (Kd, 2026-10-28).
 *  It keeps its own time, so each second redraws the clock alone, never the Dashboard round it. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    // Set to the next whole second each time, so it never drifts from the phone's own clock.
    const tick = () => {
      const at = new Date();
      setNow(at);
      timer = setTimeout(tick, msToNextSecond(at));
    };
    timer = setTimeout(tick, msToNextSecond(new Date()));
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const time = clockWords(now);
  const date = clockDateWords(now);
  // "10:20:11" tall, its "am" smaller beside it.
  const cut = time.lastIndexOf(" ");
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={`${time}, ${date}`} style={styles.clock}>
      <View style={styles.row}>
        <Txt style={[styles.time, styles.shadow]}>{time.slice(0, cut)}</Txt>
        <Txt style={[styles.half, styles.shadow]}>{time.slice(cut + 1)}</Txt>
      </View>
      <Txt colour="text" style={[styles.date, styles.shadow]}>
        {date}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  clock: { gap: 2 },
  row: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  // A soft shadow, so the words read where the picture brightens under them.
  shadow: { textShadowColor: colours.wordShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  // Figures of one width, so the seconds turning over never shift the line.
  time: { fontFamily: fonts.display, fontSize: 46, lineHeight: 54, letterSpacing: 0.5, color: colours.text, fontVariant: ["tabular-nums"] },
  half: { fontFamily: fonts.display, fontSize: 22, letterSpacing: 0.5, color: colours.text },
  date: { fontFamily: fonts.displayLight, fontSize: 14, lineHeight: 18, letterSpacing: 2.4, textTransform: "uppercase" },
});
