import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  foodSearchResponseSchema,
  mealMeasuresResponseSchema,
  mealPageSchema,
  mealPreviewSchema,
  nutritionTargetsResponseSchema,
  recentFoodsResponseSchema,
  type ChosenItem,
  type FoodMeasure,
  type FoodSearchItem,
  type MealEditItem,
  type MealItem,
  type MealPreview,
  type MealType,
  type NutritionTargetsResponse,
  type RecentFood,
  type SetupScreenId,
  type WaitingChange,
  missingText,
} from "@app/shared";
import { Button } from "../look/Button";
import { Card } from "../look/Card";
import { Chip } from "../look/Chip";
import { colours, sizes } from "../look/colours";
import { Field } from "../look/Field";
import { Icon } from "../look/Icon";
import { Page } from "../look/Page";
import { PictureTop } from "../look/PictureTop";
import { Ring } from "../look/Ring";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { useZoneSaved } from "../session/TimeZoneSync";
import { NOT_KNOWN, count } from "./dashboard/words";
import { useRead } from "./dashboard/useRead";
import {
  MEAL_PAGE_SIZE,
  MEAL_TYPES,
  aboutKcal,
  addDays,
  daySums,
  dayWords,
  hasEstimate,
  inDay,
  itemMark,
  kcalWords,
  leftWords,
  mealTypeName,
  monthWeeks,
  monthWords,
  noCutWords,
  uncountedWords,
  sameDay,
  sectionOf,
  startOfDay,
  walkDay,
  type Sums,
} from "./food/day";
import { AmountPicker, dishByName, pickedDish, useDishes } from "./food/AmountPicker";
import { useMealOutbox } from "./food/MealOutbox";
import { MealPhoto } from "./food/MealPhoto";
import { useKeptSheet } from "./food/PhotoSheetStore";
import { holdWords } from "./food/numbers";
import { OwnNumbers } from "./food/OwnNumbers";
import {
  FILL_CHOICES,
  amountRefusal,
  chosenItem,
  dishMeasure,
  loggedAmount,
  startWords,
  startingAmount,
  underAGram,
  type Amount,
} from "./food/measures";
import {
  amountOf,
  clockWords,
  foodLines,
  foodsHeld,
  measuresWithoutServer,
  serverRow,
  steppedTime,
  totalsOf,
  totalsWithout,
  typedAmount,
  waitingRow,
  withAmount,
  withChanges,
  without,
  type Row,
} from "./food/rows";
import { newGoalId } from "./goals/words";
import { Credits, SOURCE_WORDS, SourceLine } from "./food/SourceLine";
import { Setup } from "./setup/Setup";

// The Food tab (ROADMAP Stage 5 items 32b-i and 32b-ii-a): the day's macros against the person's daily
// numbers, the day's four meals, a food added by search and measure or from the person's recent foods,
// a meal changed or removed. Every number is the server's. A meal logged, and a change to one, is kept
// on the phone until the server has it (food/outbox.ts).

export const TARGETS_READ = "/v1/nutrition/targets";
const NO_CONNECTION = "No connection. Try again.";
const MEAL_CHANGED_WORDS = "This meal was changed on another device. Close it and open it again.";

type DayRead = { kind: "loading" } | { kind: "ok"; rows: Row[]; cut: boolean } | { kind: "failed" };

/** The day's meals from the server, read when the tab opens, when the day changes, when the app comes
 *  back, and each time the server takes a waiting meal; only the newest read is drawn. A read that
 *  comes back tells the outbox how many sends it began after (`settle`): until then a meal just sent
 *  is shown as the server answered it, and one just removed stays hidden. */
function useDayMeals(day: Date, sent: number, settle: (upTo: number) => void): { read: DayRead; again: () => void } {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const zone = useZoneSaved();
  const [read, setRead] = useState<DayRead>({ kind: "loading" });
  const latest = useRef(0);
  const shown = useRef<number | null>(null);
  const sentNow = useRef(sent);
  sentNow.current = sent;

  const again = useCallback(() => {
    if (me === null) return;
    latest.current += 1;
    const mine = latest.current;
    const upTo = sentNow.current;
    const dayKey = day.getTime();
    if (shown.current !== dayKey) setRead({ kind: "loading" });
    void walkDay(async (cursor) => {
      const query = cursor === null ? `limit=${String(MEAL_PAGE_SIZE)}` : `limit=${String(MEAL_PAGE_SIZE)}&cursor=${encodeURIComponent(cursor)}`;
      const answer = await session.signedIn({ method: "GET", path: `/v1/nutrition/meals?${query}` }, mealPageSchema);
      return answer.kind === "ok" ? answer.data : null;
    }, day).then((walked) => {
      if (latest.current !== mine) return;
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (walked === null) {
        setRead((before) => (before.kind === "ok" && shown.current === dayKey ? before : { kind: "failed" }));
        return;
      }
      shown.current = dayKey;
      setRead({ kind: "ok", rows: walked.meals.map(serverRow), cut: walked.cut });
      settle(upTo);
    });
  }, [session, me, day, settle]);

  useEffect(() => {
    again();
  }, [again, sent, zone]);

  useEffect(() => {
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") again();
    });
    return () => {
      heard.remove();
    };
  }, [again]);

  useFocusEffect(again);
  return { read, again };
}

