import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { STANDARD_DISHES, standardDish, dishwarePageSchema, dishwareResponseSchema, type Dishware, type FoodMeasure } from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { FillDish } from "../../look/FillDish";
import { Icon } from "../../look/Icon";
import { useSheetBack } from "../../look/Sheet";
import { MOST_TEXT_GROWTH } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import type { Shape } from "../../session/calls";
import { useSession } from "../../session/SessionProvider";
import { count } from "../dashboard/words";
import { newGoalId } from "../goals/words";
import { DISH_SIZES, MOST_DISH_ML, MOST_DISH_NAME, dishWaiting, dishWords, newDish, type DishSize } from "./dishes";
import { useMealOutbox } from "./MealOutbox";
import { FILL_CHOICES, NO_MEASURE, amountFor, dishMeasure, dishOf, measureWords, shownMeasures, stepped, unitWords, type Amount } from "./measures";

// A food's amount (ROADMAP 32b-i, 32b-ii-b): by one of its own measures and how many, or by one of the
// person's saved dishes and how full it was, as the browser's measure picker offers them. Saving,
// renaming and removing a dish happen here too, and need a connection: a dish is a setting, not a
// meal, so nothing about it waits on the phone. A dish is sent with an id of its own, kept until the
// server answers, so a save sent twice is one dish.

const NO_CONNECTION = "No connection. Try again.";
/** DELETE answers 204 with no body. */
export const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

export type Dishes = { kind: "loading" } | { kind: "ok"; list: Dishware[] } | { kind: "failed" };

/** The person's saved dishes, read when the picker opens; `again` reads them once more. */
export function useDishes(): { dishes: Dishes; again: () => void } {
  const { session } = useSession();
  const [dishes, setDishes] = useState<Dishes>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let stale = false;
    void session.signedIn({ method: "GET", path: "/v1/nutrition/dishware?limit=100" }, dishwarePageSchema).then((answer) => {
      if (stale) return;
      if (answer.kind === "ok") setDishes({ kind: "ok", list: answer.data.items });
      else setDishes((before) => (before.kind === "ok" ? before : { kind: "failed" }));
    });
    return () => {
      stale = true;
    };
  }, [session, round]);
  const again = useCallback(() => {
    setRound((n) => n + 1);
  }, []);
  return { dishes, again };
}

/** A dish to weigh a food with: one everybody has, or one of the person's own. */
export type PickDish = Pick<Dishware, "id" | "label" | "containerClass" | "volumeMl">;

/** The dishes offered: a cup, a mug and a bowl everybody has, then the person's own (Kd, 32b-ii-b:
 *  "keep the things already built, just give an option to create one on own"). */
export const dishesOffered = (dishes: Dishes): PickDish[] => {
  const list = dishes.kind === "ok" ? dishes.list : [];
  // A cup, mug or bowl the person has changed comes back under its own id, in its place.
  return [...STANDARD_DISHES.map((s) => list.find((d) => d.id === s.id) ?? s), ...list.filter((d) => standardDish(d.id) === null)];
};

/** The dish a logged amount names, by its name: the person's own where exactly one of theirs has it,
 *  else the one everybody has of that name; none where two of theirs share it (review, L3). */
export function dishByName(dishes: Dishes, name: string): PickDish | null {
  const own = (dishes.kind === "ok" ? dishes.list : []).filter((d) => d.label === name);
  if (own.length > 0) return own.length === 1 ? (own[0] ?? null) : null;
  const everybody = STANDARD_DISHES.find((d) => d.label === name);
  return everybody === undefined ? null : (dishesOffered(dishes).find((d) => d.id === everybody.id) ?? everybody);
}

/** The dish a measure names, where it is still one of them. */
export function pickedDish(dishes: Dishes, measure: string): PickDish | null {
  const id = dishOf(measure);
  return id === null ? null : (dishesOffered(dishes).find((d) => d.id === id) ?? null);
}

type Panel = "pick" | "new" | "edit";

/** What an amount weighs, beside it: "= 180 g", or "= … g" while the server works it out. */
const gramsWords = (grams: number | null): string => (grams === null ? "= … g" : `= ${String(Math.round(grams))} g`);

