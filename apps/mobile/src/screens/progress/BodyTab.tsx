import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { bodyMeasurementListResponseSchema, type BodyMeasurement } from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { colours } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Rise } from "../../look/Motion";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead, type Read } from "../dashboard/useRead";
import { newGoalId } from "../goals/words";
import { BodyChart } from "./BodyChart";
import { useBodyOutbox } from "./BodyOutbox";
import {
  bodyList,
  buildEntry,
  changeWords,
  entryWords,
  holdsWords,
  lastValues,
  loggedMeasures,
  MEASURES,
  series,
  shown,
  shownWithUnit,
  unitOf,
  type MeasureKey,
  type Typed,
} from "./bodyRules";
import { dateWords, entryDay } from "./otherRules";
import { ArtBox, BoxTitle, ReadOr } from "./parts";

// Progress's Body (ROADMAP Stage 5 35c-i, 35c-ii): the browser's Body Measurements. The newest weight
// big; a chip for each measurement logged and its line; the recent entries, each with its bin; and
// Log measurements, kept on the phone until the server has it.

export const MEASUREMENTS_READ = "/v1/nutrition/body-measurements?limit=60";
const SHOWN_ENTRIES = 5;

export function BodyTab() {
  const { state } = useSession();
  const units = state.kind === "in" ? state.user.units : "metric";
  const { outbox, view } = useBodyOutbox();
  const list = useRead(MEASUREMENTS_READ, bodyMeasurementListResponseSchema, useZoneSaved() + view.sent);
  const [logging, setLogging] = useState(false);
  const [removing, setRemoving] = useState<BodyMeasurement | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  // What the server's list now holds needs no holding here.
  const read = list.read.kind === "ok" ? list.read.data.items : null;
  useEffect(() => {
    if (read !== null) outbox?.settle(new Set(read.map((m) => m.id)));
  }, [read, outbox]);

  const merged = bodyList(read ?? [], view);
  // What waits on the phone is shown even while the list cannot be read.
  const shownRead: Read<null> = list.read.kind === "ok" || merged.items.length > 0 ? { kind: "ok", data: null } : list.read;
  return (
    <Rise delay={60}>
      <ArtBox picture="anatomy">
        <BoxTitle
          icon="ruler"
          colour="blue"
          title="Body Measurements"
          side={<Button label="Log" icon="plus" small say="Log measurements" disabled={outbox === null} onPress={() => { setSaid(null); setLogging(true); }} />}
        />
        {said === null ? null : (
          <Txt kind="small" colour="goodText">
            {said}
          </Txt>
        )}
        {view.unsaved ? <Txt kind="small" colour="orangeLight">Waiting to send. It couldn’t be saved on this phone yet, so keep the app open.</Txt> : null}
        {view.refused.map((r) => (
          <View key={r.id} style={styles.refused}>
            <Txt kind="small" style={styles.grow}>
              {r.message}
            </Txt>
            <Button label="OK" kind="link" onPress={() => outbox?.forget(r.id)} />
          </View>
        ))}
        <ReadOr read={shownRead} again={list.again} what="Your measurements">
          {() => <Body items={merged.items} waiting={merged.waiting} units={units} onRemove={setRemoving} />}
        </ReadOr>
      </ArtBox>
      <LogSheet
        open={logging}
        units={units}
        last={lastValues(merged.items)}
        onClose={() => {
          setLogging(false);
        }}
        onSave={async (entry) => {
          if (outbox === null) return "Try again in a moment.";
          const kept = await outbox.add({ id: newGoalId(), measuredAt: new Date().toISOString(), ...entry });
          if (!kept) return "Too many measurements are waiting to send. Go online, then log these.";
          setLogging(false);
          setSaid("Measurements saved.");
          return null;
        }}
      />
      <RemoveSheet
        entry={removing}
        units={units}
        onClose={() => {
          setRemoving(null);
        }}
        onRemove={(m) => {
          setRemoving(null);
          setSaid("Entry removed.");
          void outbox?.remove(m.id);
        }}
      />
    </Rise>
  );
}