export function FoodScreen() {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const { outbox, view } = useMealOutbox();
  const settle = useCallback((upTo: number) => outbox?.settle(upTo), [outbox]);
  const { read, again } = useDayMeals(day, view.sent, settle);
  const targets = useRead(TARGETS_READ, nutritionTargetsResponseSchema);
  // The rings as the server answered a save of the daily numbers, until a read begun after the save
  // comes back: from then the reads are drawn, whatever they say (32b-ii-b's review, H2).
  const [justSaved, setJustSaved] = useState<NutritionTargetsResponse | null>(null);
  const savedAfter = useRef(0);
  const [numbers, setNumbers] = useState(false);
  // What a save of the numbers did, said on the card while the numbers drawn are still the ones saved.
  const [numbersSaid, setNumbersSaid] = useState<{ words: string; source: NutritionTargetsResponse["source"] } | null>(null);
  const readTargets = targets.read;
  useEffect(() => {
    if (justSaved !== null && targets.shownFrom > savedAfter.current) setJustSaved(null);
  }, [targets.shownFrom, justSaved]);
  const shownTargets: typeof readTargets = justSaved === null ? readTargets : { kind: "ok", data: justSaved };
  const [adding, setAdding] = useState<MealType | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [said, setSaid] = useState<{ section: MealType; words: string } | null>(null);
  const [setupAt, setSetupAt] = useState<SetupScreenId | "where" | null>(null);
  const [picking, setPicking] = useState(false);
  // A meal from a photo (33b-i): the camera, and the photo meal kept until it is saved.
  const kept = useKeptSheet();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const photoKept = kept.sheet !== null && kept.sheet !== undefined;
  const today = sameDay(day, new Date());

  // The server's meals, less those removed here, each as the server last answered it where that came
  // after this read began; the ones just sent that this read began before; the ones still waiting on
  // the phone; and every change still waiting laid over them.
  const landed = new Map(view.landed.map((m) => [m.id, m]));
  const rows: Row[] | null =
    read.kind === "ok"
      ? [
          ...read.rows.filter((r) => !view.removing.has(r.id)).map((r) => {
            const newer = landed.get(r.id);
            return newer === undefined ? r : serverRow(newer);
          }),
          // The newest answer for each meal: a meal saved and then changed has landed twice.
          ...[...landed.values()].filter((m) => !read.rows.some((r) => r.id === m.id)).map(serverRow),
          ...view.waiting.filter((m) => !read.rows.some((r) => r.id === m.id) && !landed.has(m.id)).map(waitingRow),
        ]
          .map((r) => withChanges(r, view.changing.get(r.id)))
          .filter((r) => inDay(r.takenAt, day))
          .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
      : null;
  // The meal open in its box, as the day now reads it: a change saved there shows at once.
  const openRow = open === null ? null : (rows?.find((r) => r.id === open.id) ?? open);

  const goTo = (next: Date) => {
    setSaid(null);
    setDay(startOfDay(next));
  };
  // A meal logged now lands today: the day goes there, and says so in the meal it went to.
  const loggedNow = (type: MealType, name: string) => {
    goTo(new Date());
    setSaid({ section: type, words: `${name} added.` });
  };

  return (
    <Page
      top={
        <PictureTop
          picture="food"
          tall={0.62}
          eyebrow="Nutrition"
          title="Fuel Your Training"
          foot={<Button label={photoKept ? "Finish photo meal" : "Log meal from photo"} icon="camera" onPress={() => { setSaid(null); setPhotoOpen(true); }} />}
        />
      }
    >
      {photoKept ? (
        // Finish is the picture's own button above; this says why, and offers the other way out.
        <Card style={[styles.row, styles.kept]}>
          <Icon name="camera" size={18} colour="orange" />
          <Txt kind="small" colour="text" style={styles.grow}>
            Your photo meal isn’t saved yet.
          </Txt>
          <Button label="Discard" kind="quiet" onPress={() => { setDiscarding(true); }} />
        </Card>
      ) : null}
      {view.refused.map((r) => (
        <Card key={r.id} style={styles.refused}>
          <Icon name="warn" size={18} colour="badText" />
          <Txt kind="small" style={styles.grow}>
            {r.name} wasn’t saved. {r.message}
          </Txt>
          <Button label="OK" kind="link" onPress={() => { outbox?.forget(r.id); }} />
        </Card>
      ))}
      <Macros
        title={today ? "Today’s Macros" : `Macros · ${dayWords(day, new Date())}`}
        today={today}
        targets={shownTargets}
        retry={targets.again}
        said={numbersSaid !== null && shownTargets.kind === "ok" && shownTargets.data.source === numbersSaid.source ? numbersSaid.words : null}
        onChange={() => {
          setNumbersSaid(null);
          setNumbers(true);
        }}
        eaten={rows === null || rows.some((r) => r.totals === null) ? null : daySums(rows)}
        uncounted={rows === null ? 0 : rows.filter((r) => r.totals === null).length}
        about={rows !== null && rows.some((r) => hasEstimate(r.items))}
        onSetup={setSetupAt}
      />
      <View style={styles.dayRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          onPress={() => { goTo(addDays(day, -1)); }}
          style={styles.arrow}
        >
          <Icon name="back" size={18} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${dayWords(day, new Date())}, pick a day`}
          onPress={() => { setPicking(true); }}
          style={({ pressed }) => [styles.dayWords, pressed ? styles.pressed : null]}
        >
          <Icon name="calendar" size={16} colour="orange" />
          <Txt kind="h3">{dayWords(day, new Date())}</Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={today ? "This is today" : "Next day"}
          accessibilityState={{ disabled: today }}
          disabled={today}
          onPress={() => { goTo(addDays(day, 1)); }}
          style={[styles.arrow, today ? styles.dim : null]}
        >
          <Icon name="go" size={18} />
        </Pressable>
      </View>
      {rows === null ? (
        read.kind === "failed" ? (
          <Card style={styles.row}>
            <Icon name="wifioff" size={18} colour="textSoft" />
            <Txt kind="small" style={styles.grow}>
              Your meals couldn’t load.
            </Txt>
            <Button label="Try again" kind="link" onPress={again} />
          </Card>
        ) : (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        )
      ) : (
        <>
          {MEAL_TYPES.map(({ type }) => (
            <Section
              key={type}
              type={type}
              rows={rows.filter((r) => r.section === type)}
              canAdd={today}
              said={said?.section === type ? said.words : null}
              onAdd={() => {
                setSaid(null);
                setAdding(type);
              }}
              onOpen={(row) => {
                setSaid(null);
                setOpen(row);
              }}
            />
          ))}
          {read.kind === "ok" && read.cut ? <Txt kind="small">Meals this far back couldn’t all be read.</Txt> : null}
          <Credits sources={new Set(rows.flatMap((r) => (r.items ?? []).map((i) => i.nutritionSource)))} />
        </>
      )}
      <MealPhoto
        open={photoOpen}
        kept={kept}
        onClose={() => { setPhotoOpen(false); }}
        onSaved={(type, name) => {
          setPhotoOpen(false);
          loggedNow(type, name);
        }}
        onSearch={() => {
          setPhotoOpen(false);
          goTo(new Date());
          setAdding(sectionOf({ mealType: null, takenAt: new Date().toISOString() }));
        }}
      />
      <Sheet open={discarding} title="Discard your photo meal?" onClose={() => { setDiscarding(false); }}>
        <Txt kind="small">Its foods aren’t saved, and the scan it used isn’t given back.</Txt>
        <Button
          label="Discard"
          kind="danger"
          wide
          onPress={() => {
            setDiscarding(false);
            kept.forget();
          }}
        />
        <Button label="Keep it" kind="quiet" wide onPress={() => { setDiscarding(false); }} />
      </Sheet>
      <AddFood
        type={adding}
        onClose={() => { setAdding(null); }}
        onAdded={(type, name) => {
          setAdding(null);
          setSaid({ section: type, words: `${name} added.` });
        }}
      />
      <MealSheet
        unsaved={view.unsaved}
        row={openRow}
        onClose={() => { setOpen(null); }}
        onRemove={(row) => {
          setOpen(null);
          void outbox?.remove(row.id);
          setSaid({ section: row.section, words: `${row.name} removed.` });
        }}
        onChanged={(section, words) => {
          setOpen(null);
          setSaid({ section, words });
        }}
      />
      <MonthPick
        open={picking}
        day={day}
        onClose={() => { setPicking(false); }}
        onPick={(picked) => {
          setPicking(false);
          goTo(picked);
        }}
      />
      {shownTargets.kind === "ok" ? (
        <OwnNumbers
          open={numbers}
          targets={shownTargets.data}
          onClose={() => { setNumbers(false); }}
          onSaved={(answer) => {
            setNumbers(false);
            savedAfter.current = targets.begun();
            setJustSaved(answer);
            setNumbersSaid({ words: answer.source === "own" ? "Now using your own numbers." : "Now using the app’s plan.", source: answer.source });
            targets.again();
          }}
        />
      ) : null}
      <Setup
        open={setupAt !== null}
        at={setupAt === "where" ? null : setupAt}
        onClose={() => {
          setSetupAt(null);
          setJustSaved(null);
          targets.again();
        }}
      />
    </Page>
  );
}

const MACROS = [
  { key: "kcal", name: "Calories", unit: "kcal", colour: "orange" },
  { key: "proteinG", name: "Protein", unit: "g", colour: "blue" },
  { key: "carbsG", name: "Carbs", unit: "g", colour: "gold" },
  { key: "fatG", name: "Fat", unit: "g", colour: "purple" },
] as const;

interface MacrosProps {
  title: string;
  today: boolean;
  targets: ReturnType<typeof useRead<NutritionTargetsResponse>>["read"];
  retry: () => void;
  /** Null when a meal on the day has no numbers yet (`uncounted`). */
  eaten: Sums | null;
  /** Meals logged with no signal before the server priced them: their numbers come once sent. */
  uncounted: number;
  /** A food on the day holds the scan's estimate: what is left is "about". */
  about: boolean;
  onSetup: (at: SetupScreenId | "where") => void;
  /** What a save of the daily numbers did, said on the card. */
  said: string | null;
  /** Opens the daily numbers: the app's plan or the person's own. */
  onChange: () => void;
}

/** The day's four rings against the person's daily numbers, what is left of them today, and why the
 *  calories hold no cut where the plan holds none. With no daily numbers it says which answer is
 *  missing and opens setup on it. */
function Macros({ title, today, targets, retry, eaten, uncounted, about, onSetup, said, onChange }: MacrosProps) {
  const left = (target: number, had: number, unit: "kcal" | "g") => `${about ? "about " : ""}${leftWords(target, had, unit)}`;
  const heading = (
    <View style={styles.titleRow}>
      <Icon name="target" size={16} colour="orange" />
      <Txt kind="h3">{title}</Txt>
    </View>
  );
  if (targets.kind !== "ok") {
    return (
      <Card style={styles.macros}>
        {heading}
        {targets.kind === "failed" ? (
          <View style={styles.row}>
            <Txt kind="small" style={styles.grow}>
              Your daily numbers couldn’t load. Your meals are kept.
            </Txt>
            <Button label="Try again" kind="link" onPress={retry} />
          </View>
        ) : (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        )}
      </Card>
    );
  }
  const t = targets.data;
  if (t.targets === null) {
    const words = t.targetWrongSide
      ? "Time to set a new target weight. Pick one to see your daily calories and macros."
      : t.missing.length > 0
        ? `To see your daily calories and macros, answer ${missingText(t.missing)}.`
        : "Finish setting up to see your daily calories and macros.";
    return (
      <Card style={styles.macros}>
        {heading}
        <Txt kind="small">{words}</Txt>
        <Button
          label={t.targetWrongSide ? "Pick a new target" : "Answer now"}
          kind="soft"
          small
          onPress={() => { onSetup(t.targetWrongSide ? "target" : "where"); }}
          style={styles.start}
        />
      </Card>
    );
  }
  const goal = t.targets;
  const noCut = noCutWords(t);
  const hold = holdWords(t.ownHeld);
  return (
    <Card style={styles.macros}>
      <View style={styles.row}>
        <View style={[styles.titleRow, styles.grow]}>
          <Icon name="target" size={16} colour="orange" />
          <Txt kind="h3">{title}</Txt>
        </View>
        <Button label="Change" kind="link" say="Change your daily numbers" onPress={onChange} />
      </View>
      <View style={styles.rings}>
        {MACROS.map((m) => {
          const of = goal[m.key];
          const had = eaten === null ? null : eaten[m.key];
          return (
            <View key={m.key} style={styles.mac} accessible accessibilityLabel={`${m.name}, ${had === null ? "not known" : count(had)} of ${count(of)} ${m.unit}`}>
              <View style={styles.ringBox}>
                <Ring share={had === null || of <= 0 ? 0 : had / of} colour={m.colour} />
                <View style={styles.ringWords}>
                  <Txt kind="strong" numberOfLines={1} fit>
                    {had === null ? NOT_KNOWN : count(had)}
                  </Txt>
                </View>
              </View>
              <Txt kind="tiny" colour="textSoft" style={styles.centre}>
                {m.name}
              </Txt>
              <Txt kind="tiny" style={styles.centre}>
                of {count(of)} {m.unit}
              </Txt>
            </View>
          );
        })}
      </View>
      {today && eaten !== null ? (
        <View style={styles.left}>
          <Txt kind="tiny" style={styles.label}>
            Remaining today
          </Txt>
          <Txt kind="small" colour="text">
            {left(goal.kcal, eaten.kcal, "kcal")} · Protein {left(goal.proteinG, eaten.proteinG, "g")} · Carbs{" "}
            {left(goal.carbsG, eaten.carbsG, "g")} · Fat {left(goal.fatG, eaten.fatG, "g")}
          </Txt>
        </View>
      ) : null}
      {uncounted > 0 ? (
        <Txt kind="small">
          {uncountedWords(uncounted)}
        </Txt>
      ) : null}
      {t.source === "own" && said === null ? <Txt kind="tiny">These are your own daily numbers.</Txt> : null}
      {hold === null ? null : (
        <Txt kind="small" colour="gold">
          {hold}
        </Txt>
      )}
      {said === null ? null : (
        <View style={styles.row}>
          <Icon name="check" size={14} colour="goodText" />
          <Txt kind="small" colour="goodText" style={styles.grow}>
            {said}
          </Txt>
        </View>
      )}
      {noCut === null ? null : (
        <View style={styles.row}>
          <Icon name="shield" size={14} colour="gold" />
          <Txt kind="small" colour="gold" style={styles.grow}>
            {noCut}
          </Txt>
        </View>
      )}
    </Card>
  );
}

interface SectionProps {
  type: MealType;
  rows: Row[];
  canAdd: boolean;
  said: string | null;
  onAdd: () => void;
  onOpen: (row: Row) => void;
}

function Section({ type, rows, canAdd, said, onAdd, onOpen }: SectionProps) {
  const name = mealTypeName(type);
  const sums = daySums(rows);
  const unknown = rows.some((r) => r.totals === null);
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.grow}>
          <Txt kind="h3">{name}</Txt>
          <Txt kind="tiny">
            {rows.length === 1 ? "1 meal" : `${count(rows.length)} meals`} · {unknown ? NOT_KNOWN : aboutKcal(sums.kcal, rows.some((r) => hasEstimate(r.items)))}
          </Txt>
        </View>
        {canAdd ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${name}`} onPress={onAdd} style={styles.add}>
            <Icon name="plus" size={18} colour="orange" />
          </Pressable>
        ) : null}
      </View>
      {said === null ? null : (
        <View style={styles.said}>
          <Icon name="check" size={14} colour="goodText" />
          <Txt kind="small" colour="goodText">
            {said}
          </Txt>
        </View>
      )}
      {rows.length === 0 ? (
        <Txt kind="small" style={styles.empty}>
          No {name.toLowerCase()} logged yet.
        </Txt>
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.name}, ${row.totals === null ? "calories not known yet" : aboutKcal(row.totals.kcalPoint, hasEstimate(row.items))}${row.waiting ? ", waiting to send" : ""}`}
            onPress={() => { onOpen(row); }}
            style={({ pressed }) => [styles.meal, pressed ? styles.pressed : null]}
          >
            <View style={styles.grow}>
              <Txt kind="strong" numberOfLines={2}>
                {row.name}
              </Txt>
              <Txt kind="tiny">{row.waiting ? "Waiting to send" : amountLine(row.items)}</Txt>
            </View>
            <Txt kind="small" colour="text">
              {row.totals === null ? NOT_KNOWN : aboutKcal(row.totals.kcalPoint, hasEstimate(row.items))}
            </Txt>
          </Pressable>
        ))
      )}
    </Card>
  );
}

function amountLine(items: MealItem[] | null): string {
  if (items === null || items.length === 0) return "";
  const [only] = items;
  return items.length === 1 && only !== undefined ? loggedAmount(only) + itemMark(only) : `${count(items.length)} foods`;
}

type Mode = { kind: "foods" } | { kind: "remove" } | { kind: "details" } | { kind: "food"; at: number } | { kind: "removeFood"; at: number };

const HELD_WORDS = {
  not_sent: "You can change its foods once it’s sent.",
  change_waiting: "Your last change to its foods is waiting to send. You can change them again once it’s sent.",
} as const;

/** A meal's foods, each changed by its amount or removed; its name, meal and time; and Remove meal.
 *  Each removal asks first. A change is kept on the phone and sent as a meal is (food/outbox.ts). */
function MealSheet({
  row,
  unsaved,
  onClose,
  onRemove,
  onChanged,
}: {
  row: Row | null;
  unsaved: boolean;
  onClose: () => void;
  onRemove: (row: Row) => void;
  onChanged: (section: MealType, words: string) => void;
}) {
  const { session } = useSession();
  const { outbox } = useMealOutbox();
  const [mode, setMode] = useState<Mode>({ kind: "foods" });
  const [measures, setMeasures] = useState<FoodMeasure[][] | null>(null);
  const [full, setFull] = useState(false);
  const rowId = row?.id ?? null;
  const savedVersion = row?.saved?.itemsVersion ?? null;
  useEffect(() => {
    setMode({ kind: "foods" });
    setFull(false);
  }, [rowId]);
  // The phone's back button: from a food, its removal, the meal's details or its removal, back a step.
  const back = (): boolean => {
    if (mode.kind === "foods") return false;
    setMode(mode.kind === "removeFood" ? { kind: "food", at: mode.at } : { kind: "foods" });
    return true;
  };
  // Each food's own measures, for the server's meal as it is now.
  useEffect(() => {
    setMeasures(null);
    if (rowId === null || savedVersion === null) return undefined;
    let stale = false;
    void session.signedIn({ method: "GET", path: `/v1/nutrition/meals/${rowId}/measures` }, mealMeasuresResponseSchema).then((answer) => {
      if (!stale && answer.kind === "ok") setMeasures(answer.data.measures);
    });
    return () => {
      stale = true;
    };
  }, [rowId, savedVersion, session]);
  if (row === null) return null;

  const keep = async (change: Omit<WaitingChange, "id" | "name" | "tried">, section: MealType, words: string) => {
    if (outbox === null) return;
    const kept = await outbox.change({ id: row.id, name: row.name, tried: false, ...change });
    if (kept) onChanged(section, words);
    else setFull(true);
  };
  const fullWords = full ? (
    <Txt kind="small" colour="badText">
      Too many changes are waiting to be sent. Go online to send them, then make this one.
    </Txt>
  ) : null;

  if (mode.kind === "remove") {
    return (
      <Sheet open title="Remove this meal?" onClose={onClose} onBack={back}>
        <Txt kind="small">
          {row.name} comes off {mealTypeName(row.section).toLowerCase()} and out of the day’s totals.
        </Txt>
        <Button label="Remove meal" kind="danger" wide onPress={() => { onRemove(row); }} />
        <Button label="Keep it" kind="quiet" wide onPress={() => { setMode({ kind: "foods" }); }} />
      </Sheet>
    );
  }

  if (mode.kind === "details") {
    return (
      <Sheet open title="Edit meal" onClose={onClose} onBack={back}>
        <MealDetails
          row={row}
          onSave={(fields) => {
            void keep(
              { body: { ...fields, changeId: newGoalId() }, items: null, totals: null, foods: null },
              fields.mealType ?? row.section,
              `${fields.mealName ?? row.name} updated.`,
            );
          }}
          onCancel={() => { setMode({ kind: "foods" }); }}
        />
        {fullWords}
      </Sheet>
    );
  }

  const saved = row.saved;
  const item = (mode.kind === "food" || mode.kind === "removeFood") && saved !== null ? saved.items[mode.at] : undefined;
  if (saved !== null && item !== undefined && mode.kind === "removeFood") {
    const at = mode.at;
    return (
      <Sheet open title={`Remove ${item.name}?`} onClose={onClose} onBack={back}>
        <Txt kind="small">
          {item.name} comes off {row.name} and out of the day’s totals.
        </Txt>
        <Button
          label="Remove food"
          kind="danger"
          wide
          onPress={() => {
            void keep(
              {
                body: { items: without(saved.items, at), itemsVersion: saved.itemsVersion, changeId: newGoalId() },
                items: saved.items.filter((_, i) => i !== at),
                totals: totalsWithout(saved.items, at),
                foods: null,
              },
              row.section,
              `${item.name} removed from ${row.name}.`,
            );
          }}
        />
        <Button label="Keep it" kind="quiet" wide onPress={() => { setMode({ kind: "food", at }); }} />
        {fullWords}
      </Sheet>
    );
  }
  if (saved !== null && item !== undefined && mode.kind === "food") {
    const at = mode.at;
    return (
      <Sheet open title={item.name} onClose={onClose} onBack={back}>
        <FoodAmount
          key={`${row.id}-${String(at)}-${measures === null ? "own" : "server"}`}
          mealId={row.id}
          saved={saved}
          at={at}
          measures={measures?.[at] ?? measuresWithoutServer(item)}
          onSave={(edit) => {
            void keep(
              {
                body: { items: edit.items, itemsVersion: saved.itemsVersion, changeId: newGoalId() },
                items: edit.preview?.items ?? null,
                totals: edit.preview?.totals ?? null,
                foods: edit.foods,
              },
              row.section,
              `${item.name} updated.`,
            );
          }}
          onRemove={saved.items.length > 1 ? () => { setMode({ kind: "removeFood", at }); } : null}
        />
        {fullWords}
      </Sheet>
    );
  }

  const held = foodsHeld(row);
  const lines = foodLines(row);
  return (
    <Sheet open title={row.name} onClose={onClose}>
      {row.waiting ? (
        <Txt kind="small">{unsaved ? "Waiting to send. It couldn’t be saved on this phone yet, so keep the app open." : "Saved on this phone. It’s sent when you’re online."}</Txt>
      ) : null}
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          {mealTypeName(row.section)} · {clockWords(row.takenAt)}
        </Txt>
        <Button label="Edit" kind="link" onPress={() => { setMode({ kind: "details" }); }} />
      </View>
      {lines.map((line, i) => {
        const inner = (
          <>
            <View style={styles.grow}>
              <Txt kind="strong">{line.name}</Txt>
              <Txt kind="tiny">{line.amount}</Txt>
            </View>
            <Txt kind="small" colour="text">
              {line.kcal === null ? NOT_KNOWN : kcalWords(line.kcal)}
            </Txt>
          </>
        );
        return held === null ? (
          <Pressable
            key={`${line.name}-${String(i)}`}
            accessibilityRole="button"
            accessibilityLabel={`Change ${line.name}, ${line.amount}`}
            onPress={() => { setMode({ kind: "food", at: i }); }}
            style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
          >
            {inner}
            <Icon name="go" size={16} colour="textSoft" />
          </Pressable>
        ) : (
          <View key={`${line.name}-${String(i)}`} style={styles.item}>
            {inner}
          </View>
        );
      })}
      {held === null ? null : <Txt kind="small">{HELD_WORDS[held]}</Txt>}
      {row.totals === null ? null : (
        <Txt kind="small">
          {aboutKcal(row.totals.kcalPoint, hasEstimate(row.items))} · Protein {count(Math.round(row.totals.proteinG))} g · Carbs {count(Math.round(row.totals.carbsG))} g · Fat{" "}
          {count(Math.round(row.totals.fatG))} g
        </Txt>
      )}
      <Button label="Remove meal" icon="trash" kind="danger" wide onPress={() => { setMode({ kind: "remove" }); }} />
    </Sheet>
  );
}

type DetailFields = { mealName?: string; mealType?: MealType; takenAt?: string };

/** A meal's name, which of the day's four meals it is, and its time, saved together. Only what was
 *  changed is sent. */
function MealDetails({ row, onSave, onCancel }: { row: Row; onSave: (fields: DetailFields) => void; onCancel: () => void }) {
  const [name, setName] = useState(row.name);
  const [type, setType] = useState<MealType>(row.section);
  const [time, setTime] = useState(row.takenAt);
  const trimmed = name.trim();
  const save = () => {
    const fields: DetailFields = {};
    if (trimmed !== row.name) fields.mealName = trimmed;
    if (type !== row.section || row.mealType === null) fields.mealType = type;
    if (time !== row.takenAt) fields.takenAt = time;
    if (Object.keys(fields).length === 0) onCancel();
    else onSave(fields);
  };
  return (
    <>
      <Field label="Name" value={name} onChange={setName} maxLength={200} />
      <Txt kind="tiny" style={styles.label}>
        Meal
      </Txt>
      <View style={styles.chips}>
        {MEAL_TYPES.map((m) => (
          <Chip key={m.type} label={m.name} on={type === m.type} onPress={() => { setType(m.type); }} />
        ))}
      </View>
      <Txt kind="tiny" style={styles.label}>
        Time
      </Txt>
      <View style={styles.amountRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Earlier" onPress={() => { setTime(steppedTime(time, -1)); }} style={styles.step}>
          <Icon name="minus" size={18} />
        </Pressable>
        <Txt kind="strong" style={styles.clock}>
          {clockWords(time)}
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="Later" onPress={() => { setTime(steppedTime(time, 1)); }} style={styles.step}>
          <Icon name="plus" size={18} />
        </Pressable>
      </View>
      {trimmed === "" ? (
        <Txt kind="small" colour="badText">
          Enter a name for this meal.
        </Txt>
      ) : null}
      <Button label="Save" wide disabled={trimmed === ""} onPress={save} />
    </>
  );
}

interface FoodEdit {
  items: MealEditItem[];
  preview: MealPreview | null;
  foods: { name: string; amount: string }[];
}

/** A logged food's new amount, by one of its own measures, with the server's numbers for it; Save, and
 *  Remove from meal where the meal holds other foods. */
function FoodAmount({
  mealId,
  saved,
  at,
  measures,
  onSave,
  onRemove,
}: {
  mealId: string;
  saved: { items: MealItem[]; itemsVersion: string };
  at: number;
  measures: FoodMeasure[];
  onSave: (edit: FoodEdit) => void;
  onRemove: (() => void) | null;
}) {
  const { session } = useSession();
  const item = saved.items[at];
  // The amount it was logged by, where that is one of its measures, else its grams.
  const logged = item === undefined ? null : amountOf(item);
  const usual: Amount =
    logged !== null && measures.some((m) => m.id === logged.measure) ? logged : { measure: "g", amount: String(Math.max(1, Math.round(item?.gramsPoint ?? 1))) };
  const [amount, setAmount] = useState<Amount | null>(() => (item === undefined ? null : usual));
  const [priced, setPriced] = useState<Priced>({ kind: "none" });
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState(false);
  const { dishes, again: dishesAgain } = useDishes();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Logged by a dish the person still has: it opens at that dish, as full as it was, once the dishes
  // are read (Kd, 32b-ii-b: a food logged by a dish opened at grams).
  const dishOpened = useRef(false);
  useEffect(() => {
    const m = item?.measure;
    if (dishOpened.current || m?.id !== "dish" || dishes.kind !== "ok") return;
    dishOpened.current = true;
    const dish = dishByName(dishes, m.name);
    const fill = FILL_CHOICES.find((c) => c.value === m.amount);
    if (dish !== null && fill !== undefined) setAmount({ measure: dishMeasure(dish.id), amount: String(fill.value) });
  }, [dishes, item]);
  const measure = amount === null ? undefined : measures.find((m) => m.id === amount.measure);
  const chosen = item === undefined || amount === null ? null : chosenItem(item.canonical, amount);
  const tooSmall = amount !== null && underAGram(measure, amount);
  const items =
    chosen === null || "grams" in chosen
      ? null
      : withAmount(saved.items, at, chosen.canonical, "measure" in chosen ? { measure: chosen.measure, amount: chosen.amount } : { dishwareId: chosen.dishwareId, fillLevel: chosen.fillLevel });
  const key = items === null ? "" : JSON.stringify(items);

  // The server's numbers for the meal at the new amount, a moment after it changes.
  useEffect(() => {
    if (items === null || tooSmall) {
      setPriced({ kind: "none" });
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(() => {
      void session
        .signedIn({ method: "POST", path: `/v1/nutrition/meals/${mealId}/preview`, body: { items, itemsVersion: saved.itemsVersion } }, mealPreviewSchema)
        .then((answer) => {
          if (stale) return;
          if (answer.kind === "ok") setPriced({ kind: "ok", preview: answer.data, for: key });
          else if (answer.kind === "refused" && answer.error === "meal_changed") setPriced({ kind: "refused", words: MEAL_CHANGED_WORDS, for: key });
          else if (answer.kind === "refused" && amountRefusal(answer.error) !== null) setPriced({ kind: "refused", words: amountRefusal(answer.error) ?? "", for: key });
          else setPriced({ kind: "none" });
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `key` is the whole of `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tooSmall, session, mealId, saved.itemsVersion]);

  if (item === undefined || amount === null) return null;
  const preview = priced.kind === "ok" && priced.for === key ? priced.preview : null;
  const refusedWords = priced.kind === "refused" && priced.for === key ? priced.words : null;
  const now = preview?.items[at];
  const held = items === null || tooSmall || refusedWords !== null || saving;

  const save = () => {
    if (items === null || held) return;
    setSaving(true);
    const typed = Number(amount.amount.trim().replace(",", "."));
    onSave({
      items,
      preview,
      foods: saved.items.map((it, i) => ({
        name: it.name,
        amount: i !== at ? loggedAmount(it) + itemMark(it) : now === undefined ? typedAmount(measure, typed, pickedDish(dishes, amount.measure)) : loggedAmount(now) + itemMark(now),
      })),
    });
  };

  return (
    <>
      <ScrollView style={{ maxHeight: Math.max(SHEET_LIST_LEAST, height - insets.top - SHEET_ABOVE_LIST - (panel ? 0 : SHEET_FOOT + (onRemove === null ? 0 : 60))) }} contentContainerStyle={styles.sheetList}>
      <Txt kind="tiny">
        Logged: {loggedAmount(item) + itemMark(item)} · {kcalWords(item.kcalPoint)}
      </Txt>
      <AmountPicker
        measures={measures}
        amount={amount}
        onAmount={setAmount}
        dishes={dishes}
        onDishes={dishesAgain}
        onPanel={setPanel}
        grams={now === undefined || preview === null ? null : now.gramsPoint}
        usual={usual}
      />
      {panel ? null : (
        <>
          {tooSmall ? (
            <Txt kind="small" colour="badText">
              That comes to less than a gram. Pick a larger amount.
            </Txt>
          ) : null}
          {refusedWords === null ? null : (
            <Txt kind="small" colour="badText">
              {refusedWords}
            </Txt>
          )}
        </>
      )}
      </ScrollView>
      {/* The food's numbers and Save stay in view under the list, on the smallest phone too. */}
      {panel ? null : (
        <View style={styles.foot}>
          {now === undefined || preview === null ? null : (
            <Txt kind="small" colour="text">
              {kcalWords(now.kcalPoint)} · Meal total {kcalWords(preview.totals.kcalPoint)}
            </Txt>
          )}
          <Button label="Save" wide disabled={held} onPress={save} />
          {onRemove === null ? null : <Button label="Remove from meal" icon="trash" kind="quiet" wide onPress={onRemove} />}
        </View>
      )}
    </>
  );
}

