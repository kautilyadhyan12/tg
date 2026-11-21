import { stretchesFor, workoutAfterSchema, type AfterIdea, type RefusedWorkout, type WorkoutAfter, type WorkoutSave } from "@app/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Button } from "../../look/Button";
import { Segments } from "../../look/Choice";
import { colours, raisedOrangeGradient, shadows, sizes, type ColourName } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Rise, useGrow, useMotion } from "../../look/Motion";
import { PictureTop } from "../../look/PictureTop";
import { pictures } from "../../look/pictures";
import { fonts, Txt } from "../../look/Txt";
import { libraryFile } from "../../library/files";
import { exercisePicture } from "../../library/pictures";
import type { Units } from "../../library/records";
import { readKept } from "../../library/store";
import type { Finished } from "../../library/workoutRunStore";
import type { WaitingView } from "../../session/waitingList";
import { useSession } from "../../session/SessionProvider";
import { ideaAmountWords } from "../food/ideaRules";
import { Led } from "../library/Records";
import { ProgressPage } from "../progress/ProgressPage";
import {
  exerciseBlocks,
  ideaTotals,
  kcalLine,
  recordRow,
  setsHeading,
  starSay,
  starWords,
  streakNext,
  streakWords,
  waterWords,
  WHEN_WORDS,
  xpNext,
  xpShare,
  xpWhy,
} from "./afterWords";
import { clock } from "./words";
import type { EffortHand } from "./WorkoutLayer";

// A workout's last screen (ROADMAP Stage 5 64a-iii, Kd's drawing of 2026-11-21, its fonts and glow brought down at his
// word): confetti, the wall timer with the time, calories and sets, whether it is saved, then Results (XP and level, the
// streak, new records, how hard it was), Sets (every set done) and Recover (meal ideas, cool-down stretches, water).
// What the phone holds shows at once, with no internet; what the server works out (calories, XP, records, meal ideas)
// fills in once the workout is on the server.

export const summaryPath = (workoutId: string): string => `/v1/training/workouts/${encodeURIComponent(workoutId)}/summary`;

type After = { kind: "loading" } | { kind: "ok"; data: WorkoutAfter } | { kind: "failed" };

/** The server's part, read once the workout is saved; Try again reads it again. */
function useAfter(workoutId: string, saved: boolean): { after: After; again: () => void } {
  const { session } = useSession();
  const [after, setAfter] = useState<After>({ kind: "loading" });
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!saved) return undefined;
    const alive = { now: true };
    void session.signedIn({ method: "GET", path: summaryPath(workoutId) }, workoutAfterSchema).then((answer) => {
      if (!alive.now) return;
      if (answer.kind === "ok") setAfter({ kind: "ok", data: answer.data });
      else setAfter((before) => (before.kind === "ok" ? before : { kind: "failed" }));
    });
    return () => {
      alive.now = false;
    };
  }, [session, workoutId, saved, asked]);
  const again = useCallback(() => {
    setAfter({ kind: "loading" });
    setAsked((n) => n + 1);
  }, []);
  return { after, again };
}

/** The main muscles of the workout's exercises, from the Library kept on the phone, so the stretches show with no
 *  internet; null until it is read. */