function Body({ items, waiting, units, onRemove }: { items: readonly BodyMeasurement[]; waiting: ReadonlySet<string>; units: string; onRemove: (m: BodyMeasurement) => void }) {
  const logged = loggedMeasures(items);
  const [picked, setPicked] = useState<MeasureKey>("weight");
  const key = logged.includes(picked) ? picked : (logged[0] ?? "weight");
  const latest = items.find((m) => m.weightKg !== null) ?? null;
  const measure = MEASURES.find((m) => m.key === key) ?? MEASURES[0];
  const points = series(items, key);
  const change = changeWords(points, key, units);
  if (items.length === 0) return <Txt kind="strong">No measurements yet</Txt>;
  return (
    <>
      {latest === null || latest.weightKg === null ? (
        <Txt kind="strong">No weight yet</Txt>
      ) : (
        <View accessible accessibilityLabel={`Weight ${shownWithUnit(latest.weightKg, "weight", units)}, ${dateWords(entryDay(latest))}`}>
          <View style={styles.bigRow}>
            <Txt kind="hero">{shown(latest.weightKg, "weight", units)}</Txt>
            <Txt kind="small">{`${unitOf("weight", units)} · weight`}</Txt>
          </View>
          <Txt kind="small">{`Logged ${dateWords(entryDay(latest))}${latest.source === "self_reported" ? ", typed by you" : ""}`}</Txt>
        </View>
      )}
      {logged.length === 0 || measure === undefined ? null : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {logged.map((k) => (
              <Chip key={k} small label={MEASURES.find((m) => m.key === k)?.name ?? k} on={k === key} onPress={() => { setPicked(k); }} />
            ))}
          </ScrollView>
          <View style={styles.chart}>
            <View style={styles.chartHead}>
              <Txt kind="tiny" style={styles.grow} numberOfLines={2}>
                {points.length === 1 ? `${measure.name} · your first entry` : `${measure.name} · your last ${String(points.length)} entries`}
              </Txt>
              {change === null ? null : (
                <View style={styles.change}>
                  <Txt kind="tiny" colour="orangeLight" style={styles.changeWords}>
                    {change.words}
                  </Txt>
                </View>
              )}
            </View>
            <BodyChart
              key={key}
              points={points}
              say={`${measure.name}: ${points.map((p) => `${shownWithUnit(p.value, measure.kind, units)} on ${dateWords(p.day)}`).join(", ")}`}
            />
          </View>
        </>
      )}
      <View style={styles.entries}>
        <Txt kind="tiny" style={styles.heading}>
          Recent entries
        </Txt>
        {items.slice(0, SHOWN_ENTRIES).map((m) => {
          const w = entryWords(m, units, waiting.has(m.id));
          return (
            <View key={m.id} style={[styles.entry, waiting.has(m.id) ? styles.entryWaiting : null]}>
              <View style={styles.grow} accessible accessibilityLabel={`${w.date}, ${w.how}, ${w.weight}${w.more === null ? "" : `, ${w.more}`}`}>
                <Txt kind="strong">{w.date}</Txt>
                <Txt kind="tiny" colour={waiting.has(m.id) ? "orangeLight" : "textFaint"}>
                  {w.more === null ? w.how : `${w.how} · ${w.more}`}
                </Txt>
              </View>
              <Txt kind="strong">{w.weight}</Txt>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove the entry of ${w.date}`} onPress={() => { onRemove(m); }} style={styles.bin}>
                <Icon name="trash" size={17} colour="textSoft" />
              </Pressable>
            </View>
          );
        })}
      </View>
    </>
  );
}

function LogSheet({ open, units, last, onClose, onSave }: {
  open: boolean;
  units: string;
  last: Partial<Record<MeasureKey, number>>;
  onClose: () => void;
  onSave: (entry: { weightKg: number | null; metrics: Record<string, number> }) => Promise<string | null>;
}) {
  const [typed, setTyped] = useState<Typed>({});
  const [errors, setErrors] = useState<Partial<Record<MeasureKey, string>>>({});
  const [trouble, setTrouble] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTyped({});
    setErrors({});
    setTrouble(null);
  }, [open]);
  const hint = (key: MeasureKey, kind: "weight" | "pct" | "length") => {
    const v = last[key];
    return v === undefined ? "" : `Last ${shown(v, kind, units)}`;
  };
  const save = async () => {
    const built = buildEntry(typed, units);
    if (!built.ok) {
      setErrors(built.errors);
      setTrouble(built.none ? "Enter at least one measurement." : null);
      return;
    }
    setSaving(true);
    const problem = await onSave({ weightKg: built.weightKg, metrics: built.metrics });
    setSaving(false);
    setTrouble(problem);
  };
  const field = (m: (typeof MEASURES)[number], wide: boolean) => (
    <View key={m.key} style={wide ? null : styles.half}>
      <Field
        label={`${m.name} · ${unitOf(m.kind, units)}`}
        value={typed[m.key] ?? ""}
        onChange={(v) => {
          setTyped((t) => ({ ...t, [m.key]: v }));
          setErrors((e) => ({ ...e, [m.key]: undefined }));
          setTrouble(null);
        }}
        placeholder={hint(m.key, m.kind)}
        keyboard="decimal-pad"
        maxLength={7}
      />
      {errors[m.key] === undefined ? null : (
        <Txt kind="tiny" colour="badText">
          {errors[m.key]}
        </Txt>
      )}
    </View>
  );
  const [weight, ...more] = MEASURES;
  return (
    <Sheet open={open} title="Log measurements" onClose={onClose} picture={{ name: "anatomy", focus: 0.35 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
        {weight === undefined ? null : field(weight, true)}
        <Txt kind="eyebrow" colour="orange">
          More measurements
        </Txt>
        <View style={styles.grid}>{more.map((m) => field(m, false))}</View>
        {trouble === null ? null : (
          <Txt kind="small" colour="badText">
            {trouble}
          </Txt>
        )}
        <View style={styles.foot}>
          <Button label="Cancel" kind="link" onPress={onClose} />
          <Button label={saving ? "Saving…" : "Save"} wide busy={saving} style={styles.grow} onPress={() => { void save(); }} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function RemoveSheet({ entry, units, onClose, onRemove }: { entry: BodyMeasurement | null; units: string; onClose: () => void; onRemove: (m: BodyMeasurement) => void }) {
  const w = entry === null ? null : entryWords(entry, units, false);
  return (
    <Sheet open={entry !== null} title="Remove this entry?" onClose={onClose} picture={{ name: "anatomy", focus: 0.35 }}>
      {entry === null || w === null ? null : (
        <>
          <View style={styles.entry}>
            <View style={styles.grow}>
              <Txt kind="strong">{w.date}</Txt>
              <Txt kind="tiny">{holdsWords(entry)}</Txt>
            </View>
            <Txt kind="strong">{w.weight}</Txt>
          </View>
          <View style={styles.foot}>
            <Button label="Cancel" kind="link" onPress={onClose} />
            <Button label="Remove" kind="danger" wide style={styles.grow} onPress={() => { onRemove(entry); }} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  bigRow: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  chips: { gap: 8, paddingRight: 8 },
  chart: { gap: 8, padding: 12, borderRadius: 16, backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.line },
  chartHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  change: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine },
  changeWords: { fontFamily: fonts.bold },
  entries: { gap: 8 },
  heading: { fontFamily: fonts.bold, textTransform: "uppercase", letterSpacing: 0.9 },
  entry: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, minHeight: 56, borderRadius: 14, backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.line },
  entryWaiting: { borderColor: colours.orangeLine },
  bin: { width: 44, height: 44, marginVertical: -6, marginRight: -6, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  refused: { flexDirection: "row", alignItems: "center", gap: 8 },
  form: { gap: 12, paddingBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  half: { flexBasis: "47%", flexGrow: 1 },
  foot: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 4 },
});
