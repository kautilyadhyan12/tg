import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colours, sizes, type ColourName } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { ExerciseThumb } from "../library/ExerciseImage";
import { useNamed } from "../library/useLibrary";
import { Led } from "../library/Records";
import { setsHeading, type ExerciseBlock, type RecordRow } from "./afterWords";

// The pieces a workout's last screen (64a-iii) and a workout's page in History (64a-v) both draw, so the two show one
// workout the same way: the wall timer's tiles, the new records and every set, exercise by exercise.

/** One number on the wall timer: its label over its LED digits. */
export function Tile({ label, text, colour, say }: { label: string; text: string; colour: ColourName; say?: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}, ${say ?? text}`}>
      <Txt kind="tiny" style={styles.label}>
        {label.toUpperCase()}
      </Txt>
      <Led text={text} colour={colour} height={26} />
    </View>
  );
}

/** A workout's average and highest heart rate (64a-v, 64a-vi): the same words on its last screen and in History. */
export const heartWords = (avg: number, max: number | null): string =>
  max === null ? `Heart rate ${String(avg)} average` : `Heart rate ${String(avg)} average · ${String(max)} highest`;

export function HeartLine({ avg, max }: { avg: number; max: number | null }) {
  return (
    <View style={styles.row}>
      <Icon name="heart" size={18} colour="badText" />
      <Txt kind="body" colour="text" style={styles.grow}>
        {heartWords(avg, max)}
      </Txt>
    </View>
  );
}

/** The wall timer holding its tiles in a row. */
export function Wall({ children }: { children: ReactNode }) {
  return <View style={[styles.wall, styles.tiles]}>{children}</View>;
}

/** The new records under the bell, each with its gold PR. */
export function RecordsBox({ rows }: { rows: readonly RecordRow[] }) {
  return (
    <View style={styles.records}>
      <View style={styles.row}>
        <Icon name="bell" size={22} colour="gold" />
        <Txt kind="eyebrow" colour="gold" style={styles.grow}>
          {`New records · ${String(rows.length)}`}
        </Txt>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.recordRow} accessible accessibilityLabel={`New record, ${row.kind}, ${row.where}, ${row.value}`}>
          <View style={styles.medal}>
            <Txt kind="tiny" style={styles.medalWords}>
              PR
            </Txt>
          </View>
          <View style={styles.grow}>
            <Txt kind="strong">{row.kind}</Txt>
            <Txt kind="small">{row.where}</Txt>
          </View>
          <Txt kind="strong" colour="gold" style={styles.digits}>
            {row.value}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** "3 exercises · 9 sets", then every set, exercise by exercise, a gold PR on the set that made a record. */
export function SetBlocks({ blocks }: { blocks: readonly ExerciseBlock[] }) {
  // Each exercise's own picture (62a), from the Library kept on the phone.
  const named = useNamed();
  return (
    <View style={styles.part}>
      <Txt kind="body">{setsHeading(blocks)}</Txt>
      {blocks.map((b) => (
        <View key={b.key} style={styles.box}>
          <View style={[styles.row, styles.blockTop]}>
            <ExerciseThumb id={b.exercise} kind={b.kind} picture={named(b.exercise).picture} fit="cover" style={styles.thumb} />
            <View style={styles.grow}>
              <Txt kind="strong">{b.name}</Txt>
              <Txt kind="small">{b.line}</Txt>
            </View>
          </View>
          {b.sets.map((s) => (
            <View key={s.key} style={styles.setRow} accessible accessibilityLabel={`Set ${s.n}, ${s.done} ${s.of} ${s.weight}${s.pr ? ", a new record" : ""}`}>
              <View style={styles.setNumber}>
                <Txt kind="tiny" colour="text">
                  {s.n}
                </Txt>
              </View>
              <Txt kind="strong" style={[styles.grow, styles.digits]}>
                {s.done}
                {s.of === "" ? null : <Txt kind="body">{` ${s.of}`}</Txt>}
              </Txt>
              {s.weight === "" ? null : (
                <Txt kind="body" colour="text" style={styles.digits}>
                  {s.weight}
                </Txt>
              )}
              {s.pr ? (
                <View style={styles.prTag}>
                  <Txt kind="tiny" style={styles.medalWords}>
                    PR
                  </Txt>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  digits: { fontVariant: ["tabular-nums"] },
  part: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  wall: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 22, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  tiles: { flexDirection: "row", paddingVertical: 14 },
  tile: { flex: 1, alignItems: "center", gap: 10 },
  label: { fontFamily: fonts.bold, letterSpacing: 1.1, color: colours.timerWords },
  box: { gap: 10, padding: 14, borderRadius: 22, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  records: { gap: 8, padding: 14, borderRadius: 22, borderWidth: 1, borderColor: colours.goldLine, backgroundColor: colours.goldFill },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  medal: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colours.gold },
  medalWords: { fontFamily: fonts.bold, color: colours.onLight },
  blockTop: { paddingBottom: 4 },
  thumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: colours.box },
  setRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colours.line },
  setNumber: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colours.fill },
  prTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: sizes.round, backgroundColor: colours.gold },
});
