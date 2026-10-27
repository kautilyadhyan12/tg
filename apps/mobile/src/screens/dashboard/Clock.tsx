import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
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
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={`${time}, ${date}`} style={styles.clock}>
      <Txt kind="h1" style={styles.time}>
        {time}
      </Txt>
      <Txt kind="small">{date}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  clock: { gap: 2 },
  // Figures of one width, so the seconds turning over never shift the line.
  time: { fontFamily: fonts.bold, fontVariant: ["tabular-nums"] },
});
