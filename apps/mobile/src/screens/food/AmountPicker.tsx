import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { dishwarePageSchema, dishwareResponseSchema, type Dishware, type FoodMeasure } from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { FillDish } from "../../look/FillDish";
import { Icon } from "../../look/Icon";
import { MOST_TEXT_GROWTH } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import type { Shape } from "../../session/calls";
import { useSession } from "../../session/SessionProvider";
import { newGoalId } from "../goals/words";
import { DISH_SIZES, MOST_DISH_NAME, dishWaiting, dishWords, newDish, type DishSize } from "./dishes";
import { useMealOutbox } from "./MealOutbox";
import { FILL_CHOICES, amountFor, dishMeasure, dishOf, measureWords, shownMeasures, stepped, unitWords, type Amount } from "./measures";

// A food's amount (ROADMAP 32b-i, 32b-ii-b): by one of its own measures and how many, or by one of the
// person's saved dishes and how full it was, as the browser's measure picker offers them. Saving,
// renaming and removing a dish happen here too, and need a connection: a dish is a setting, not a
// meal, so nothing about it waits on the phone. A dish is sent with an id of its own, kept until the
// server answers, so a save sent twice is one dish.

const NO_CONNECTION = "No connection. Try again.";
/** DELETE answers 204 with no body. */
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

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

/** The dish a measure names, where the person still has it. */
export function pickedDish(dishes: Dishes, measure: string): Dishware | null {
  const id = dishOf(measure);
  return id === null || dishes.kind !== "ok" ? null : (dishes.list.find((d) => d.id === id) ?? null);
}

type Panel = "pick" | "new" | "edit";