/** What sits above the box's list, and the box's own foot: its handle and title, the search box. */
const SHEET_ABOVE_LIST = 150;
const SHEET_ABOVE_SEARCH = SHEET_ABOVE_LIST + 70;
/** The box's foot under a picked food's list: its numbers and Add. */
const SHEET_FOOT = 130;
/** The list never shrinks below one food's row. */
const SHEET_LIST_LEAST = 120;


type Found = { kind: "idle" } | { kind: "looking" } | { kind: "ok"; items: FoodSearchItem[] } | { kind: "failed"; words: string };
/** A food in the picker: one found by the search, or one the person logged before, with the food as
 *  it was last logged, whose numbers stand in at that same amount until the server's come back. */
type Picked = Pick<FoodSearchItem, "canonical" | "name" | "source" | "measures" | "startsAt"> & { last?: RecentFood };
type Priced = { kind: "none" } | { kind: "ok"; preview: MealPreview; for: string } | { kind: "refused"; words: string; for: string };

/** Add to a meal: the foods logged before, or a search; a food's amount by one of its own measures,
 *  Add. The server prices the amount before it is added; Add keeps the meal on the phone and sends
 *  it. A food logged before opens at the amount last had, its name or its + alike (Kd, 2026-10-29). */
function AddFood({ type, onClose, onAdded }: { type: MealType | null; onClose: () => void; onAdded: (type: MealType, name: string) => void }) {
  const { session } = useSession();
  const { outbox } = useMealOutbox();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>({ kind: "idle" });
  const [food, setFood] = useState<Picked | null>(null);
  const [amount, setAmount] = useState<Amount | null>(null);
  const [priced, setPriced] = useState<Priced>({ kind: "none" });
  const [panel, setPanel] = useState(false);
  const { dishes, again: dishesAgain } = useDishes();
  const [full, setFull] = useState(false);
  const [recent, setRecent] = useState<RecentFood[]>([]);
  // Held from the first press until the meal is kept: a second tap never logs it twice.
  const [adding, setAdding] = useState(false);
  const addingNow = useRef(false);
  // The box fits between the top of the screen and the keyboard: its title and the search box stay in
  // view, and the list under them scrolls.
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboard(e.endCoordinates.height);
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboard(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (type === null) return;
    setQuery("");
    setFound({ kind: "idle" });
    setFood(null);
    setAmount(null);
    setPriced({ kind: "none" });
    setFull(false);
    setPanel(false);
    setAdding(false);
    addingNow.current = false;
  }, [type]);

  // The person's recent foods, read each time the box opens; with no answer the box offers the search.
  useEffect(() => {
    setRecent([]);
    if (type === null) return undefined;
    let stale = false;
    void session.signedIn({ method: "GET", path: "/v1/nutrition/foods/recent" }, recentFoodsResponseSchema).then((answer) => {
      if (!stale && answer.kind === "ok") setRecent(answer.data.items);
    });
    return () => {
      stale = true;
    };
  }, [type, session]);

  // The search, a moment after the last letter; only the newest answer is drawn.
  useEffect(() => {
    const q = query.trim();
    if (q === "" || food !== null) {
      setFound({ kind: "idle" });
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(() => {
      setFound({ kind: "looking" });
      void session
        .signedIn({ method: "GET", path: `/v1/nutrition/foods?q=${encodeURIComponent(q.slice(0, 100))}&limit=10` }, foodSearchResponseSchema)
        .then((answer) => {
          if (stale) return;
          if (answer.kind === "ok") setFound({ kind: "ok", items: answer.data.items });
          else setFound({ kind: "failed", words: answer.kind === "refused" ? answer.message : NO_CONNECTION });
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, food, session]);

  const measure = food === null || amount === null ? undefined : food.measures.find((m) => m.id === amount.measure);
  const item: ChosenItem | null = food === null || amount === null ? null : chosenItem(food.canonical, amount);
  const tooSmall = amount !== null && underAGram(measure, amount);
  const key = item === null ? "" : JSON.stringify(item);

  // The server's numbers for the amount picked, a moment after it changes.
  useEffect(() => {
    if (item === null || tooSmall) {
      setPriced({ kind: "none" });
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(() => {
      void session.signedIn({ method: "POST", path: "/v1/nutrition/meals/preview", body: { items: [item] } }, mealPreviewSchema).then((answer) => {
        if (stale) return;
        if (answer.kind === "ok") setPriced({ kind: "ok", preview: answer.data, for: key });
        else if (answer.kind === "refused" && amountRefusal(answer.error) !== null) {
          setPriced({ kind: "refused", words: amountRefusal(answer.error) ?? "", for: key });
        } else setPriced({ kind: "none" });
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `key` is the whole of `item`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tooSmall, session]);

  if (type === null) return null;
  const name = mealTypeName(type);
  const preview = priced.kind === "ok" && priced.for === key ? priced.preview : null;
  const refusedWords = priced.kind === "refused" && priced.for === key ? priced.words : null;
  const held = item === null || tooSmall || refusedWords !== null || outbox === null || adding;

  const keep = async (name: string, chosen: ChosenItem, numbers: { items: MealItem[]; totals: MealPreview["totals"] } | null) => {
    if (outbox === null || addingNow.current) return;
    addingNow.current = true;
    setAdding(true);
    const id = newGoalId();
    const kept = await outbox.add({
      id,
      body: { id, mealName: name, takenAt: new Date().toISOString(), mealType: type, items: [chosen] },
      items: numbers?.items ?? null,
      totals: numbers?.totals ?? null,
      tried: false,
    });
    addingNow.current = false;
    setAdding(false);
    if (kept) onAdded(type, name);
    else setFull(true);
  };
  const add = async () => {
    if (food === null || item === null || held) return;
    // With no answer from the server yet, a food logged before at the amount last had keeps the
    // server's numbers from then until it has priced it again.
    const last = food.last;
    const same = last !== undefined && "measure" in item && item.measure === last.add.measure && item.amount === last.add.amount;
    await keep(food.name, item, preview ?? (same ? { items: [last.item], totals: totalsOf([last.item]) } : null));
  };
  const open = (f: RecentFood) => {
    setFood({ canonical: f.canonical, name: f.item.name, source: f.source, measures: f.measures, startsAt: f.add, last: f });
    // Last had by a saved dish the person still has: that dish, as full as it was then. A dish that is
    // gone starts it where the server says, a count of it where it has one.
    const m = f.item.measure;
    // Only once the dishes are read: before then it opens where the server starts it.
    const dish = m?.id === "dish" && dishes.kind === "ok" ? dishByName(dishes, m.name) : null;
    const fill = FILL_CHOICES.find((c) => c.value === m?.amount);
    setAmount(dish !== null && fill !== undefined ? { measure: dishMeasure(dish.id), amount: String(fill.value) } : startingAmount({ startsAt: f.add }));
  };
  const showRecent = food === null && query.trim() === "" && recent.length > 0;
  // The phone's back button: from a food's amount, back to the foods.
  const back = (): boolean => {
    if (food === null) return false;
    setFood(null);
    setAmount(null);
    setPanel(false);
    return true;
  };

  return (
    <Sheet open title={`Add to ${name}`} onClose={onClose} onBack={back}>
      {food === null ? <Field label="Search food" bare value={query} onChange={setQuery} placeholder="Search food" ready maxLength={100} /> : null}
      <ScrollView style={{ maxHeight: Math.max(SHEET_LIST_LEAST, height - keyboard - insets.top - (food === null ? SHEET_ABOVE_SEARCH : SHEET_ABOVE_LIST + (panel ? 0 : SHEET_FOOT))) }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetList}>
        {food === null ? (
          <>
            {showRecent ? (
              <>
                <Txt kind="tiny" style={styles.label}>
                  Previously logged
                </Txt>
                {recent.map((f) => (
                  <View key={f.canonical} style={[styles.found, styles.recent]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${f.item.name}, ${loggedAmount(f.item)}, ${kcalWords(f.item.kcalPoint)}`}
                      onPress={() => { open(f); }}
                      style={({ pressed }) => [styles.grow, pressed ? styles.pressed : null]}
                    >
                      <Txt kind="strong" numberOfLines={2}>
                        {f.item.name}
                      </Txt>
                      <Txt kind="tiny">
                        {loggedAmount(f.item)} · {kcalWords(f.item.kcalPoint)}
                      </Txt>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${f.item.name}`}
                      onPress={() => { open(f); }}
                      style={({ pressed }) => [styles.add, pressed ? styles.pressed : null]}
                    >
                      <Icon name="plus" size={18} colour="orange" />
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            {found.kind === "looking" ? <Txt kind="small">Searching…</Txt> : null}
            {found.kind === "failed" ? <Txt kind="small" colour="badText">{found.words}</Txt> : null}
            {found.kind === "ok" && found.items.length === 0 ? <Txt kind="small">No food found. Try another word.</Txt> : null}
            {found.kind === "ok"
              ? found.items.map((f) => (
                  <Pressable
                    key={f.canonical}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.name}, ${startWords(f)}, ${SOURCE_WORDS[f.source]}`}
                    onPress={() => {
                      setFood(f);
                      setAmount(startingAmount(f));
                    }}
                    style={({ pressed }) => [styles.found, pressed ? styles.pressed : null]}
                  >
                    <Txt kind="strong" numberOfLines={2}>
                      {f.name}
                    </Txt>
                    <SourceLine source={f.source} before={`${startWords(f)} ·`} />
                  </Pressable>
                ))
              : null}
          </>
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Txt kind="strong">{food.name}</Txt>
                <SourceLine source={food.source} />
              </View>
              <Button
                label="Change"
                kind="link"
                onPress={() => {
                  setFood(null);
                  setAmount(null);
                }}
              />
            </View>
            {amount === null ? null : (
              <AmountPicker
                key={food.canonical}
                measures={food.measures}
                amount={amount}
                onAmount={setAmount}
                dishes={dishes}
                onDishes={dishesAgain}
                onPanel={setPanel}
                grams={preview?.items[0]?.gramsPoint ?? null}
                usual={startingAmount(food)}
              />
            )}
            {panel ? null : (
              <>
                {tooSmall ? <Txt kind="small" colour="badText">That comes to less than a gram. Pick a larger amount.</Txt> : null}
                {refusedWords === null ? null : (
                  <Txt kind="small" colour="badText">
                    {refusedWords}
                  </Txt>
                )}
              </>
            )}
          </>
        )}
        <Credits
          sources={
            new Set(food === null ? [...(found.kind === "ok" ? found.items.map((f) => f.source) : []), ...(showRecent ? recent.map((f) => f.source) : [])] : [food.source])
          }
        />
      </ScrollView>
      {/* The food's numbers and its Add stay in view under the list, on the smallest phone too. */}
      {food === null || panel ? null : (
        <View style={styles.foot}>
          {preview === null ? null : (
            <Txt kind="small" colour="text">
              {kcalWords(preview.totals.kcalPoint)} · Protein {count(Math.round(preview.totals.proteinG))} g · Carbs{" "}
              {count(Math.round(preview.totals.carbsG))} g · Fat {count(Math.round(preview.totals.fatG))} g
            </Txt>
          )}
          <Button
            label={preview === null ? `Add ${food.name}` : `Add ${food.name} · ${kcalWords(preview.totals.kcalPoint)}`}
            wide
            disabled={held}
            onPress={() => {
              void add();
            }}
          />
          {full ? (
            <Txt kind="small" colour="badText">
              Too many meals are waiting to be sent. Go online to send them, then add this one.
            </Txt>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** A month to pick a day from, as standard apps draw it: today and the days before it, never after. */
function MonthPick({ open, day, onClose, onPick }: { open: boolean; day: Date; onClose: () => void; onPick: (day: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(day.getFullYear(), day.getMonth(), 1));
  useEffect(() => {
    if (open) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }, [open, day]);
  if (!open) return null;
  const today = startOfDay(new Date());
  const thisMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  return (
    <Sheet open title="Pick a day" onClose={onClose}>
      <View style={styles.monthHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); }}
          style={styles.arrow}
        >
          <Icon name="back" size={18} />
        </Pressable>
        <Txt kind="h3" style={styles.monthName}>
          {monthWords(month)}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: thisMonth }}
          disabled={thisMonth}
          onPress={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); }}
          style={[styles.arrow, thisMonth ? styles.dim : null]}
        >
          <Icon name="go" size={18} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAY_LETTERS.map((letter, i) => (
          <Txt key={`${letter}${String(i)}`} kind="tiny" style={styles.cell}>
            {letter}
          </Txt>
        ))}
      </View>
      {monthWeeks(month).map((week, w) => (
        <View key={String(w)} style={styles.week}>
          {week.map((d, i) => {
            if (d === null) return <View key={`gap${String(i)}`} style={styles.cell} />;
            const after = d.getTime() > today.getTime();
            const on = sameDay(d, day);
            return (
              <Pressable
                key={d.getDate()}
                accessibilityRole="button"
                accessibilityLabel={dayWords(d, new Date())}
                accessibilityState={{ disabled: after, selected: on }}
                disabled={after}
                onPress={() => { onPick(d); }}
                style={[styles.cell, styles.dayCell, on ? styles.dayOn : null, after ? styles.dim : null]}
              >
                <Txt kind="small" colour={on ? "onOrange" : sameDay(d, today) ? "orange" : "text"}>
                  {String(d.getDate())}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  monthHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  monthName: { flex: 1, textAlign: "center" },
  week: { flexDirection: "row" },
  cell: { flex: 1, textAlign: "center", alignItems: "center", justifyContent: "center" },
  dayCell: { minHeight: sizes.press, borderRadius: sizes.round },
  dayOn: { backgroundColor: colours.orange },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  centre: { textAlign: "center" },
  dim: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  refused: { flexDirection: "row", alignItems: "center", gap: 10, borderColor: colours.badLine },
  kept: { gap: 10, borderColor: colours.orangeLine },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  macros: { gap: 14 },
  rings: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  mac: { flex: 1, alignItems: "center", gap: 4 },
  ringBox: { alignItems: "center", justifyContent: "center" },
  ringWords: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  left: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  start: { alignSelf: "flex-start" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dayWords: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  arrow: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { gap: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  add: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    backgroundColor: colours.orangeFill,
    alignItems: "center",
    justifyContent: "center",
  },
  said: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingBottom: 10 },
  empty: { paddingHorizontal: 14, paddingBottom: 14 },
  meal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colours.line,
  },
  item: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  sheetList: { gap: 12, paddingBottom: 4 },
  foot: { gap: 10 },
  found: { minHeight: 56, justifyContent: "center", gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colours.line },
  recent: { flexDirection: "row", alignItems: "center", gap: 10 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  step: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.fieldLine,
    backgroundColor: colours.field,
    alignItems: "center",
    justifyContent: "center",
  },
  clock: { minWidth: 96, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

