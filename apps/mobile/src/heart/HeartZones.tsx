// The heart rate chart and the five heart rate zones (ROADMAP Stage 5 item 37f-ii-a): under the pace chart,
// on the run's summary and on the run's page, the heart rate along the run on the same distance scale (a
// finger on it reads that place), then the time in each zone, Maximum at the top as Garmin and Polar show
// them; and the maximum heart rate the zones are worked from, its row in Settings and its box.
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { HEART_MAX_LEAST, HEART_MAX_MOST, HEART_ZONES, heartMaxSchema, heartZoneEdges, heartZoneOf, type HeartZoneNumber, type HeartZones, type Units } from "@app/shared";
import { Button } from "../look/Button";
import { colours, sizes, type ColourName } from "../look/colours";
import { Field } from "../look/Field";
import { Icon } from "../look/Icon";
import { Sheet } from "../look/Sheet";
import { fonts, Txt } from "../look/Txt";
import { clock, distance, unitWord } from "../screens/running/runWords";
import { useHeartMax } from "./heartMax";

const HEIGHT = 150;
/** As the pace chart's, so the two lines fall one under the other. */
const LABEL_W = 30;
const RIGHT = 8;
const TOP = 12;
const BOTTOM = 20;
/** The scale spans at least this many beats a minute, so a steady run reads steady. */
const SPAN_BPM = 30;
const RED = colours.zone5;

export const zoneColour = (zone: HeartZoneNumber): ColourName => (zone === 5 ? "zone5" : zone === 4 ? "zone4" : zone === 3 ? "zone3" : zone === 2 ? "zone2" : "zone1");
export const zoneName = (zone: HeartZoneNumber): string => HEART_ZONES[zone - 1]?.name ?? "";

/** The beats a minute a zone covers, for a maximum: "171+ bpm" at the top, "under 114 bpm" at the bottom. */
export function zoneRange(zone: HeartZoneNumber, max: number): string {
  const [, z2, z3, z4, z5] = heartZoneEdges(max);
  const starts = [0, z2, z3, z4, z5];
  if (zone === 5) return `${String(z5)}+ bpm`;
  if (zone === 1) return `Under ${String(z2)} bpm`;
  return `${String(starts[zone - 1] ?? 0)}–${String((starts[zone] ?? 1) - 1)} bpm`;
}

