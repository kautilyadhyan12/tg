import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { colours, sizes, type ColourName } from "../../look/colours";
import { Fork, Knife } from "../../look/Cutlery";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { addDays, dayWords, monthWords, sameDay, startOfDay } from "./day";
import type { FoodBand } from "@app/shared";
import { slicePath } from "./plateRules";
import { dayFill, localDayKey, type Bar } from "./weekRules";

// The days as plates (32c-i, Kd's drawing of 2026-11-14: "some cutlery"): this week's days across the top of
// the Food tab, each a small plate filled as far as that day's calories went, in the week's own colours;
// the day shown is an orange plate with its fork and knife. The same plates in Pick a day.

/** The week's colours; a day not judged (today so far, or no target) soft. */
const FILL_COLOUR: Record<FoodBand | "open", ColourName> = { on: "good", under: "blue", over: "orange", open: "textSoft" };
const BAND_SAID: Record<NonNullable<Bar["band"]>, string> = { on: "on target", under: "under target", over: "over target" };

/** One day's plate. `picked`: the day the page shows, orange, with its fork and knife. `bar`: the day's
 *  reading; undefined where none was read (the plate is drawn as not known), null where none is asked
 *  (Pick a day). `today`: its date in orange. */
export function DayPlate({ date, size, bar, picked, later, today = false }: { date: number; size: number; bar: Bar | null | undefined; picked: boolean; later: boolean; today?: boolean }) {
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
  const fill = dayFill(bar);
  const numberColour: ColourName = later ? "textFaint" : today ? "orange" : fill.kind === "unknown" ? "textSoft" : "text";
  if (fill.kind === "unknown") {
    // Not read: a dashed rim and no well, never the look of a day with nothing eaten.
    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} accessible={false}>
          <Circle cx={half} cy={half} r={rim - 1} fill="none" stroke={colours.textFaint} strokeWidth={1.4} strokeDasharray="3 3" />
        </Svg>
        <Number words={words} size={size} colour={numberColour} />
      </View>
    );
  }
  const slice = slicePath(half, half, well - 1, fill.kind === "fill" ? fill.share : 0);
  const paint = colours[fill.kind === "fill" ? FILL_COLOUR[fill.band] : "textSoft"];
  const strength = fill.kind === "fill" && fill.band === "open" ? 0.45 : 0.9;
  return (
    <View style={{ width: size, height: size }}>
    <Svg width={size} height={size} accessible={false}>
      <Circle cx={half} cy={half} r={rim} fill={colours.plateRim} stroke={colours.plateEdge} />
      <Path d={`M${String(half * 0.26)},${String(half * 0.7)} A${String(rim * 0.8)},${String(rim * 0.8)} 0 0 1 ${String(half * 0.7)},${String(half * 0.26)}`} stroke={colours.plateRimLight} strokeWidth={1.3} strokeLinecap="round" fill="none" />
      <Circle cx={half} cy={half} r={well} fill={colours.plateWell} stroke={colours.scrim} />
      {slice.kind === "whole" ? <Circle cx={half} cy={half} r={well - 1} fill={paint} fillOpacity={strength} /> : null}
      {slice.kind === "slice" ? <Path d={slice.d} fill={paint} fillOpacity={strength} /> : null}
    </Svg>
      <Number words={words} size={size} colour={numberColour} />
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
      {/* As drawn: the month, and Pick a day; the arrows a day back and on are kept beside it. */}
      <View style={styles.head}>
        <Txt kind="h3" style={styles.month}>
          {monthWords(day)}
        </Txt>
        <View style={styles.steps}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => { onGo(addDays(day, -1)); }} style={styles.arrow}>
            <Icon name="back" size={16} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${dayWords(day, now)}, pick a day`}
            onPress={onPick}
            style={({ pressed }) => [styles.pick, pressed ? styles.pressed : null]}
          >
            <Icon name="calendar" size={16} colour="orange" />
            <Txt kind="small" colour="orange" style={styles.pickWords}>
              Pick a day
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={today ? "This is today" : "Next day"}
            accessibilityState={{ disabled: today }}
            disabled={today}
            onPress={() => { onGo(addDays(day, 1)); }}
            style={[styles.arrow, today ? styles.dim : null]}
          >
            <Icon name="go" size={16} />
          </Pressable>
        </View>
      </View>
      <View style={styles.week}>
        {weekOf(day).map((d, i) => {
          const later = d.getTime() > startOfDay(now).getTime();
          const picked = sameDay(d, day);
          // A day to come has no reading to know: a plain, faded plate, never the "not known" one.
          const bar = later ? null : bars.get(localDayKey(d));
          const said = bar === undefined || bar === null ? "" : bar.band !== null ? `, ${BAND_SAID[bar.band]}` : bar.value !== null && bar.target === null ? ", no target" : "";
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
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  month: { flexShrink: 1 },
  steps: { flexDirection: "row", alignItems: "center", borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.fill },
  arrow: { width: sizes.press, height: sizes.press, borderRadius: sizes.round, alignItems: "center", justifyContent: "center" },
  pick: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: sizes.press, paddingHorizontal: 6 },
  pickWords: { fontFamily: fonts.semibold },
  week: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  day: { alignItems: "center", gap: 6, minHeight: sizes.press },
  set: { flexDirection: "row", alignItems: "center", gap: 2 },
  centre: { alignItems: "center", justifyContent: "center" },
  date: { fontFamily: fonts.bold, textShadowColor: colours.wordShadow, textShadowRadius: 3 },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.4 },
});
