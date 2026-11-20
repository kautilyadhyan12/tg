import { exerciseRecordsSchema, type ExerciseRecords, type PhoneLibraryEntry } from "@app/shared";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Button } from "../../look/Button";
import { colours, type ColourName } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import {
  BAR_LIGHTS,
  barsOf,
  clockWords,
  dayOf,
  holdWords,
  leadOf,
  loadedBar,
  oneRepMaxGrams,
  PLATE_GAP,
  PLATE_SIZE,
  recordsPath,
  SLEEVE_ROOM,
  weightParts,
  wholeWeight,
  type Bar,
  type Lead,
  type PlateKg,
  type Units,
} from "../../library/records";
import { useRead } from "../dashboard/useRead";

// Your records on an exercise's page (ROADMAP Stage 5 63c, Kd's drawing of 2026-11-20): the gym's own things, each in
// its own colours. Heaviest as the loaded bar, its plates in the standard colours adding up to the weight, and the
// estimated one-rep max as outlined plates beyond them; most reps, best volume and longest hold lit on the LED wall
// timer; the person's last times as the timer's bars, the record day in red. Read from the server, the person's own.

/** Your records, or one line where there are none yet; nothing while they are read (no empty box first). */
export function Records({ entry, units }: { entry: PhoneLibraryEntry; units: Units }) {
  const { read, again } = useRead(recordsPath(entry.id), exerciseRecordsSchema);
  if (read.kind === "loading") return null;
  if (read.kind === "failed") {
    return (
      <View style={styles.line}>
        <Txt kind="small" style={styles.grow}>
          Your records couldn’t load.
        </Txt>
        <Button label="Try again" kind="link" say="Load your records again" onPress={again} />
      </View>
    );
  }
  const r = read.data;
  const lead = leadOf(entry.set.measuredIn === "time" ? "time" : "reps", r);
  if (lead === null) {
    return (
      <View style={styles.words}>
        <Txt kind="eyebrow">Your records</Txt>
        <Txt kind="small">{entry.set.measuredIn === "time" ? "Your best hold shows here after your first workout." : "Your best set shows here after your first workout."}</Txt>
      </View>
    );
  }
  const bars = barsOf(lead, r);
  return (
    <View style={styles.box} testID="records">
      <View style={styles.words}>
        <Txt kind="eyebrow">Your records</Txt>
        {r.limitedToDays === null ? null : <Txt kind="small">{`From your last ${String(r.limitedToDays)} days`}</Txt>}
      </View>
      {lead === "heaviest" ? <Heaviest entry={entry} r={r} units={units} /> : null}
      <Timer r={r} lead={lead} units={units} />
      {bars.length === 0 ? null : <Bars lead={lead} bars={bars} units={units} />}
    </View>
  );
}

/** Heaviest, and the bar loaded with it where one can be drawn truly. */
function Heaviest({ entry, r, units }: { entry: PhoneLibraryEntry; r: ExerciseRecords; units: Units }) {
  const heaviest = r.reps.heaviest;
  if (heaviest === null || heaviest.weightGrams === null) return null;
  const orm = oneRepMaxGrams(r);
  const bar = loadedBar(entry, units, heaviest.weightGrams, orm);
  return (
    <>
      <View style={styles.barWords}>
        <View style={styles.grow} accessible accessibilityLabel={`Heaviest, ${weightParts(heaviest.weightGrams, units).join(" ")} for ${String(heaviest.done)} reps, ${dayOf(r, heaviest.workoutId)}`}>
          <Txt kind="small">{`Heaviest · ${dayOf(r, heaviest.workoutId)}`}</Txt>
          <View style={styles.inline}>
            <Txt kind="big">{weightParts(heaviest.weightGrams, units).join(" ")}</Txt>
            <Txt kind="small">{` × ${String(heaviest.done)} ${heaviest.done === 1 ? "rep" : "reps"}`}</Txt>
          </View>
        </View>
        {orm === null ? null : (
          <View style={styles.end} accessible accessibilityLabel={`One-rep max, an estimate, about ${weightParts(orm, units).join(" ")}`}>
            <Txt kind="small">One-rep max</Txt>
            <Txt kind="strong" colour="textSoft">{`≈ ${weightParts(orm, units).join(" ")}`}</Txt>
          </View>
        )}
      </View>
      {bar === null ? null : (
        <>
          <LoadedBar side={bar.side} extra={bar.extra} />
          {bar.extra.length === 0 ? null : (
            <View style={styles.key}>
              <View style={styles.keyOne}>
                <View style={[styles.keyMark, styles.keyLifted]} />
                <Txt kind="tiny" colour="textSoft">Lifted</Txt>
              </View>
              <View style={styles.keyOne}>
                <View style={[styles.keyMark, styles.keyEstimate]} />
                <Txt kind="tiny" colour="textSoft">Estimated one-rep max</Txt>
              </View>
            </View>
          )}
        </>
      )}
    </>
  );
}

