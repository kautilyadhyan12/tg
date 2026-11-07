import { Image, Pressable, StyleSheet, View } from "react-native";
import type { RunBests, RunRecordKind, RunRecords, Units } from "@app/shared";
import { colours, recordLook, sizes } from "../../look/colours";
import { medalPicture } from "../../look/medals";
import { fonts, Txt } from "../../look/Txt";
import { earnedDay } from "../achievements/achievementsRules";
import { MEDALS, beatWords, recordName, recordValue, shownKinds, shownRecords, type NewRecord } from "./runRecords";

// Running records' pieces (ROADMAP 37c-ii, Kd's "yes" to reviews/37c-ii-records-mock.png): the gold New
// record box on a run's summary, Your records on the Running page, and a run's own Best efforts.

/** A medal small beside its words; grey while the record is not set. */
function SmallMedal({ medal, lit, size = 40 }: { medal: string; lit: boolean; size?: number }) {
  const picture = medalPicture(`${medal}${lit ? "" : "_locked"}`);
  return picture === null ? null : (
    <Image source={picture} resizeMode="contain" resizeMethod="resize" accessible={false} style={{ width: size, height: Math.round(size * 1.17) }} />
  );
}

const MEDAL_OF = MEDALS;

/** A record the run just finished beats, in gold, under the run's name. */
export function NewRecordBox({ rec, units }: { rec: NewRecord; units: Units }) {
  const value = recordValue(rec.kind, rec.value, units);
  const beat = beatWords(rec.kind, rec.value, rec.before, units);
  return (
    <View style={styles.newBox} accessible accessibilityLabel={`New record. ${recordName(rec.kind)}, ${value}.${beat === null ? "" : ` ${beat}`}`} testID={`new-record-${rec.kind}`}>
      <SmallMedal medal={MEDAL_OF[rec.kind]} lit size={56} />
      <View style={styles.grow}>
        <Txt style={styles.newWord}>NEW RECORD</Txt>
        <Txt kind="strong" numberOfLines={1} fit>
          {`${recordName(rec.kind)} · `}
          <Txt kind="strong" style={styles.gold}>
            {value}
          </Txt>
        </Txt>
        {beat === null ? null : <Txt kind="small">{beat}</Txt>}
      </View>
    </View>
  );
}

/** Your records: each in the person's units, opening the run that set it; one not set says what it takes. */
export function RecordsCard({ records, units, onOpen }: { records: RunRecords; units: Units; onOpen: (runId: string) => void }) {
  const now = new Date();
  return (
    <View style={styles.card} testID="your-records">
      <Txt kind="h3">Your records</Txt>
      {shownRecords(records, units).map((r, i) => {
        const line = (
          <>
            <SmallMedal medal={r.medal} lit={r.record !== null} />
            <View style={styles.grow}>
              <Txt kind="strong" colour={r.record === null ? "textSoft" : "text"}>
                {r.name}
              </Txt>
              {r.record === null ? null : <Txt kind="tiny">{dayWords(r.record.startedAt, now)}</Txt>}
            </View>
            {r.record === null ? (
              <Txt kind="small" colour="textFaint" style={styles.takes}>
                {r.takes}
              </Txt>
            ) : (
              <Txt kind="big" style={styles.value}>
                {r.value}
              </Txt>
            )}
          </>
        );
        const record = r.record;
        return record === null ? (
          <View key={r.kind} style={[styles.line, i === 0 ? null : styles.lineTop]}>
            {line}
          </View>
        ) : (
          <Pressable
            key={r.kind}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${r.value ?? ""}, ${dayWords(record.startedAt, now)}. Open ${record.name}`}
            onPress={() => { onOpen(record.runId); }}
            style={({ pressed }) => [styles.line, i === 0 ? null : styles.lineTop, pressed ? styles.pressed : null]}
          >
            {line}
            <Txt kind="body" colour="textFaint">
              ›
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Today", or "3 Nov". */
export function dayWords(iso: string, now: Date): string {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString() ? "Today" : earnedDay(iso, now);
}

/** A run's best efforts: the fastest stretch of each distance it covered, "Your record" on those it holds. */
export function BestEffortsCard({ bests, held, units }: { bests: RunBests; held: readonly RunRecordKind[]; units: Units }) {
  const kinds = shownKinds(units).filter((k): k is "k1" | "mile" | "k5" | "k10" => k !== "longest" && bests[k] !== null);
  if (kinds.length === 0) return null;
  return (
    <View style={styles.card} testID="best-efforts">
      <Txt kind="h3">Best efforts</Txt>
      {kinds.map((kind, i) => {
        const s = bests[kind] ?? 0;
        const mine = held.includes(kind);
        const name = recordName(kind).replace("Fastest ", "").replace("mile", "Mile");
        return (
          <View key={kind} style={[styles.line, i === 0 ? null : styles.lineTop]} accessible accessibilityLabel={`${name}, ${recordValue(kind, s, units)}${mine ? ", your record" : ""}`}>
            <SmallMedal medal={MEDAL_OF[kind]} lit size={34} />
            <View style={[styles.grow, styles.nameRow]}>
              <Txt kind="strong">{name}</Txt>
              {mine ? (
                <View style={styles.tag}>
                  <Txt kind="tiny" style={styles.tagWords}>
                    Your record
                  </Txt>
                </View>
              ) : null}
            </View>
            <Txt kind="big" style={styles.value}>
              {recordValue(kind, s, units)}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  newBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: sizes.boxRadius,
    backgroundColor: recordLook.box,
    experimental_backgroundImage: recordLook.shade,
    borderWidth: 1,
    borderColor: recordLook.line,
    boxShadow: recordLook.glow,
  },
  newWord: { fontFamily: fonts.carved, fontSize: 12, lineHeight: 16, letterSpacing: 2, color: recordLook.word },
  gold: { color: recordLook.word },
  card: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 6 },
  lineTop: { borderTopWidth: 1, borderTopColor: colours.line },
  pressed: { opacity: 0.7 },
  value: { fontVariant: ["tabular-nums"] },
  takes: { maxWidth: "45%", textAlign: "right" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: sizes.round, backgroundColor: recordLook.tag },
  tagWords: { color: recordLook.onTag, fontFamily: fonts.bold },
});
