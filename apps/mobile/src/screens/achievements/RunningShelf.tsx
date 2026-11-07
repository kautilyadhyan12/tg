import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import type { RunRecords, Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, medal, medalShades, recordLook, sizes } from "../../look/colours";
import { medalPicture } from "../../look/medals";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { dayWords } from "../running/RecordParts";
import { RunPage } from "../running/RunPage";
import { beatWords, shownRecords, type ShownRecord } from "../running/runRecords";
import { pace, paceWord } from "../running/runWords";
import { accountUnits } from "../setup/Setup";

// Achievements → Badges' Running shelf (ROADMAP 37c-ii, Kd's "yes" to reviews/37c-ii-records-mock.png): the four
// running records as medals among the badges, lit once set with the record under each, grey with what it takes
// while not; a medal pressed opens the badge box under the Greek runner, with Open run.

const ABOUT: Readonly<Record<ShownRecord["kind"], string>> = {
  k1: "Your fastest kilometre in one run, anywhere in the run.",
  mile: "Your fastest mile in one run, anywhere in the run.",
  k5: "Your fastest 5 km in one run, anywhere in the run.",
  k10: "Your fastest 10 km in one run, anywhere in the run.",
  longest: "The farthest you have run in one run.",
};
const METRES: Readonly<Record<ShownRecord["kind"], number>> = { k1: 1000, mile: 1609.344, k5: 5000, k10: 10_000, longest: 0 };

export function RunningShelf({ records, again }: { records: RunRecords; again: () => void }) {
  const { state } = useSession();
  const units: Units = (state.kind === "in" ? accountUnits(state.user.units) : null) ?? "metric";
  const [open, setOpen] = useState<ShownRecord | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const shown = shownRecords(records, units);
  const now = new Date();
  const rows = [shown.slice(0, 3), shown.slice(3)];
  return (
    <View testID="running-shelf">
      <View style={styles.heading}>
        <Txt kind="eyebrow" style={styles.headingWords}>
          Running
        </Txt>
        <View style={styles.headingLine} />
        <Txt kind="tiny">{`${String(shown.filter((r) => r.record !== null).length)} of ${String(shown.length)}`}</Txt>
      </View>
      {rows.map((row) => (
        <View key={row.map((r) => r.kind).join()} style={styles.shelf}>
          <View style={styles.ledge} />
          {row.map((r) => (
            <View key={r.kind} style={styles.third}>
              <Medal r={r} onPress={() => { setOpen(r); }} />
            </View>
          ))}
          {Array.from({ length: 3 - row.length }, (_, i) => <View key={`gap${String(i)}`} style={styles.third} />)}
        </View>
      ))}
      <Sheet open={open !== null} title={open?.name ?? ""} picture={{ name: "greekrun", focus: 0.2 }} onClose={() => { setOpen(null); }}>
        {open === null ? null : (
          <RecordBox
            r={open}
            units={units}
            now={now}
            onOpenRun={(id) => {
              setOpen(null);
              setRunId(id);
            }}
          />
        )}
      </Sheet>
      <RunPage
        runId={runId}
        units={units}
        onClose={() => { setRunId(null); }}
        onChanged={again}
      />
    </View>
  );
}

function Medal({ r, onPress }: { r: ShownRecord; onPress: () => void }) {
  const lit = r.record !== null;
  const picture = medalPicture(`${r.medal}${lit ? "" : "_locked"}`);
  const line = r.value ?? r.takes.replace(" to set it.", "");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={lit ? `${r.name}, ${line}` : `${r.name}, not set yet. ${r.takes}`}
      onPress={onPress}
      style={({ pressed }) => [styles.medal, pressed ? styles.pressed : null]}
    >
      <View style={styles.art}>
        {lit ? (
          <Svg width={130} height={130} style={styles.glow}>
            <Defs>
              <RadialGradient id="recordGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={medal.gold} stopOpacity={0.34} />
                <Stop offset="0.6" stopColor={medal.gold} stopOpacity={0.08} />
                <Stop offset="1" stopColor={medal.gold} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={65} cy={65} r={65} fill="url(#recordGlow)" />
          </Svg>
        ) : null}
        {picture === null ? null : <Image source={picture} resizeMode="contain" resizeMethod="resize" accessible={false} style={styles.picture} />}
      </View>
      <Txt kind="small" colour={lit ? "text" : "textSoft"} numberOfLines={2} style={styles.name}>
        {r.name}
      </Txt>
      <Txt kind="tiny" colour={lit ? "orange" : "textFaint"} numberOfLines={1} fit style={styles.line}>
        {line}
      </Txt>
    </Pressable>
  );
}

