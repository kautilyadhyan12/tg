// The running questions (ROADMAP Stage 5 item 37d-i; RULINGS 2026-09-13: asked in the running feature,
// never in setup): do you run, how long you can jog, the days and the distance you aim for, and for
// somebody who can already jog 30 minutes their running now. One question a page; what was answered
// before is already picked.
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { RACE_DISTANCES_M, runPlanResponseSchema, vdotOf, type JogBand, type RaceTime, type RunDoesRun, type RunGoal, type RunPlanAnswers, type RunPlanResponse, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { Options } from "../../look/Choice";
import { Chip } from "../../look/Chip";
import { CoverPage } from "../../look/CoverPage";
import { Ruler } from "../../look/Ruler";
import { colours, sizes } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { RUN_PLAN_PATH } from "./RunPlanBox";
import { GOAL_WORDS, weekdayShort } from "./runPlanWords";
import { METRES_PER_MILE, clock } from "./runWords";

type Step = "run" | "jog" | "days" | "runner";

export const JOG_OPTIONS: readonly { value: JogBand; label: string }[] = [
  { value: "none", label: "I can’t jog yet" },
  { value: "upto5", label: "Up to 5 minutes" },
  { value: "5to10", label: "5 to 10 minutes" },
  { value: "10to20", label: "10 to 20 minutes" },
  { value: "20to30", label: "20 to 30 minutes" },
  { value: "30plus", label: "30 minutes or more" },
];
const RUN_OPTIONS: readonly { value: RunDoesRun; label: string; desc?: string }[] = [
  { value: "yes", label: "Yes, I run" },
  { value: "start", label: "I want to start" },
  { value: "no", label: "Not for me", desc: "No plan. You can make one any time." },
];
const RACE_WORDS: Record<(typeof RACE_DISTANCES_M)[number], string> = { 1609: "1 mile", 5000: "5K", 10000: "10K", 21097: "Half marathon", 42195: "Marathon" };

const per = (units: Units): number => (units === "imperial" ? METRES_PER_MILE : 1000);
/** The scale's rows, in metres: whole units up to `most`, or halves. */
const rowsOf = (units: Units, most: number, half: boolean): number[] =>
  Array.from({ length: most * (half ? 2 : 1) + 1 }, (_, i) => Math.round((i / (half ? 2 : 1)) * per(units)));
const unitShown = (metres: number, units: Units): string => {
  const n = Math.round((metres / per(units)) * 2) / 2;
  return `${String(n)} ${units === "imperial" ? "mi" : "km"}`;
};
/** Every time the race could be run in that Daniels' tables read, a step apart. */
export const raceRows = (distanceM: RaceTime["distanceM"]): number[] => {
  const step = distanceM <= 1609 ? 5 : distanceM <= 10000 ? 10 : 30;
  const rows: number[] = [];
  for (let s = step; s <= 36_000; s += step) if (vdotOf({ distanceM, timeS: s }) !== null) rows.push(s);
  return rows;
};

export function RunPlanAsk({ open, units, before, onClose, onSaved }: { open: boolean; units: Units; before: RunPlanAnswers | null; onClose: () => void; onSaved: (reply: RunPlanResponse) => void }) {
  const { session } = useSession();
  const [step, setStep] = useState<Step>("run");
  const [doesRun, setDoesRun] = useState<RunDoesRun | null>(null);
  const [jog, setJog] = useState<JogBand | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [goal, setGoal] = useState<RunGoal | null>(null);
  const [weeklyM, setWeeklyM] = useState<number | null>(null);
  const [longestM, setLongestM] = useState<number | null>(null);
  const [race, setRace] = useState<RaceTime | null>(null);
  const [raceDistance, setRaceDistance] = useState<RaceTime["distanceM"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Opened: the answers given before are picked, and it starts at the first question.
  useEffect(() => {
    if (!open) return;
    const a = before !== null && before.doesRun !== "no" ? before : null;
    setStep("run");
    setDoesRun(a?.doesRun ?? null);
    setJog(a?.jog ?? null);
    setDays(a?.days ?? []);
    setGoal(a?.goal ?? null);
    setWeeklyM(a?.weeklyM ?? null);
    setLongestM(a?.longestM ?? null);
    setRace(a?.race ?? null);
    setRaceDistance(a?.race?.distanceM ?? null);
    setProblem(null);
  }, [open, before]);

  const runner = jog === "30plus";
  const send = async (answers: RunPlanAnswers) => {
    setSaving(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "PUT", path: RUN_PLAN_PATH, body: answers }, runPlanResponseSchema);
    setSaving(false);
    if (answer.kind !== "ok") {
      setProblem("Couldn’t make your plan. Check your connection and try again.");
      return;
    }
    onSaved(answer.data);
  };
  const make = () => {
    if (doesRun === null || doesRun === "no" || jog === null || goal === null) return;
    void send({
      doesRun,
      jog,
      days: [...days].sort((a, b) => a - b),
      goal,
      weeklyM: runner ? weeklyM : null,
      longestM: runner ? longestM : null,
      race: runner ? race : null,
    });
  };

  const order: Step[] = runner ? ["run", "jog", "days", "runner"] : ["run", "jog", "days"];
  const at = Math.max(0, order.indexOf(step));
  const back = at > 0 ? () => { setStep(order[at - 1] ?? "run"); } : null;
  const daysReady = days.length >= 2 && goal !== null;
  const runnerReady = weeklyM !== null && longestM !== null && (raceDistance === null || race !== null);

  const foot =
    step === "days" ? (
      <Button label={runner ? "Next" : "Make my plan"} wide disabled={!daysReady} busy={saving} onPress={() => { if (runner) setStep("runner"); else make(); }} />
    ) : step === "runner" ? (
      <Button label="Make my plan" wide disabled={!runnerReady} busy={saving} onPress={make} />
    ) : undefined;

  return (
    <CoverPage open={open} title="Your run plan" onClose={onClose} {...(foot === undefined ? {} : { foot })}>
      <View style={styles.steps}>
        <View style={styles.bar} accessible accessibilityLabel={`Question ${String(at + 1)} of ${String(order.length)}`}>
          {order.map((s, i) => (
            <View key={s} style={[styles.segment, i <= at ? styles.segmentOn : null]} />
          ))}
        </View>
        {back === null ? null : <Button kind="link" label="Back" say="Back to the last question" onPress={back} />}
      </View>
      {step === "run" ? (
        <View style={styles.q}>
          <Txt kind="h2">Do you run now?</Txt>
          <Options
            options={RUN_OPTIONS}
            selected={doesRun}
            disabled={saving}
            onPick={(value) => {
              setDoesRun(value);
              if (value === "no") void send({ doesRun: "no", jog: null, days: [], goal: null, weeklyM: null, longestM: null, race: null });
              else setStep("jog");
            }}
          />
        </View>
      ) : step === "jog" ? (
        <View style={styles.q}>
          <Txt kind="h2">How long can you jog without stopping?</Txt>
          <Txt kind="small">At an easy pace, where you could still talk.</Txt>
          <Options
            options={JOG_OPTIONS}
            selected={jog}
            onPick={(value) => {
              setJog(value);
              setStep("days");
            }}
          />
        </View>
      ) : step === "days" ? (
        <View style={styles.q}>
          <Txt kind="h2">Which days can you run?</Txt>
          <Txt kind="small">{runner ? "Pick two or more." : "Pick two or more. The plan runs three days a week, with a rest day between."}</Txt>
          <View style={styles.days}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = days.includes(d);
              return (
                <Pressable
                  key={d}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={weekdayShort(d)}
                  onPress={() => { setDays((was) => (was.includes(d) ? was.filter((x) => x !== d) : [...was, d])); }}
                  style={[styles.day, on ? styles.dayOn : null]}
                >
                  <Txt kind="small" colour={on ? "onOrange" : "textSoft"} style={styles.dayWord} numberOfLines={1}>
                    {weekdayShort(d)}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <Txt kind="h3" style={styles.gap}>
            What are you aiming for?
          </Txt>
          <Txt kind="small">{runner ? "Your plan grows until you’re ready for it." : "After Couch to 5K, your plan grows towards it."}</Txt>
          <View style={styles.chips}>
            {(["5k", "10k", "half"] as const).map((g) => (
              <Chip key={g} label={GOAL_WORDS[g]} on={goal === g} onPress={() => { setGoal(g); }} />
            ))}
          </View>
          <Problem words={problem} />
        </View>
      ) : (
        <View style={styles.q}>
          <Txt kind="h2">Your running now</Txt>
          <Ruler
            label="How far you run in a usual week"
            rows={rowsOf(units, units === "imperial" ? 100 : 150, false)}
            index={weeklyM === null ? 15 : Math.round(weeklyM / per(units))}
            isSet={weeklyM !== null}
            shown={(m) => unitShown(m, units)}
            major={(m) => (Math.round(m / per(units)) % 10 === 0 ? String(Math.round(m / per(units))) : null)}
            mid={(m) => Math.round(m / per(units)) % 5 === 0}
            onPick={(i) => { setWeeklyM(Math.round(i * per(units))); }}
          />
          <Ruler
            label="Your longest run in the last month"
            rows={rowsOf(units, units === "imperial" ? 26 : 42, true)}
            index={longestM === null ? 10 : Math.round((longestM / per(units)) * 2)}
            isSet={longestM !== null}
            shown={(m) => unitShown(m, units)}
            major={(m) => (Math.round((m / per(units)) * 2) % 10 === 0 ? String(Math.round(m / per(units))) : null)}
            mid={(m) => Math.round((m / per(units)) * 2) % 2 === 0}
            onPick={(i) => { setLongestM(Math.round((i / 2) * per(units))); }}
          />
          <Txt kind="h3" style={styles.gap}>
            A race time from the last 6 weeks
          </Txt>
          <Txt kind="small">Optional. It sets your paces; without one, you run by feel.</Txt>
          <View style={styles.chips}>
            <Chip label="None" small on={raceDistance === null} onPress={() => { setRaceDistance(null); setRace(null); }} />
            {RACE_DISTANCES_M.map((m) => (
              <Chip key={m} label={RACE_WORDS[m]} small on={raceDistance === m} onPress={() => { setRaceDistance(m); setRace(null); }} />
            ))}
          </View>
          {raceDistance === null ? null : (
            <RaceRuler distanceM={raceDistance} race={race} onPick={setRace} />
          )}
          <Problem words={problem} />
        </View>
      )}
    </CoverPage>
  );
}

function RaceRuler({ distanceM, race, onPick }: { distanceM: RaceTime["distanceM"]; race: RaceTime | null; onPick: (race: RaceTime) => void }) {
  const rows = useMemo(() => raceRows(distanceM), [distanceM]);
  const held = race !== null && race.distanceM === distanceM ? rows.indexOf(race.timeS) : -1;
  const minute = distanceM >= 21097 ? 600 : distanceM >= 5000 ? 60 : 30;
  return (
    <Ruler
      label={`Your ${RACE_WORDS[distanceM]} time`}
      rows={rows}
      index={held >= 0 ? held : Math.floor(rows.length / 3)}
      isSet={held >= 0}
      shown={(s) => clock(s)}
      major={(s) => (s % (minute * 5) === 0 ? clock(s) : null)}
      mid={(s) => s % minute === 0}
      onPick={(i) => {
        const timeS = rows[i];
        if (timeS !== undefined) onPick({ distanceM, timeS });
      }}
    />
  );
}

function Problem({ words }: { words: string | null }) {
  return words === null ? null : (
    <Txt kind="small" colour="badText">
      {words}
    </Txt>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.press },
  bar: { flex: 1, flexDirection: "row", gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colours.lineStrong },
  segmentOn: { backgroundColor: colours.orange },
  days: { flexDirection: "row", gap: 6 },
  day: { flex: 1, minHeight: sizes.press, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.fill, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  dayOn: { borderColor: colours.orange, backgroundColor: colours.orange },
  dayWord: { fontFamily: fonts.semibold },
  q: { gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gap: { marginTop: 10 },
});
