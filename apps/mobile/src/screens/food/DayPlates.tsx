import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { colours, sizes, type ColourName } from "../../look/colours";
import { Fork, Knife } from "../../look/Cutlery";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { addDays, dayWords, sameDay, startOfDay } from "./day";
import { plateShare, slicePath } from "./plateRules";
import { localDayKey, type Bar } from "./weekRules";

// The days as plates (32c-i, Kd's drawing of 2026-11-14: "some cutlery"): this week's days across the top of
// the Food tab, each a small plate filled as far as that day's calories went, in the week's own colours;
// the day shown is an orange plate with its fork and knife. The same plates in Pick a day.

const BAND_COLOUR: Record<NonNullable<Bar["band"]>, ColourName> = { on: "good", under: "blue", over: "orange" };
const BAND_SAID: Record<NonNullable<Bar["band"]>, string> = { on: "on target", under: "under target", over: "over target" };

/** The colour a day's plate is filled with: the week's own, and a day not judged (today, or no target) soft. */
export function plateColour(bar: Bar | undefined): ColourName {
  if (bar === undefined || bar.band === null) return "textSoft";
  return BAND_COLOUR[bar.band];
}

/** One day's plate. `picked`: the day the page shows, orange, with its fork and knife. */
export function DayPlate({ date, size, bar, picked, later }: { date: number; size: number; bar?: Bar | undefined; picked: boolean; later: boolean }) {
  const half = size / 2;
  const rim = half - 0.5;
  const well = half * 0.74;
  const words = String(date);
  if (picked) {
    return (
      <View style={styles.set}>
        <Fork height={size - 2} />
        <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} accessible={false}>
          <Defs>
            <LinearGradient id={`picked${words}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colours.orangeLight} />
              <Stop offset="1" stopColor={colours.orangeDeep} />
            </LinearGradient>
          </Defs>
          <Circle cx={half} cy={half} r={rim} fill={colours.plateRim} stroke={colours.plateEdge} />
          <Circle cx={half} cy={half} r={well} fill={`url(#picked${words})`} />
        </Svg>
          <Number words={words} size={size} colour="onOrange" />
        </View>
        <Knife height={size - 2} />
      </View>
    );
  }
  const share = bar === undefined ? 0 : bar.band === "over" ? 1 : plateShare(bar.value, bar.target ?? 0);
  const slice = slicePath(half, half, well - 1, share);
  const fill = colours[plateColour(bar)];
  return (
    <View style={{ width: size, height: size }}>
    <Svg width={size} height={size} accessible={false}>
      <Circle cx={half} cy={half} r={rim} fill={colours.plateRim} stroke={colours.plateEdge} />
      <Path d={`M${String(half * 0.26)},${String(half * 0.7)} A${String(rim * 0.8)},${String(rim * 0.8)} 0 0 1 ${String(half * 0.7)},${String(half * 0.26)}`} stroke={colours.plateRimLight} strokeWidth={1.3} strokeLinecap="round" fill="none" />
      <Circle cx={half} cy={half} r={well} fill={colours.plateWell} stroke={colours.scrim} />
      {slice.kind === "whole" ? <Circle cx={half} cy={half} r={well - 1} fill={fill} fillOpacity={0.9} /> : null}
      {slice.kind === "slice" ? <Path d={slice.d} fill={fill} fillOpacity={0.9} /> : null}
    </Svg>
      <Number words={words} size={size} colour={later ? "textFaint" : "text"} />
    </View>
  );
}

/** A plate's date, over its middle. */
function Number({ words, size, colour }: { words: string; size: number; colour: ColourName }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.centre]} pointerEvents="none">
      <Txt colour={colour} numberOfLines={1} fit style={[styles.date, { fontSize: size * 0.36, lineHeight: size * 0.46, maxWidth: size * 0.7 }]}>
        {words}
      </Txt>
    </View>
  );
}

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** Monday of the week a day is in: the week starts on Monday, as Pick a day's does. */
export function weekOf(day: Date): Date[] {
  const start = addDays(startOfDay(day), -((day.getDay() + 6) % 7));
  return LETTERS.map((_, i) => addDays(start, i));
}

/** The day the page shows, a step either way, and Pick a day; then the week of plates. */
export function DayPlates({ day, bars, onGo, onPick }: { day: Date; bars: ReadonlyMap<string, Bar>; onGo: (day: Date) => void; onPick: () => void }) {
  const now = new Date();
  const today = sameDay(day, now);
  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${dayWords(day, now)}, pick a day`}
          onPress={onPick}
          style={({ pressed }) => [styles.dayWords, pressed ? styles.pressed : null]}
        >
          <Icon name="calendar" size={16} colour="orange" />
          <Txt kind="h3">{dayWords(day, now)}</Txt>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => { onGo(addDays(day, -1)); }} style={styles.arrow}>
          <Icon name="back" size={18} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={today ? "This is today" : "Next day"}
          accessibilityState={{ disabled: today }}
          disabled={today}
          onPress={() => { onGo(addDays(day, 1)); }}
          style={[styles.arrow, today ? styles.dim : null]}
        >
          <Icon name="go" size={18} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {weekOf(day).map((d, i) => {
          const later = d.getTime() > startOfDay(now).getTime();
          const picked = sameDay(d, day);
          const bar = bars.get(localDayKey(d));
          const said = bar?.band === undefined || bar.band === null ? "" : `, ${BAND_SAID[bar.band]}`;
          return (
            <Pressable
              key={localDayKey(d)}
              accessibilityRole="button"
              accessibilityLabel={`${dayWords(d, now)}${said}`}
              accessibilityState={{ disabled: later, selected: picked }}
              disabled={later || picked}
              onPress={() => { onGo(d); }}
              style={styles.day}
            >
              <Txt kind="tiny" colour={picked ? "orange" : "textFaint"}>
                {LETTERS[i] ?? ""}
              </Txt>
              <DayPlate date={d.getDate()} size={34} bar={bar} picked={picked} later={later} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  dayWords: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: sizes.press },
  arrow: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  week: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  day: { alignItems: "center", gap: 6, minHeight: sizes.press },
  set: { flexDirection: "row", alignItems: "center", gap: 2 },
  centre: { alignItems: "center", justifyContent: "center" },
  date: { fontFamily: fonts.bold, textShadowColor: colours.wordShadow, textShadowRadius: 3 },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.4 },
});