function RecordBox({ r, units, now, onOpenRun }: { r: ShownRecord; units: Units; now: Date; onOpenRun: (id: string) => void }) {
  const record = r.record;
  const picture = medalPicture(`${r.medal}${record === null ? "_locked" : ""}`);
  const beat = record === null ? null : beatWords(r.kind, record.value, record.before, units);
  return (
    <View style={styles.box}>
      <View style={styles.boxTop}>
        {picture === null ? null : <Image source={picture} resizeMode="contain" accessible={false} style={styles.big} />}
        <View style={styles.boxWords}>
          <View style={[styles.chip, record === null ? null : styles.chipSet]}>
            <Txt kind="tiny" style={record === null ? null : styles.chipSetWords}>
              {record === null ? "Not set yet" : "Your record"}
            </Txt>
          </View>
          <Txt colour="text">{ABOUT[r.kind]}</Txt>
        </View>
      </View>
      {record === null ? (
        <Txt kind="small">{r.takes}</Txt>
      ) : (
        <>
          <View style={styles.stats}>
            <Stat big={r.value ?? ""} small={r.kind === "longest" ? "in one run" : `${pace(record.value, METRES[r.kind], units)} ${paceWord(units)}`} orange />
            <Stat big={dayWords(record.startedAt, now)} small={record.name} />
          </View>
          {beat === null ? null : <Txt kind="small">{beat}</Txt>}
          <Button label="Open run" say={`Open ${record.name}`} style={styles.open} onPress={() => { onOpenRun(record.runId); }} />
        </>
      )}
    </View>
  );
}

function Stat({ big, small, orange = false }: { big: string; small: string; orange?: boolean }) {
  return (
    <View style={styles.stat}>
      <Txt kind="big" colour={orange ? "orange" : "text"} numberOfLines={1} fit>
        {big}
      </Txt>
      <Txt kind="tiny" colour="textSoft" numberOfLines={2}>
        {small}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, marginBottom: 2 },
  headingWords: { color: medal.heading },
  headingLine: { flex: 1, height: 1, experimental_backgroundImage: medalShades.heading },
  shelf: { flexDirection: "row", paddingTop: 4 },
  ledge: { position: "absolute", left: -4, right: -4, top: 118, height: 9, borderRadius: 3, experimental_backgroundImage: medalShades.shelf, boxShadow: medalShades.shelfShadow },
  third: { flex: 1 },
  medal: { alignItems: "center", paddingBottom: 6 },
  pressed: { opacity: 0.75 },
  art: { height: 118, width: "100%", alignItems: "center", justifyContent: "flex-end" },
  glow: { position: "absolute", top: 0 },
  picture: { width: 100, height: 117 },
  name: { textAlign: "center", fontWeight: "700", marginTop: 16, paddingHorizontal: 2 },
  line: { textAlign: "center", marginTop: 2, fontVariant: ["tabular-nums"] },
  box: { gap: 14 },
  boxTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  big: { width: 112, height: 131 },
  boxWords: { flex: 1, gap: 10 },
  chip: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: sizes.round, backgroundColor: colours.fill },
  chipSet: { backgroundColor: recordLook.tag },
  chipSetWords: { color: recordLook.onTag, fontFamily: fonts.bold },
  stats: { flexDirection: "row", gap: 10 },
  open: { alignSelf: "center", minWidth: 200 },
  stat: { flex: 1, minHeight: 64, padding: 12, borderRadius: 16, backgroundColor: colours.glass, borderWidth: 1, borderColor: colours.line },
});