export function AmountPicker({
  measures,
  amount,
  onAmount,
  dishes,
  onDishes,
  onPanel,
}: {
  measures: readonly FoodMeasure[];
  amount: Amount;
  onAmount: (amount: Amount) => void;
  dishes: Dishes;
  /** Read the dishes again, after one is saved, renamed or removed. */
  onDishes: () => void;
  /** A dish being saved or the dishes being changed fill the box: the food's own button waits. */
  onPanel: (open: boolean) => void;
}) {
  const [all, setAll] = useState(false);
  const [panel, setPanelState] = useState<Panel>("pick");
  const setPanel = (next: Panel) => {
    setPanelState(next);
    onPanel(next !== "pick");
  };
  const measure = measures.find((m) => m.id === amount.measure);
  const dishId = dishOf(amount.measure);
  const dish = pickedDish(dishes, amount.measure);
  const shown = shownMeasures(measures, amount.measure, all);
  const list = dishes.kind === "ok" ? dishes.list : [];

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
      {dishId === null ? (
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
        </View>
      ) : null}
      <View style={styles.chips}>
        {shown.map((m) => (
          <Chip
            key={m.id}
            label={measureWords(m)}
            on={amount.measure === m.id}
            onPress={() => {
              if (amount.measure !== m.id) onAmount(amountFor(m));
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
          Your dishes
        </Txt>
        {list.length > 0 ? <Button label="Edit" kind="link" onPress={() => { setPanel("edit"); }} say="Edit your dishes" /> : null}
      </View>
      <View style={styles.chips}>
        {list.map((d) => (
          <Chip
            key={d.id}
            label={dishWords(d)}
            on={dishId === d.id}
            onPress={() => {
              if (dishId !== d.id) onAmount({ measure: dishMeasure(d.id), amount: "" });
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
                  onPress={() => { onAmount({ measure: amount.measure, amount: String(f.value) }); }}
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
          {FILL_CHOICES.some((f) => amount.amount === String(f.value)) ? null : <Txt kind="small">Pick how full it was.</Txt>}
        </>
      )}
    </>
  );
}

/** A new dish: a name, and one of the sizes or a size in ml. */
function NewDish({ onCancel, onSaved }: { onCancel: () => void; onSaved: (dish: Dishware) => void }) {
  const { session } = useSession();
  // Kept until the server answers, so a save sent again is the same dish.
  const [id] = useState(newGoalId);
  const [name, setName] = useState("");
  const [size, setSize] = useState<DishSize | null>(null);
  const [ml, setMl] = useState("");
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const body = newDish(name, size, ml);

  const save = async () => {
    if (body === null || busy) return;
    setBusy(true);
    setTrouble(null);
    const answer = await session.signedIn({ method: "POST", path: "/v1/nutrition/dishware", body: { ...body, id } }, dishwareResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") onSaved(answer.data.dishware);
    else setTrouble(answer.kind === "no_answer" || answer.status >= 500 ? NO_CONNECTION : "That dish couldn’t be saved. Check its size and try again.");
  };

  return (
    <>
      <Txt kind="h3">New dish</Txt>
      <Field label="Name" value={name} onChange={setName} placeholder="My blue bowl" maxLength={MOST_DISH_NAME} />
      <Txt kind="tiny" style={styles.label}>
        Size
      </Txt>
      <View style={styles.chips}>
        {DISH_SIZES.map((s) => (
          <Chip key={s.label} label={`${s.label} · ${String(s.volumeMl)} ml`} on={size === s.label} onPress={() => { setSize(s.label); }} />
        ))}
        <Chip label="Type ml" on={size === "ml"} onPress={() => { setSize("ml"); }} />
      </View>
      {size === "ml" ? <Field label="Size in ml" value={ml} onChange={setMl} keyboard="number-pad" maxLength={5} ready /> : null}
      {trouble === null ? null : (
        <Txt kind="small" colour="badText">
          {trouble}
        </Txt>
      )}
      <Button label="Save dish" wide disabled={body === null} busy={busy} onPress={() => { void save(); }} />
      <Button label="Cancel" kind="quiet" wide onPress={onCancel} />
    </>
  );
}

type Editing = { kind: "list" } | { kind: "rename"; dish: Dishware } | { kind: "remove"; dish: Dishware };

/** The person's dishes, each renamed or removed; a removal asks first. */
function EditDishes({ list, onChanged, onDone }: { list: readonly Dishware[]; onChanged: (removed: string | null) => void; onDone: () => void }) {
  const { session } = useSession();
  const { view } = useMealOutbox();
  const [editing, setEditing] = useState<Editing>({ kind: "list" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const failed = (answer: { kind: "no_answer" } | { kind: "refused"; status: number }, gone: string): void => {
    if (answer.kind === "refused" && answer.status === 404) {
      onChanged(null);
      setEditing({ kind: "list" });
      setSaid(gone);
    } else setTrouble(answer.kind === "no_answer" || answer.status >= 500 ? NO_CONNECTION : "That couldn’t be saved. Try again.");
  };

  if (editing.kind === "rename") {
    const dish = editing.dish;
    const trimmed = name.trim();
    const rename = async () => {
      if (trimmed === "" || busy) return;
      if (trimmed === dish.label) {
        setEditing({ kind: "list" });
        return;
      }
      setBusy(true);
      setTrouble(null);
      const answer = await session.signedIn({ method: "PATCH", path: `/v1/nutrition/dishware/${dish.id}`, body: { label: trimmed } }, dishwareResponseSchema);
      setBusy(false);
      if (answer.kind === "ok") {
        onChanged(null);
        setEditing({ kind: "list" });
        setSaid(`Renamed to ${answer.data.dishware.label}.`);
      } else failed(answer, `${dish.label} was already removed.`);
    };
    return (
      <>
        <Txt kind="h3">Rename {dish.label}</Txt>
        <Field label="Name" value={name} onChange={setName} maxLength={MOST_DISH_NAME} ready />
        {trimmed === "" ? (
          <Txt kind="small" colour="badText">
            Enter a name for this dish.
          </Txt>
        ) : null}
        {trouble === null ? null : (
          <Txt kind="small" colour="badText">
            {trouble}
          </Txt>
        )}
        <Button label="Save" wide disabled={trimmed === ""} busy={busy} onPress={() => { void rename(); }} />
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
      {list.length === 0 ? <Txt kind="small">You have no saved dishes.</Txt> : null}
      {list.map((d) => (
        <View key={d.id} style={styles.dish}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rename ${d.label}`}
            onPress={() => {
              setSaid(null);
              setTrouble(null);
              setName(d.label);
              setEditing({ kind: "rename", dish: d });
            }}
            style={({ pressed }) => [styles.grow, pressed ? styles.pressed : null]}
          >
            <Txt kind="strong" numberOfLines={2}>
              {d.label}
            </Txt>
            <Txt kind="tiny">{String(d.volumeMl)} ml · Rename</Txt>
          </Pressable>
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
        </View>
      ))}
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