function useMainMuscles(exercises: readonly string[]): string[] | null {
  const { state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [muscles, setMuscles] = useState<string[] | null>(null);
  const key = exercises.join("|");
  useEffect(() => {
    if (me === null) return undefined;
    const alive = { now: true };
    const wanted = new Set(key.split("|"));
    void readKept(libraryFile(me)).then((kept) => {
      if (!alive.now) return;
      setMuscles((kept?.exercises ?? []).filter((e) => wanted.has(e.id)).flatMap((e) => e.muscles.main));
    });
    return () => {
      alive.now = false;
    };
  }, [me, key]);
  return muscles;
}

type Tab = "results" | "sets" | "recover";
const TABS = [
  { value: "results", label: "Results" },
  { value: "sets", label: "Sets" },
  { value: "recover", label: "Recover" },
] as const;

interface Props {
  finished: Finished;
  /** The finished workout is kept in its own file alone, not yet in the waiting list's. */
  keeping: boolean;
  waiting: WaitingView<WorkoutSave, RefusedWorkout>;
  effort: EffortHand;
  units: Units;
  onDone: () => void;
  onNewWorkout: () => void;
}

export function Summary({ finished, keeping, waiting, effort, units, onDone, onNewWorkout }: Props) {
  const insets = useSafeAreaInsets();
  const id = finished.workoutId;
  const refused = waiting.refused.some((r) => r.workoutId === id);
  const waits = waiting.waiting.some((w) => w.workoutId === id);
  const saved = !refused && !waits && !keeping && waiting.sent.includes(id);
  // On the phone, waiting for the server or for room in the waiting list: never "online", as the reason may be another.
  const onPhone = !refused && !saved && (keeping || (waits && waiting.held));
  const title = refused ? "This workout couldn't be saved." : saved ? "Saved to your account" : onPhone ? "Saved on this phone" : "Saving…";
  const { after, again } = useAfter(id, saved);
  const known = after.kind === "ok" ? after.data : null;
  const [tab, setTab] = useState<Tab>("results");
  const [stars, setStars] = useState<number | null>(null);
  const [weighing, setWeighing] = useState(false);
  const shownStars = stars ?? known?.effort ?? null;
  const starsWait = effort.view.waiting.some((e) => e.workoutId === id);

  const blocks = useMemo(() => exerciseBlocks(finished.done, finished.plan, known?.records ?? [], units), [finished, known, units]);
  const muscles = useMainMuscles(blocks.map((b) => b.exercise));
  const stretches = muscles === null ? [] : stretchesFor(muscles);

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <PictureTop
          picture="exhero"
          tall={0.7}
          eyebrow="Workout complete"
          title={finished.name.trim() === "" ? "Workout" : finished.name.trim()}
          above={
            <View style={styles.tick}>
              <Icon name="check" size={24} colour="onOrange" />
            </View>
          }
        />
        <View style={styles.body}>
          <View style={[styles.wall, styles.tiles]}>
            <Tile label="Time" text={clock(finished.activeMs)} colour="ledAmber" />
            <Tile
              label="Kcal"
              text={known?.kcalPoint === null || known === null ? "888" : String(known.kcalPoint)}
              colour={known === null || known.kcalPoint === null ? "ledOff" : "ledRed"}
              say={known === null || known.kcalPoint === null ? "not yet known" : `about ${String(known.kcalPoint)} calories`}
            />
            <Tile label="Sets" text={String(finished.sets).padStart(2, "0")} colour="ledGreen" say={String(finished.sets)} />
          </View>
          {known === null || known.kcalPoint === null ? null : (
            <Rise>
              <View style={styles.kcalRow}>
                <Txt kind="small" style={styles.centre}>
                  {kcalLine(known.kcalPoint, known.weightKg, units)}
                </Txt>
                {known.weightKg === null ? (
                  <Button
                    label="Add your weight"
                    kind="link"
                    small
                    style={styles.self}
                    onPress={() => {
                      setWeighing(true);
                    }}
                  />
                ) : null}
              </View>
            </Rise>
          )}
          <View style={[styles.saveLine, saved ? styles.saveGood : refused ? styles.saveBad : styles.saveWait]}>
            <Icon name={saved ? "check" : refused ? "warn" : "phone"} size={22} colour={saved ? "goodText" : refused ? "badText" : "orangeLight"} />
            <View style={styles.grow}>
              <Txt kind="strong">{title}</Txt>
              {onPhone ? <Txt kind="small">It goes to your account as soon as it can.</Txt> : null}
            </View>
          </View>
          <Segments options={TABS} selected={tab} onPick={setTab} />

          {tab === "results" ? (
            <View style={styles.part}>
              {refused ? null : known === null ? (
                <Waiting saving={!onPhone && after.kind !== "failed"} words={onPhone ? "Your XP and records show here once this workout reaches your account." : after.kind === "failed" ? "Couldn't load your XP and records." : "Adding up your XP and records…"} onAgain={after.kind === "failed" ? again : null} />
              ) : (
                <>
                  <XpBox after={known} />
                  {known.records.length === 0 ? null : (
                    <Rise delay={150}>
                      <View style={styles.records}>
                        <View style={styles.row}>
                          <Icon name="bell" size={22} colour="gold" />
                          <Txt kind="eyebrow" colour="gold" style={styles.grow}>
                            {`New records · ${String(known.records.length)}`}
                          </Txt>
                        </View>
                        {known.records.map((r) => {
                          const row = recordRow(r, finished.done, units);
                          return (
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
                          );
                        })}
                      </View>
                    </Rise>
                  )}
                </>
              )}
              {refused ? null : (
                <View style={styles.starsBox}>
                  <Txt kind="h3">How hard was it?</Txt>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const lit = shownStars !== null && n <= shownStars;
                      return (
                        <Pressable
                          key={n}
                          accessibilityRole="button"
                          accessibilityLabel={starSay(n)}
                          accessibilityState={{ selected: shownStars === n }}
                          onPress={() => {
                            setStars(n);
                            effort.give(id, n);
                          }}
                          style={styles.star}
                        >
                          <Icon name="star" size={30} colour={lit ? "ledAmber" : "textFaint"} filled={lit} />
                        </Pressable>
                      );
                    })}
                  </View>
                  <Txt kind="small" colour={shownStars === null ? "textSoft" : "ledAmber"}>
                    {starWords(shownStars, starsWait, onPhone && shownStars !== null)}
                  </Txt>
                </View>
              )}
            </View>
          ) : null}

          {tab === "sets" ? (
            <View style={styles.part}>
              <Txt kind="body">{setsHeading(blocks)}</Txt>
              {blocks.map((b) => (
                <View key={b.key} style={styles.box}>
                  <View style={[styles.row, styles.blockTop]}>
                    <Image source={pictures[exercisePicture(b.exercise, b.kind)]} resizeMode="cover" style={styles.thumb} accessible={false} />
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
          ) : null}

          {tab === "recover" ? (
            <View style={styles.part}>
              {refused ? null : (
                <View style={styles.part}>
                  <Txt kind="eyebrow">Eat after it</Txt>
                  {known === null ? (
                    <Txt kind="body">{after.kind === "failed" ? "Couldn't load meal ideas." : "Meal ideas show here once this workout reaches your account."}</Txt>
                  ) : known.food.ideas.length === 0 ? (
                    <Txt kind="body">You have eaten today's calories, so there is no meal to suggest.</Txt>
                  ) : (
                    <>
                      {known.food.ideas.map((i) => (
                        <Idea key={i.when} idea={i} />
                      ))}
                      <Txt kind="small">{known.food.caution}</Txt>
                      {known.food.labelCaution === null ? null : <Txt kind="small">{known.food.labelCaution}</Txt>}
                    </>
                  )}
                </View>
              )}
              {stretches.length === 0 ? null : (
                <View style={[styles.box, styles.stretchBox]}>
                  <View style={styles.stretchTop}>
                    <Image source={pictures.greekyoga} resizeMode="cover" style={styles.stretchPicture} accessible={false} />
                    <View style={[StyleSheet.absoluteFill, styles.stretchFade]} />
                    <Txt kind="eyebrow" style={styles.stretchWords}>
                      Cool-down stretches
                    </Txt>
                  </View>
                  {stretches.map((s, i) => (
                    <View key={s.name} style={[styles.row, styles.stretchRow]}>
                      <View style={styles.stretchNumber}>
                        <Txt kind="tiny" colour="goodText">
                          {String(i + 1)}
                        </Txt>
                      </View>
                      <View style={styles.grow}>
                        <Txt kind="strong">{s.name}</Txt>
                        <Txt kind="small">{s.howLong}</Txt>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.water}>
                <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
                  <Path d="M12 2.8c3 3.8 6 7.3 6 11a6 6 0 0 1-12 0c0-3.7 3-7.2 6-11Z" fill={colours.blue} />
                </Svg>
                <Txt kind="body" colour="text" style={styles.grow}>
                  {waterWords(units)}
                </Txt>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: insets.bottom + 10 }]}>
        <Button label="New workout" kind="link" onPress={onNewWorkout} />
        <View style={styles.grow}>
          <Button label="Done" wide onPress={onDone} style={styles.done} />
        </View>
      </View>
      <Confetti />
      <ProgressPage
        open={weighing}
        first="body"
        onClose={() => {
          setWeighing(false);
        }}
      />
    </View>
  );
}

function Tile({ label, text, colour, say }: { label: string; text: string; colour: ColourName; say?: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}, ${say ?? text}`}>
      <Txt kind="tiny" style={styles.label}>
        {label.toUpperCase()}
      </Txt>
      <Led text={text} colour={colour} height={26} />
    </View>
  );
}

function Waiting({ saving, words, onAgain }: { saving: boolean; words: string; onAgain: (() => void) | null }) {
  return (
    <View style={styles.waitRow}>
      {saving ? <Icon name="clock" size={18} colour="orangeLight" /> : null}
      <Txt kind="body" style={styles.grow}>
        {words}
      </Txt>
      {onAgain === null ? null : <Button label="Try again" kind="link" small onPress={onAgain} />}
    </View>
  );
}

function XpBox({ after }: { after: WorkoutAfter }) {
  const share = useGrow(xpShare(after.xp.view), 300, 1100);
  const width = share.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  return (
    <Rise>
      <View style={styles.box}>
        <View style={styles.row}>
          <View style={styles.coin}>
            <Icon name="zap" size={18} colour="onLight" filled />
          </View>
          <View style={styles.grow}>
            <Txt kind="big" colour="ledAmber" style={styles.digits}>{`+${String(after.xp.earned)} XP`}</Txt>
            <Txt kind="small">{xpWhy(after.xp.forWorkout, after.xp.forStreak)}</Txt>
          </View>
          <View style={styles.levelSide}>
            <Txt kind="eyebrow" colour="textSoft">
              Level
            </Txt>
            <Txt kind="big">{String(after.xp.view.level)}</Txt>
          </View>
        </View>
        <View style={styles.bar} accessible accessibilityLabel={`Level ${String(after.xp.view.level)}, ${xpNext(after.xp.view)}`}>
          <Animated.View style={[styles.barFill, { width }]} />
        </View>
        <Txt kind="small" style={styles.digits}>
          {xpNext(after.xp.view)}
        </Txt>
        {after.streak > 0 ? (
          <View style={[styles.row, styles.streak]}>
            <Icon name="flame" size={22} colour="orange" filled />
            {/* One under the other: side by side, a small phone cut the streak's own words. */}
            <View style={styles.grow}>
              <Txt kind="strong">{streakWords(after.streak)}</Txt>
              <Txt kind="small">{streakNext(after.streak)}</Txt>
            </View>
          </View>
        ) : null}
      </View>
    </Rise>
  );
}

function Idea({ idea }: { idea: AfterIdea }) {
  return (
    <View style={[styles.box, styles.row, styles.ideaBox]}>
      <Image source={pictures[idea.when === "soon" ? "mealsnack" : "meallunch"]} resizeMode="cover" style={styles.ideaPicture} accessible={false} />
      <View style={[styles.grow, styles.ideaWords]}>
        <Txt kind="eyebrow" colour="orangeLight">
          {WHEN_WORDS[idea.when]}
        </Txt>
        {idea.idea.items.map((f) => (
          <Txt key={f.canonical} kind="strong">
            {f.name}
            <Txt kind="body">{`  ${ideaAmountWords(f)}`}</Txt>
          </Txt>
        ))}
        <Txt kind="small">{ideaTotals(idea.idea)}</Txt>
      </View>
    </View>
  );
}

const PIECES = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  w: 6 + (i % 3) * 2,
  h: 8 + (i % 4) * 2,
  colour: (["orange", "ledAmber", "ledGreen", "ledRed", "blue", "gold"] as const)[i % 6] ?? "orange",
  delay: Math.round(((i * 0.13) % 1.6) * 1000),
  duration: Math.round((2.4 + (i % 5) * 0.35) * 1000),
  round: i % 3 === 0,
}));

/** Confetti falling once over the screen as it opens; none where the phone asks for no motion. */
function Confetti() {
  const on = useMotion();
  const fall = useRef(PIECES.map(() => new Animated.Value(0))).current;
  const [room, setRoom] = useState({ width: 400, height: 900 });
  useEffect(() => {
    if (!on) return undefined;
    const runs = fall.map((v, i) => Animated.timing(v, { toValue: 1, duration: PIECES[i]?.duration ?? 2400, delay: PIECES[i]?.delay ?? 0, easing: Easing.in(Easing.quad), useNativeDriver: true }));
    const all = Animated.parallel(runs);
    all.start();
    return () => {
      all.stop();
    };
  }, [on, fall]);
  if (!on) return null;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        setRoom({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
      }}
    >
      {PIECES.map((p, i) => {
        const v = fall[i];
        if (v === undefined) return null;
        const y = v.interpolate({ inputRange: [0, 1], outputRange: [-20, room.height + 20] });
        const turn = v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "760deg"] });
        const fade = v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.left * 100 + p.w}
            style={{ position: "absolute", left: (room.width * p.left) / 100, top: 0, width: p.w, height: p.h, borderRadius: p.round ? sizes.round : 2, backgroundColor: colours[p.colour], opacity: fade, transform: [{ translateY: y }, { rotate: turn }] }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  scroll: { flexGrow: 1, paddingBottom: 16 },
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  self: { alignSelf: "center" },
  digits: { fontVariant: ["tabular-nums"] },
  body: { paddingHorizontal: 16, paddingTop: 6, gap: 12 },
  part: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  tick: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", experimental_backgroundImage: raisedOrangeGradient },
  wall: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 22, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  tiles: { flexDirection: "row", paddingVertical: 14 },
  tile: { flex: 1, alignItems: "center", gap: 10 },
  label: { fontFamily: fonts.bold, letterSpacing: 1.1, color: colours.timerWords },
  kcalRow: { alignItems: "center", gap: 2, marginTop: -4 },
  saveLine: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, borderWidth: 1 },
  saveGood: { borderColor: colours.goodLine, backgroundColor: colours.goodFill },
  saveBad: { borderColor: colours.badLine, backgroundColor: colours.badFill },
  saveWait: { borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  waitRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  box: { gap: 10, padding: 14, borderRadius: 22, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  coin: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colours.gold },
  levelSide: { alignItems: "flex-end" },
  bar: { height: 8, borderRadius: sizes.round, backgroundColor: colours.track, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: sizes.round, backgroundColor: colours.ledAmber },
  streak: { paddingTop: 12, borderTopWidth: 1, borderTopColor: colours.line },
  records: { gap: 8, padding: 14, borderRadius: 22, borderWidth: 1, borderColor: colours.goldLine, backgroundColor: colours.goldFill },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  medal: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colours.gold },
  medalWords: { fontFamily: fonts.bold, color: colours.onLight },
  starsBox: { alignItems: "center", gap: 8, padding: 14, borderRadius: 22, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  starsRow: { flexDirection: "row", gap: 4 },
  star: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  blockTop: { paddingBottom: 4 },
  thumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: colours.box },
  setRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colours.line },
  setNumber: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colours.fill },
  prTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: sizes.round, backgroundColor: colours.gold },
  ideaBox: { alignItems: "flex-start" },
  ideaPicture: { width: 64, height: 64, borderRadius: 16, backgroundColor: colours.box },
  ideaWords: { gap: 3 },
  stretchBox: { padding: 0, paddingBottom: 14, overflow: "hidden" },
  // The picture is a band at the box's top, cut to it: never over the stretches' words.
  stretchTop: { height: 110, overflow: "hidden", justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 6 },
  stretchPicture: { position: "absolute", top: 0, left: 0, right: 0, height: 110, width: undefined },
  stretchFade: { experimental_backgroundImage: `linear-gradient(180deg, transparent 30%, ${colours.raised} 100%)` },
  stretchWords: { color: colours.orange },
  stretchRow: { paddingHorizontal: 16 },
  stretchNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colours.goodLine, backgroundColor: colours.goodFill },
  water: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, borderWidth: 1, borderColor: colours.blue, backgroundColor: colours.blueFill },
  // The one main button keeps a faint glow, nothing more (Kd at the drawing: "orange glowing too much").
  done: { boxShadow: shadows.buttonSoft },
  foot: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colours.page },
});
