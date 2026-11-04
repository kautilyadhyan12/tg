import { StyleSheet, View } from "react-native";
import { bodyMeasurementListResponseSchema, type BodyMeasurement } from "@app/shared";
import { colours } from "../../look/colours";
import { Rise } from "../../look/Motion";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { weightWords } from "../goals/words";
import { dateWords, entryDay, entryRows, latestWeight } from "./otherRules";
import { ArtBox, BoxTitle, ReadOr } from "./parts";

// Progress's Body (ROADMAP Stage 5 35c-i): the web's Body Measurements, the newest weight big and the
// recent entries under it, in the person's own units. Logging one is the next job (35c-ii).

export const MEASUREMENTS_READ = "/v1/nutrition/body-measurements?limit=10";

export function BodyTab() {
  const { state } = useSession();
  const units = state.kind === "in" ? state.user.units : "metric";
  const list = useRead(MEASUREMENTS_READ, bodyMeasurementListResponseSchema, useZoneSaved());
  return (
    <Rise delay={60}>
      <ArtBox picture="anatomy">
        <BoxTitle icon="ruler" colour="blue" title="Body Measurements" />
        <ReadOr read={list.read} again={list.again} what="Your measurements">
          {(l) => <Body items={l.items} units={units} />}
        </ReadOr>
      </ArtBox>
    </Rise>
  );
}

function Body({ items, units }: { items: readonly BodyMeasurement[]; units: string }) {
  const latest = latestWeight(items);
  const rows = entryRows(items, units);
  return (
    <>
      {latest === null || latest.weightKg === null ? (
        <Txt kind="strong">No weight yet</Txt>
      ) : (
        <View accessible accessibilityLabel={`Weight ${weightWords(latest.weightKg, units)}, ${dateWords(entryDay(latest))}`}>
          <Txt kind="hero">{weightWords(latest.weightKg, units)}</Txt>
          <Txt kind="small">{`Weight · ${latest.source === "self_reported" ? "typed by you" : "logged"} ${dateWords(entryDay(latest))}`}</Txt>
        </View>
      )}
      {rows.length === 0 ? null : (
        <View style={styles.entries}>
          <Txt kind="tiny" style={styles.heading}>
            Recent entries
          </Txt>
          {rows.map((r) => (
            <View key={r.id} style={styles.entry} accessible accessibilityLabel={`${r.date}, ${r.how}, ${r.weight}${r.more === null ? "" : `, ${r.more}`}`}>
              <View style={styles.grow}>
                <Txt kind="strong">{r.date}</Txt>
                <Txt kind="tiny">{r.more === null ? r.how : `${r.how} · ${r.more}`}</Txt>
              </View>
              <Txt kind="strong">{r.weight}</Txt>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  entries: { gap: 8, width: "88%" },
  heading: { fontFamily: fonts.bold, textTransform: "uppercase", letterSpacing: 0.9 },
  entry: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.line },
  grow: { flex: 1 },
});