/** The heart rate along the run; nothing for a run without a line. A place the monitor had no signal is a gap. */
export function HeartChart({ line, avg, highest, max, distanceM, units }: { line: readonly number[]; avg: number; highest: number; max: number | null; distanceM: number; units: Units }) {
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const n = line.length;
  const read = line.filter((v) => v > 0);
  const lo0 = read.length === 0 ? avg : Math.min(...read);
  const hi0 = read.length === 0 ? avg : Math.max(...read);
  const middle = (lo0 + hi0) / 2;
  const lo = Math.min(lo0, middle - SPAN_BPM / 2) - 4;
  const hi = Math.max(hi0, middle + SPAN_BPM / 2) + 4;
  const { fontScale } = useWindowDimensions();
  const LEFT = Math.ceil(LABEL_W * fontScale) + 6;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const plotH = HEIGHT - TOP - BOTTOM;
  const x = (i: number): number => LEFT + (n > 1 ? (plotW * i) / (n - 1) : 0);
  const y = (bpm: number): number => TOP + plotH * (1 - (Math.min(hi, Math.max(lo, bpm)) - lo) / (hi - lo || 1));
  const geometry = useRef({ plotW, n, LEFT });
  geometry.current = { plotW, n, LEFT };
  const touch = useMemo(() => {
    const pick = (locationX: number) => {
      const g = geometry.current;
      if (g.n < 2 || g.plotW <= 0) return;
      setAt(Math.max(0, Math.min(g.n - 1, Math.round(((locationX - g.LEFT) / g.plotW) * (g.n - 1)))));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: (e) => {
        pick(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => {
        pick(e.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        setAt(null);
      },
      onPanResponderTerminate: () => {
        setAt(null);
      },
      onPanResponderTerminationRequest: (_e, g) => Math.abs(g.dy) > Math.abs(g.dx),
    });
  }, []);
  if (n < 2 || read.length === 0) return null;

  // One path for each stretch with a heart rate: never drawn across a gap.
  let path = "";
  let drawing = false;
  line.forEach((v, i) => {
    if (v <= 0) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    drawing = true;
  });
  const top = line.indexOf(Math.max(...line));
  const picked = at === null ? null : (line[at] ?? 0);
  // The zones behind the line, faint, where there is a maximum.
  const bands =
    max === null
      ? []
      : HEART_ZONES.map((z) => {
          const [, z2, z3, z4, z5] = heartZoneEdges(max);
          const from = [0, z2, z3, z4, z5][z.zone - 1] ?? 0;
          const to = z.zone === 5 ? 999 : ([0, z2, z3, z4, z5][z.zone] ?? 999);
          const yTop = y(Math.min(hi, to));
          const yFoot = y(Math.max(lo, from));
          return { zone: z.zone, yTop, h: Math.max(0, yFoot - yTop) };
        }).filter((b) => b.h > 0.5);
  const marks = [Math.round(lo + 4), Math.round((lo + hi) / 2), Math.round(hi - 4)];
  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.round(e.nativeEvent.layout.width));
  };
  return (
    <View>
      <View style={styles.read}>
        {at === null || picked === null ? (
          <>
            <Figure value={String(avg)} label="Avg bpm" />
            <Figure value={String(highest)} label="Max bpm" red />
          </>
        ) : (
          <>
            <Figure value={`${distance((distanceM * at) / (n - 1), units)} ${unitWord(units)}`} label="Distance" />
            <Figure value={picked > 0 ? String(picked) : "--"} label={picked > 0 ? "bpm" : "No signal"} red />
            {picked > 0 && max !== null ? <Figure value={`Zone ${String(heartZoneOf(picked, max))}`} label={zoneName(heartZoneOf(picked, max))} /> : null}
          </>
        )}
      </View>
      <View onLayout={onLayout} style={{ height: HEIGHT }} accessible accessibilityLabel={`Heart rate chart. Average ${String(avg)}, highest ${String(highest)} beats a minute.`} testID="heart-chart" {...touch.panHandlers}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="heartBeam" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colours.trail} stopOpacity={0} />
                <Stop offset="0.5" stopColor={colours.trail} stopOpacity={0.4} />
                <Stop offset="1" stopColor={colours.trail} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {bands.map((b) => (
              <Path key={String(b.zone)} d={`M${String(LEFT)} ${b.yTop.toFixed(1)}h${String(plotW)}v${b.h.toFixed(1)}h${String(-plotW)}Z`} fill={colours[zoneColour(b.zone)]} fillOpacity={0.07} />
            ))}
            {marks.map((m) => (
              <Line key={String(m)} x1={LEFT} x2={width - RIGHT} y1={y(m)} y2={y(m)} stroke={colours.trailGlow} strokeOpacity={0.35} />
            ))}
            <Path d={path} stroke={RED} strokeOpacity={0.18} strokeWidth={9} fill="none" strokeLinejoin="round" />
            <Path d={path} stroke={RED} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
            <Line x1={LEFT} x2={width - RIGHT} y1={y(avg)} y2={y(avg)} stroke={RED} strokeWidth={1.4} strokeDasharray="5 5" strokeOpacity={0.8} />
            {at === null || picked === null ? (
              <>
                <Circle cx={x(top)} cy={y(line[top] ?? highest)} r={10} fill={colours.trail} fillOpacity={0.18} />
                <Circle cx={x(top)} cy={y(line[top] ?? highest)} r={5} fill={colours.trail} stroke={RED} strokeWidth={2} />
              </>
            ) : (
              <>
                <Path d={`M${(x(at) - 1).toFixed(1)} ${String(TOP)}h2v${String(plotH)}h-2Z`} fill="url(#heartBeam)" />
                {picked > 0 ? <Circle cx={x(at)} cy={y(picked)} r={6} fill={colours.trail} testID="heart-picked" /> : null}
              </>
            )}
          </Svg>
        ) : null}
        {width > 0
          ? marks.map((m) => (
              <Txt key={String(m)} style={[styles.mark, { top: y(m) - 8, width: LEFT - 6 }]} numberOfLines={1}>
                {String(m)}
              </Txt>
            ))
          : null}
      </View>
    </View>
  );
}