const PLATE_COLOUR: Readonly<Record<PlateKg, ColourName>> = {
  25: "plateRed",
  20: "plateBlue",
  15: "plateYellow",
  10: "plateGreen",
  5: "plateWhite",
  2.5: "plateRed",
  2: "plateBlue",
  1.5: "plateYellow",
  1.25: "plateChrome",
  1: "plateGreen",
  0.5: "plateWhite",
};

/** A box with round corners as a path, as the Food tab's jars draw theirs. */
function box(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return `M${n(x + k)},${n(y)} H${n(x + w - k)} A${n(k)},${n(k)} 0 0 1 ${n(x + w)},${n(y + k)} V${n(y + h - k)} A${n(k)},${n(k)} 0 0 1 ${n(x + w - k)},${n(y + h)} H${n(x + k)} A${n(k)},${n(k)} 0 0 1 ${n(x)},${n(y + h - k)} V${n(y + k)} A${n(k)},${n(k)} 0 0 1 ${n(x + k)},${n(y)} Z`;
}

const BAR_W = 300;
const BAR_H = 82;
/** How tall the loaded bar is drawn: a place kept for it stays this tall when no bar can be drawn. */
export const LOADED_BAR_HEIGHT = BAR_H;

/** A standard bar seen from the front: what was lifted as plates a side from each collar outwards, the estimate's
 *  extra as outlined plates beyond them. */
export function LoadedBar({ side, extra }: { side: readonly PlateKg[]; extra: readonly PlateKg[] }) {
  const mid = BAR_H / 2;
  const plates: { key: string; x: number; p: PlateKg; ghost: boolean; left: boolean }[] = [];
  for (const left of [true, false]) {
    let x = left ? SLEEVE_ROOM : BAR_W - SLEEVE_ROOM;
    for (const [list, ghost] of [[side, false], [extra, true]] as const) {
      list.forEach((p, i) => {
        const { thick } = PLATE_SIZE[p];
        plates.push({ key: `${left ? "l" : "r"}${ghost ? "g" : "s"}${String(i)}`, x: left ? x - thick : x, p, ghost, left });
        x += (left ? -1 : 1) * (thick + PLATE_GAP);
      });
    }
  }
  const said = side.length === 0 ? "An empty 20 kilogram bar" : `A bar loaded with ${side.map(String).join(", ")} kilogram plates a side`;
  return (
    <View accessible accessibilityLabel={said} testID="loaded-bar">
      <Svg width="100%" height={BAR_H} viewBox={`0 0 ${String(BAR_W)} ${String(BAR_H)}`}>
        <Path d={box(86, mid - 2.5, BAR_W - 172, 5, 2.5)} fill={colours.barSteel} />
        <Path d={box(2, mid - 4.5, 78, 9, 3)} fill={colours.barSleeve} />
        <Path d={box(BAR_W - 80, mid - 4.5, 78, 9, 3)} fill={colours.barSleeve} />
        <Path d={box(78, mid - 10, 9, 20, 2.5)} fill={colours.barCollar} />
        <Path d={box(BAR_W - 87, mid - 10, 9, 20, 2.5)} fill={colours.barCollar} />
        {plates.map(({ key, x, p, ghost }) => {
          const { height, thick } = PLATE_SIZE[p];
          const colour = PLATE_COLOUR[p];
          return ghost ? (
            <Path key={key} testID="plate-estimate" d={box(x + 1, mid - height / 2 + 1, thick - 2, height - 2, 2.5)} fill={colours[colour]} fillOpacity={0.14} stroke={colours[colour]} strokeWidth={2} strokeDasharray="4 3" />
          ) : (
            <Path key={key} testID="plate-lifted" d={box(x, mid - height / 2, thick, height, 2.5)} fill={colours[colour]} />
          );
        })}
        {plates
          .filter((pl) => !pl.ghost)
          .map(({ key, x, p, left }) => {
            const { height, thick } = PLATE_SIZE[p];
            return <Path key={`${key}e`} d={box(left ? x : x + thick - 2.5, mid - height / 2 + 3, 2.5, height - 6, 1)} fill={colours.plateSide} />;
          })}
      </Svg>
    </View>
  );
}