export function AmountPicker({
  measures,
  amount,
  onAmount,
  dishes,
  onDishes,
  onPanel,
  grams,
  usual,
}: {
  measures: readonly FoodMeasure[];
  amount: Amount;
  onAmount: (amount: Amount) => void;
  dishes: Dishes;
  /** Read the dishes again, after one is saved, renamed or removed. */
  onDishes: () => void;
  /** A dish being saved or the dishes being changed fill the box: the food's own button waits. */
  onPanel: (open: boolean) => void;
  /** What the amount weighs, as the server worked it out; null while it has not answered. */
  grams: number | null;
  /** The food's usual amount, which a picked option tapped again goes back to (Kd, 32b-ii-b: "clicking
   *  it again does not unselect it"); the usual one tapped again leaves none picked. */
  usual: Amount;
}) {
  const [all, setAll] = useState(false);
  const [panel, setPanelState] = useState<Panel>("pick");
  const setPanel = (next: Panel) => {
    setPanelState(next);
    onPanel(next !== "pick");
  };
  // The phone's back button: from a new dish or your dishes, back to the amount.
  useSheetBack(2, () => {
    if (panel === "pick") return false;
    setPanel("pick");
    return true;
  });
  const measure = measures.find((m) => m.id === amount.measure);
  const dishId = dishOf(amount.measure);
  const dish = pickedDish(dishes, amount.measure);
  const shown = shownMeasures(measures, amount.measure, all);
  // Every dish offered may be changed; the person's own may also be removed.
  const list = dishesOffered(dishes);

  if (panel === "new") {
    return (
      <NewDish
        onCancel={() => { setPanel("pick"); }}
        onSaved={(saved) => {
          onDishes();
          onAmount({ measure: dishMeasure(saved.id), amount: "" });
          setPanel("pick");
        }}
      />
    );
  }
  if (panel === "edit") {
    return (
      <EditDishes
        list={list}
        onChanged={(removed) => {
          onDishes();
          if (removed !== null && removed === dishId) onAmount({ measure: "g", amount: "100" });
        }}
        onDone={() => { setPanel("pick"); }}
      />
    );
  }

  return (
    <>
      <Txt kind="tiny" style={styles.label}>
        Amount
      </Txt>
      {amount.measure === NO_MEASURE ? (
        <Txt kind="small" colour="textSoft">
          Pick an amount.
        </Txt>
      ) : dishId === null ? (
        <View style={styles.amountRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Less" onPress={() => { onAmount(stepped(amount, -1)); }} style={styles.step}>
            <Icon name="minus" size={18} />
          </Pressable>
          <TextInput
            accessibilityLabel="Amount"
            value={amount.amount}
            onChangeText={(text) => { onAmount({ measure: amount.measure, amount: text }); }}
            keyboardType="decimal-pad"
            maxLength={8}
            maxFontSizeMultiplier={MOST_TEXT_GROWTH}
            selectionColor={colours.orange}
            style={styles.amount}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => { onAmount(stepped(amount, 1)); }} style={styles.step}>
            <Icon name="plus" size={18} />
          </Pressable>
          <Txt kind="small" colour="text" style={styles.grow} numberOfLines={2}>
            {unitWords(measure)}
          </Txt>
          {/* A count is never a number alone: what it weighs is beside it (Kd, 32b-ii-b). */}
          {amount.measure === "g" ? null : <Txt kind="strong">{gramsWords(grams)}</Txt>}
        </View>
      ) : null}
      <View style={styles.chips}>
        {shown.map((m) => (
          <Chip
            key={m.id}
            label={measureWords(m)}
            on={amount.measure === m.id}
            onPress={() => {
              // Tapped again: un-picked, back to the food's usual amount, or to none where it was that.
              if (amount.measure !== m.id) onAmount(amountFor(m));
              else onAmount(m.id !== usual.measure ? usual : { measure: NO_MEASURE, amount: "" });
            }}
          />
        ))}
      </View>
      {shown.length < measures.length ? (
        <Button
          label={`More measures (${String(measures.length - shownMeasures(measures, amount.measure, false).length)})`}
          kind="link"
          style={styles.start}
          onPress={() => { setAll(true); }}
        />
      ) : null}
      <View style={styles.headRow}>
        <Txt kind="tiny" style={[styles.label, styles.grow]}>
          Dishes
        </Txt>
        {dishes.kind === "ok" ? <Button label="Edit" kind="link" onPress={() => { setPanel("edit"); }} say="Edit your dishes" /> : null}
      </View>
      <View style={styles.chips}>
        {dishesOffered(dishes)
          // The cup everybody has is the food's own cup where it has one: offered once.
          .filter((d) => d.id === dishId || !STANDARD_DISHES.some((s) => s.id === d.id && s.label === d.label && s.volumeMl === d.volumeMl && measures.some((m) => m.name.toLowerCase() === s.label.toLowerCase())))
          .map((d) => (
          <Chip
            key={d.id}
            label={dishWords(d)}
            on={dishId === d.id}
            onPress={() => {
              onAmount(dishId !== d.id ? { measure: dishMeasure(d.id), amount: "" } : usual);
            }}
          />
        ))}
        <Chip label="New dish" icon="plus" on={false} onPress={() => { setPanel("new"); }} />
      </View>
      {dishes.kind === "failed" ? (
        <View style={styles.headRow}>
          <Txt kind="small" style={styles.grow}>
            Your dishes couldn’t load.
          </Txt>
          <Button label="Try again" kind="link" onPress={onDishes} />
        </View>
      ) : null}
      {dishId === null ? null : (
        <>
          <Txt kind="tiny" style={styles.label}>
            How full?
          </Txt>
          <View style={styles.fills}>
            {FILL_CHOICES.map((f) => {
              const on = amount.amount === String(f.value);
              return (
                <Pressable
                  key={f.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${dish?.label ?? "Dish"}, ${f.words}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => { onAmount({ measure: amount.measure, amount: on ? "" : String(f.value) }); }}
                  style={({ pressed }) => [styles.fill, on ? styles.fillOn : null, pressed ? styles.pressed : null]}
                >
                  <FillDish containerClass={dish?.containerClass ?? "bowl"} fill={f.value} colour={on ? "orange" : "textSoft"} />
                  <Txt kind="tiny" colour={on ? "orange" : "textSoft"} style={styles.centre}>
                    {f.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          {FILL_CHOICES.some((f) => amount.amount === String(f.value)) ? <Txt kind="strong">{gramsWords(grams)}</Txt> : <Txt kind="small">Pick how full it was.</Txt>}
        </>
      )}
    </>
  );
}

/** A new dish: a name, and one of the sizes or a size in ml. */
export function NewDish({ onCancel, onSaved }: { onCancel: () => void; onSaved: (dish: Dishware) => void }) {
  const { session } = useSession();
  // Kept until the server answers, so a save sent again is the same dish.
  const [id] = useState(newGoalId);
  const [name, setName] = useState("");
  const [size, setSize] = useState<DishSize | null>(null);
  const [ml, setMl] = useState("");
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  // Save pressed with something missing: what is missing is said in red, not by a grey button
  // (Kd, 32b-ii-b: he typed a name, and Save dish stayed grey with no word why).
  const [asked, setAsked] = useState(false);
  // The sizes as this person has them: their Cup, where they changed it.
  const { dishes } = useDishes();
  const sizes = DISH_SIZES.map((s) => {
    const everybody = STANDARD_DISHES.find((d) => d.label === s.label);
    return { ...s, volumeMl: dishesOffered(dishes).find((d) => d.id === everybody?.id)?.volumeMl ?? s.volumeMl };
  });
  const made = newDish(name, size, ml);
  const body = made === null || size === "ml" ? made : { ...made, volumeMl: sizes.find((s) => s.label === size)?.volumeMl ?? made.volumeMl };
  const missing =
    size === null ? "Pick how big it is: Cup, Mug, Bowl or Another size." : body === null ? `Type its size in ml, from 1 to ${count(MOST_DISH_ML)}.` : null;

  const save = async () => {
    if (busy) return;
    if (body === null) {
      setAsked(true);
      return;
    }
    setBusy(true);
    setTrouble(null);
    const answer = await session.signedIn({ method: "POST", path: "/v1/nutrition/dishware", body: { ...body, id } }, dishwareResponseSchema);
    if (answer.kind !== "ok") {
      setBusy(false);
      setTrouble(answer.kind === "no_answer" || answer.status >= 500 ? NO_CONNECTION : "That dish couldn’t be saved. Check its size and try again.");
      return;
    }
    // A send whose answer was lost did save the dish; changed since and sent again under the same id,
    // the server answers with the dish as first saved. What was typed now is what is kept (review, L1).
    const kept = answer.data.dishware;
    if (kept.label === body.label && kept.volumeMl === body.volumeMl && kept.containerClass === body.containerClass) {
      setBusy(false);
      onSaved(kept);
      return;
    }
    const fixed = await session.signedIn({ method: "PATCH", path: `/v1/nutrition/dishware/${id}`, body }, dishwareResponseSchema);
    setBusy(false);
    if (fixed.kind === "ok") onSaved(fixed.data.dishware);
    else setTrouble(fixed.kind === "no_answer" || fixed.status >= 500 ? NO_CONNECTION : "That dish couldn’t be saved. Check its size and try again.");
  };

  return (
    <>
      <Txt kind="h3">New dish</Txt>
      <Field label="Name your dish" value={name} onChange={setName} maxLength={MOST_DISH_NAME} />
      <Txt kind="tiny" style={styles.label}>
        How big is it?
      </Txt>
      <View style={styles.chips}>
        {sizes.map((s) => (
          <Chip key={s.label} label={`${s.label} · ${String(s.volumeMl)} ml`} on={size === s.label} onPress={() => { setSize(s.label); }} />
        ))}
        <Chip label="Another size" on={size === "ml"} onPress={() => { setSize("ml"); }} />
      </View>
      {size === "ml" ? <Field label="Its size in ml" value={ml} onChange={setMl} keyboard="number-pad" maxLength={5} ready /> : null}
      {missing === null ? null : (
        <Txt kind="small" colour={asked ? "badText" : "textSoft"}>
          {missing}
        </Txt>
      )}
      {trouble === null ? null : (
        <Txt kind="small" colour="badText">
          {trouble}
        </Txt>
      )}
      <Button label="Save dish" wide busy={busy} onPress={() => { void save(); }} />
      <Button label="Cancel" kind="quiet" wide onPress={onCancel} />
    </>
  );
}

type Editing = { kind: "list" } | { kind: "edit"; dish: PickDish } | { kind: "remove"; dish: PickDish };

/** The person's dishes, each with its name and size changed, or removed; a removal asks first. */
export function EditDishes({ list, onChanged, onDone }: { list: readonly PickDish[]; onChanged: (removed: string | null) => void; onDone: () => void }) {
  const { session } = useSession();
  const { view } = useMealOutbox();
  const [editing, setEditing] = useState<Editing>({ kind: "list" });
  const [name, setName] = useState("");
  const [ml, setMl] = useState("");
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // The phone's back button: from changing or removing a dish, back to your dishes.
  useSheetBack(3, () => {
    if (editing.kind === "list") return false;
    setEditing({ kind: "list" });
    return true;
  });

  const failed = (answer: { kind: "no_answer" } | { kind: "refused"; status: number }, gone: string): void => {
    if (answer.kind === "refused" && answer.status === 404) {
      onChanged(null);
      setEditing({ kind: "list" });
      setSaid(gone);
    } else setTrouble(answer.kind === "no_answer" || answer.status >= 500 ? NO_CONNECTION : "That couldn’t be saved. Try again.");
  };

  // A cup, mug or bowl the person changed, as everybody has it again.
  const reset = async (dish: PickDish, standard: PickDish) => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    setTrouble(null);
    const answer = await session.signedIn({ method: "DELETE", path: `/v1/nutrition/dishware/${dish.id}` }, nothing);
    setBusy(false);
    if (answer.kind === "ok" || (answer.kind === "refused" && answer.status === 404)) {
      onChanged(null);
      setSaid(`${standard.label} is back to ${String(standard.volumeMl)} ml.`);
    } else setTrouble(answer.kind === "no_answer" || answer.status >= 500 ? NO_CONNECTION : "That couldn’t be saved. Try again.");
  };

  if (editing.kind === "edit") {
    const dish = editing.dish;
    const trimmed = name.trim();
    const size = Number(ml.trim());
    const sizeOk = /^\d+$/.test(ml.trim()) && size >= 1 && size <= MOST_DISH_ML;
    const saveDish = async () => {
      if (trimmed === "" || !sizeOk || busy) return;
      const body = { ...(trimmed === dish.label ? {} : { label: trimmed }), ...(size === dish.volumeMl ? {} : { volumeMl: size }) };
      if (Object.keys(body).length === 0) {
        setEditing({ kind: "list" });
        return;
      }
      setBusy(true);
      setTrouble(null);
      const answer = await session.signedIn({ method: "PATCH", path: `/v1/nutrition/dishware/${dish.id}`, body }, dishwareResponseSchema);
      setBusy(false);
      if (answer.kind === "ok") {
        onChanged(null);
        setEditing({ kind: "list" });
        setSaid(`Saved ${answer.data.dishware.label}, ${String(answer.data.dishware.volumeMl)} ml.`);
      } else failed(answer, `${dish.label} was already removed.`);
    };
    return (
      <>
        <Txt kind="h3">Edit {dish.label}</Txt>
        <Field label="Name" value={name} onChange={setName} maxLength={MOST_DISH_NAME} ready />
        {trimmed === "" ? (
          <Txt kind="small" colour="badText">
            Enter a name for this dish.
          </Txt>
        ) : null}
        <Field label="Its size in ml" value={ml} onChange={setMl} keyboard="number-pad" maxLength={5} />
        {sizeOk ? (
          <Txt kind="small">Meals you logged with it keep their amounts.</Txt>
        ) : (
          <Txt kind="small" colour="badText">
            Type its size in ml, from 1 to {count(MOST_DISH_ML)}.
          </Txt>
        )}
        {trouble === null ? null : (
          <Txt kind="small" colour="badText">
            {trouble}
          </Txt>
        )}
        <Button label="Save" wide disabled={trimmed === "" || !sizeOk} busy={busy} onPress={() => { void saveDish(); }} />
        <Button label="Cancel" kind="quiet" wide onPress={() => { setEditing({ kind: "list" }); }} />
      </>
    );
  }

  if (editing.kind === "remove") {
    const dish = editing.dish;
    const waiting = dishWaiting(view, dish.id);
    const remove = async () => {
      if (busy || waiting) return;
      setBusy(true);
      setTrouble(null);
      const answer = await session.signedIn({ method: "DELETE", path: `/v1/nutrition/dishware/${dish.id}` }, nothing);
      setBusy(false);
      if (answer.kind === "ok" || (answer.kind === "refused" && answer.status === 404)) {
        onChanged(dish.id);
        setEditing({ kind: "list" });
        setSaid(`${dish.label} removed.`);
      } else failed(answer, `${dish.label} was already removed.`);
    };
    return (
      <>
        <Txt kind="h3">Remove {dish.label}?</Txt>
        <Txt kind="small">
          {waiting
            ? `A meal waiting to be sent uses ${dish.label}. Go online to send it, then remove the dish.`
            : `${dish.label} comes off your dishes. Meals you logged with it keep their amounts.`}
        </Txt>
        {trouble === null ? null : (
          <Txt kind="small" colour="badText">
            {trouble}
          </Txt>
        )}
        {waiting ? null : <Button label="Remove dish" kind="danger" wide busy={busy} onPress={() => { void remove(); }} />}
        <Button label="Keep it" kind="quiet" wide onPress={() => { setEditing({ kind: "list" }); }} />
      </>
    );
  }

  return (
    <>
      <Txt kind="h3">Your dishes</Txt>
      {said === null ? null : (
        <View style={styles.headRow}>
          <Icon name="check" size={14} colour="goodText" />
          <Txt kind="small" colour="goodText" style={styles.grow}>
            {said}
          </Txt>
        </View>
      )}
      {trouble === null ? null : (
        <Txt kind="small" colour="badText">
          {trouble}
        </Txt>
      )}
      {list.map((d) => {
        const standard = standardDish(d.id);
        return (
        <View key={d.id} style={styles.dish}>
          <View style={styles.grow}>
            <Txt kind="strong" numberOfLines={2}>
              {d.label}
            </Txt>
            <Txt kind="tiny">{String(d.volumeMl)} ml</Txt>
          </View>
          <Button
            label="Edit"
            kind="link"
            say={`Edit ${d.label}`}
            onPress={() => {
              setSaid(null);
              setTrouble(null);
              setName(d.label);
              setMl(String(d.volumeMl));
              setEditing({ kind: "edit", dish: d });
            }}
          />
          {standard === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${d.label}`}
              onPress={() => {
                setSaid(null);
                setTrouble(null);
                setEditing({ kind: "remove", dish: d });
              }}
              style={({ pressed }) => [styles.bin, pressed ? styles.pressed : null]}
            >
              <Icon name="trash" size={18} colour="badText" />
            </Pressable>
          ) : standard.label === d.label && standard.volumeMl === d.volumeMl ? null : (
            <Button label="Reset" kind="link" say={`Reset ${d.label}`} onPress={() => { void reset(d, standard); }} />
          )}
        </View>
        );
      })}
      <Button label="Done" wide onPress={onDone} />
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  start: { alignSelf: "flex-start" },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  amount: {
    width: 80,
    minHeight: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.fieldLine,
    backgroundColor: colours.field,
    color: colours.text,
    fontFamily: fonts.semibold,
    fontSize: 16,
    textAlign: "center",
    padding: 0,
  },
  fills: { flexDirection: "row", gap: 8 },
  fill: {
    flex: 1,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.glass,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  fillOn: { borderColor: colours.orange, backgroundColor: colours.orangeFill },
  dish: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colours.line },
  bin: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
});