/** The time in each zone, Maximum first: its name, its beats a minute, a bar, the time and its share. */
export function ZoneBars({ zones }: { zones: HeartZones }) {
  const total = zones.seconds.reduce((a, b) => a + b, 0);
  const top = Math.max(1, ...zones.seconds);
  return (
    <View style={styles.zones} testID="heart-zones">
      {[...HEART_ZONES].reverse().map((z) => {
        const s = zones.seconds[z.zone - 1] ?? 0;
        const share = total > 0 ? Math.round((s * 100) / total) : 0;
        return (
          <View key={String(z.zone)} style={styles.zoneRow} accessible accessibilityLabel={`Zone ${String(z.zone)}, ${z.name}, ${zoneRange(z.zone, zones.max)}: ${clock(s)}, ${String(share)} percent`}>
            <View style={styles.zoneWords}>
              <Txt kind="small" style={styles.zoneTitle} numberOfLines={1}>
                {`Zone ${String(z.zone)} · ${z.name}`}
              </Txt>
              <Txt kind="tiny" colour="textFaint" numberOfLines={1}>
                {zoneRange(z.zone, zones.max)}
              </Txt>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { flex: s / top, backgroundColor: colours[zoneColour(z.zone)] }]} />
              <View style={{ flex: 1 - s / top }} />
            </View>
            <View style={styles.zoneTime}>
              <Txt kind="small" style={styles.zoneTitle}>
                {clock(s)}
              </Txt>
              <Txt kind="tiny" colour="textFaint">{`${String(share)}%`}</Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export interface HeartCardProps {
  heartAvg: number | null;
  heartMax: number | null;
  line: readonly number[];
  zones: HeartZones | null;
  /** The maximum known now (for the bands behind a summary's line, and to say whether one is set). */
  maxNow: number | null;
  distanceM: number;
  units: Units;
  /** "summary": the run is not saved yet, so a maximum set now gives it zones; "saved": zones stay as saved. */
  when: "summary" | "saved";
  onSetMax: () => void;
}

/** The heart rate card: nothing for a run without a heart rate. */
export function HeartCard({ heartAvg, heartMax, line, zones, maxNow, distanceM, units, when, onSetMax }: HeartCardProps) {
  if (heartAvg === null || heartMax === null) return null;
  const bandMax = zones?.max ?? (when === "summary" ? maxNow : null);
  return (
    <View style={styles.card} testID="heart-card">
      <View style={styles.head}>
        <Txt kind="h3">Heart rate</Txt>
        <Txt kind="small" colour="textFaint">
          bpm
        </Txt>
      </View>
      {line.length >= 2 ? (
        <HeartChart line={line} avg={heartAvg} highest={heartMax} max={bandMax} distanceM={distanceM} units={units} />
      ) : (
        <View style={styles.read}>
          <Figure value={String(heartAvg)} label="Avg bpm" />
          <Figure value={String(heartMax)} label="Max bpm" red />
        </View>
      )}
      <Txt kind="h3">Heart rate zones</Txt>
      {zones !== null ? (
        <>
          <ZoneBars zones={zones} />
          <View style={styles.from}>
            <Txt kind="small" colour="textFaint" style={styles.fromWords}>
              {`From a maximum heart rate of ${String(zones.max)} bpm.`}
            </Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Change maximum heart rate" onPress={onSetMax} hitSlop={10}>
              <Txt kind="small" colour="orange">
                Change
              </Txt>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Txt kind="small" colour="textSoft">
            {when === "summary" ? "Add your maximum heart rate to see your zones." : "This run was saved before a maximum heart rate was set."}
          </Txt>
          {maxNow === null ? <Button label="Set maximum heart rate" small onPress={onSetMax} style={styles.start} /> : null}
        </>
      )}
    </View>
  );
}

/** The Settings row: the maximum and where it comes from; pressed, its box opens. */
export function HeartMaxRow({ onOpen }: { onOpen: () => void }) {
  const { read } = useHeartMax();
  const words =
    read.kind !== "ok"
      ? read.kind === "loading"
        ? ""
        : "Can't load right now."
      : read.data.own !== null
        ? `${String(read.data.own)} bpm · your own`
        : read.data.fromAge !== null
          ? `${String(read.data.fromAge)} bpm · from your age`
          : "Not set";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Maximum heart rate. ${words}`} onPress={onOpen} style={styles.row} testID="heart-max-row">
      <View style={styles.rowWords}>
        <Txt kind="body">Maximum heart rate</Txt>
        <Txt kind="small" colour="textSoft">
          {words}
        </Txt>
      </View>
      <Icon name="go" size={18} colour="textFaint" />
    </Pressable>
  );
}

/** The box: the person's own maximum typed, or taken away to use their age's. */
export function HeartMaxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Maximum heart rate" onClose={onClose}>
      {open ? <HeartMaxForm onClose={onClose} /> : null}
    </Sheet>
  );
}

function HeartMaxForm({ onClose }: { onClose: () => void }) {
  const { read, save } = useHeartMax();
  const data = read.kind === "ok" ? read.data : null;
  const [typed, setTyped] = useState(data?.own === null || data?.own === undefined ? "" : String(data.own));
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const number = /^\d{2,3}$/.test(typed.trim()) ? heartMaxSchema.safeParse(Number(typed.trim())) : null;
  const send = async (own: number | null) => {
    if (busy) return;
    setBusy(true);
    setTrouble(null);
    const failed = await save(own);
    setBusy(false);
    if (failed === null) onClose();
    else setTrouble(failed);
  };
  return (
    <View style={styles.form}>
      <Txt kind="small" colour="textSoft">
        Your heart rate zones are worked out from it.
      </Txt>
      <Field
        label="Your maximum heart rate (bpm)"
        value={typed}
        onChange={(v) => {
          setTyped(v.replace(/[^0-9]/g, ""));
          setTrouble(null);
        }}
        placeholder={data?.fromAge === null || data?.fromAge === undefined ? "e.g. 185" : String(data.fromAge)}
        keyboard="number-pad"
        maxLength={3}
        ready
        onDone={() => {
          if (number?.success === true) void send(number.data);
        }}
      />
      {typed !== "" && number?.success !== true ? (
        <Txt kind="small" colour="badText">{`Enter a number from ${String(HEART_MAX_LEAST)} to ${String(HEART_MAX_MOST)}.`}</Txt>
      ) : null}
      <Txt kind="small" colour="textFaint">
        {data?.fromAge === null || data?.fromAge === undefined ? "Add your age in your profile, or enter your own." : `From your age: ${String(data.fromAge)} bpm (220 less your age).`}
      </Txt>
      {trouble === null ? null : (
        <Txt kind="small" colour="badText">
          {trouble}
        </Txt>
      )}
      <Button label="Save" busy={busy} disabled={number?.success !== true} onPress={() => { if (number?.success === true) void send(number.data); }} />
      {data?.own !== null && data?.own !== undefined ? (
        <Pressable accessibilityRole="button" onPress={() => void send(null)} hitSlop={10} style={styles.second}>
          <Txt kind="small" colour="orange">
            {data.fromAge === null ? "Remove my maximum" : "Use my age instead"}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

function Figure({ value, label, red = false }: { value: string; label: string; red?: boolean }) {
  return (
    <View>
      <Txt style={[styles.figure, red ? { color: RED } : null]} numberOfLines={1}>
        {value}
      </Txt>
      <Txt kind="small" colour="textFaint">
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  read: { flexDirection: "row", gap: 18, minHeight: 44, marginTop: 4 },
  mark: { position: "absolute", left: 0, textAlign: "right", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colours.textFaint },
  figure: { fontFamily: fonts.bold, fontSize: 20, color: colours.text },
  zones: { gap: 10 },
  zoneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  zoneWords: { flexBasis: 128, flexShrink: 1 },
  zoneTitle: { fontFamily: fonts.bold },
  barTrack: { flex: 1, flexDirection: "row", height: 10, borderRadius: sizes.round, backgroundColor: colours.track, overflow: "hidden" },
  bar: { height: 10, borderRadius: sizes.round },
  zoneTime: { alignItems: "flex-end", minWidth: 48 },
  from: { flexDirection: "row", alignItems: "center", gap: 10 },
  fromWords: { flex: 1 },
  start: { alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  rowWords: { flex: 1, gap: 2 },
  form: { gap: 12 },
  second: { alignSelf: "center", paddingVertical: 6 },
});