const DIGITS: Readonly<Record<string, string>> = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };

/** Digits as an LED wall timer lights them, seven segments each, the unlit ones faintly there. Digits, "-", ":" and ".". */
export function Led({ text, colour, height }: { text: string; colour: ColourName; height: number }) {
  const w = height * 0.52;
  const t = Math.max(3, height * 0.12);
  const gap = height * 0.2;
  const r = t / 2;
  const half = height / 2;
  const on = colours[colour];
  const parts: { key: string; x: number; y: number; w: number; h: number; lit: boolean }[] = [];
  const dots: { key: string; cx: number; cy: number }[] = [];
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === ":") {
      dots.push({ key: `${String(i)}a`, cx: x + r, cy: height * 0.3 }, { key: `${String(i)}b`, cx: x + r, cy: height * 0.7 });
      x += t + gap * 0.7;
      continue;
    }
    if (ch === ".") {
      dots.push({ key: String(i), cx: x + r, cy: height - r });
      x += t + gap * 0.5;
      continue;
    }
    const lit = DIGITS[ch] ?? "";
    const across = w - 2 * t + 2;
    const down = half - t * 1.5 + 1;
    const seg = (k: string, sx: number, sy: number, sw: number, sh: number) => {
      parts.push({ key: `${String(i)}${k}`, x: sx, y: sy, w: sw, h: sh, lit: lit.includes(k) });
    };
    seg("a", x + t - 1, 0, across, t);
    seg("g", x + t - 1, half - r, across, t);
    seg("d", x + t - 1, height - t, across, t);
    seg("f", x, t - 0.5, t, down);
    seg("b", x + w - t, t - 0.5, t, down);
    seg("e", x, half + r - 0.5, t, down);
    seg("c", x + w - t, half + r - 0.5, t, down);
    x += w + gap;
  }
  const width = Math.max(1, x - gap);
  return (
    <Svg width={width} height={height} accessible={false}>
      {parts.map((p) => (
        <Path key={p.key} d={box(p.x, p.y, p.w, p.h, r)} fill={p.lit ? on : colours.ledOff} />
      ))}
      {dots.map((d) => (
        <Circle key={d.key} cx={d.cx} cy={d.cy} r={r} fill={on} />
      ))}
    </Svg>
  );
}

interface Cell {
  label: string;
  digits: string;
  unit: string | null;
  under: string;
  colour: ColourName;
}

/** The timer's cells: most reps and best volume beside the bar, or the one record that leads. */
function cellsOf(r: ExerciseRecords, lead: Lead, units: Units): Cell[] {
  const cells: Cell[] = [];
  const most = r.reps.mostReps;
  if (most !== null && (lead === "heaviest" || lead === "mostReps")) {
    const at = most.weightGrams === null ? null : weightParts(most.weightGrams, units).join(" ");
    cells.push({ label: "Most reps", digits: String(most.done), unit: lead === "mostReps" ? "reps" : null, under: at === null ? `in one set · ${dayOf(r, most.workoutId)}` : `at ${at} · ${dayOf(r, most.workoutId)}`, colour: "ledRed" });
  }
  const lifted = r.reps.mostLifted;
  if (lifted !== null && lead === "heaviest") {
    const [n, unit] = wholeWeight(lifted.grams, units);
    cells.push({ label: "Best volume", digits: n, unit, under: `all sets · ${dayOf(r, lifted.workoutId)}`, colour: "ledAmber" });
  }
  const hold = r.time.longestHold;
  if (hold !== null && lead === "longestHold") {
    cells.push({ label: "Longest hold", digits: clockWords(hold.done), unit: null, under: dayOf(r, hold.workoutId), colour: "ledGreen" });
    const held = r.time.heaviest;
    if (held !== null && held.weightGrams !== null) {
      const [n, unit] = weightParts(held.weightGrams, units);
      cells.push({ label: "Heaviest held", digits: n, unit, under: dayOf(r, held.workoutId), colour: "ledAmber" });
    }
  }
  return cells;
}

function Timer({ r, lead, units }: { r: ExerciseRecords; lead: Lead; units: Units }) {
  const cells = cellsOf(r, lead, units);
  if (cells.length === 0) return null;
  const one = cells.length === 1;
  return (
    <View style={[styles.timer, one ? null : styles.timerTwo]}>
      {cells.map((c, i) => (
        <View
          key={c.label}
          style={[styles.grow, i > 0 ? styles.split : null]}
          accessible
          accessibilityLabel={`${c.label}, ${c.digits}${c.unit === null ? "" : ` ${c.unit}`}, ${c.under}`}
          testID={`timer-${c.label}`}
        >
          <Txt kind="tiny" style={styles.timerLabel}>
            {c.label.toUpperCase()}
          </Txt>
          <View style={styles.digits}>
            <Led text={c.digits} colour={c.colour} height={one ? 44 : 34} />
            {c.unit === null ? null : <Txt kind="strong" colour="timerWords">{c.unit}</Txt>}
          </View>
          <Txt kind="small" colour="timerWords" numberOfLines={1} fit>
            {c.under}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const LEAD_WORDS: Readonly<Record<Lead, string>> = { heaviest: "Heaviest set", mostReps: "Most reps", longestHold: "Longest hold" };
const LEAD_LIGHT: Readonly<Record<Lead, ColourName>> = { heaviest: "ledGreen", mostReps: "ledBlue", longestHold: "ledAmber" };

/** The person's last times as the timer's bars, the earliest first, the record day in red. */
function Bars({ lead, bars, units }: { lead: Lead; bars: readonly Bar[]; units: Units }) {
  const valueWords = (v: number | null) => (v === null ? "–" : lead === "heaviest" ? weightParts(v, units)[0] : lead === "mostReps" ? String(v) : holdWords(v));
  return (
    <View style={styles.timer} testID="last-times">
      <Txt kind="tiny" style={styles.timerLabel}>
        {`${LEAD_WORDS[lead]} · ${bars.length === 1 ? "your last time" : `your last ${String(bars.length)} times`}`.toUpperCase()}
      </Txt>
      <View style={styles.bars}>
        {bars.map((b) => {
          const light = b.record ? "ledRed" : LEAD_LIGHT[lead];
          return (
            <View key={b.workoutId} style={styles.bar} accessible accessibilityLabel={`${b.day}, ${valueWords(b.value)}${b.record ? ", your record" : ""}`}>
              <Txt kind="tiny" colour={b.record ? "ledRed" : "timerWords"} numberOfLines={1} fit style={styles.bold}>
                {`${b.record ? "PR " : ""}${valueWords(b.value)}`}
              </Txt>
              <Svg width={22} height={BAR_LIGHTS * 8} accessible={false}>
                {Array.from({ length: BAR_LIGHTS }, (_, i) => (
                  <Path key={i} d={box(0, i * 8 + 1, 22, 5.5, 2)} fill={BAR_LIGHTS - i <= b.lit ? colours[light] : colours.ledOff} />
                ))}
              </Svg>
              <Txt kind="tiny" colour={b.record ? "ledRed" : "timerWords"} numberOfLines={1} fit>
                {b.day}
              </Txt>
            </View>
          );
        })}
      </View>
      {bars.some((b) => b.record) ? (
        <Txt kind="tiny" colour="timerWords">
          PR · your personal record
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  bold: { fontFamily: fonts.bold },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  words: { gap: 4 },
  box: { gap: 12, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box },
  barWords: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  inline: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" },
  end: { alignItems: "flex-end" },
  key: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  keyOne: { flexDirection: "row", alignItems: "center", gap: 6 },
  keyMark: { width: 10, height: 10, borderRadius: 2 },
  keyLifted: { backgroundColor: colours.plateWhite },
  keyEstimate: { borderWidth: 1.5, borderStyle: "dashed", borderColor: colours.textSoft },
  timer: { gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  timerTwo: { flexDirection: "row", gap: 12 },
  split: { borderLeftWidth: 1, borderLeftColor: colours.timerSplit, paddingLeft: 12 },
  timerLabel: { fontFamily: fonts.bold, letterSpacing: 1.1, color: colours.timerWords },
  digits: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 6, marginBottom: 2 },
  bars: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 4 },
  bar: { flex: 1, alignItems: "center", gap: 4 },
});
