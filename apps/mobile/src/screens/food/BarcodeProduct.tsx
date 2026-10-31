import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { mealPreviewSchema, FOOD_ALLERGY_CAUTION, type MealItem, type MealType, type OwnFoodItem } from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { newGoalId } from "../goals/words";
import { AmountPicker, useDishes } from "./AmountPicker";
import { allergenWords, checkWords, codeFromTyped, type FoundProduct } from "./barcode";
import { MEAL_TYPES, kcalWords, mealTypeName, sectionOf } from "./day";
import { useMealOutbox } from "./MealOutbox";
import { amountRefusal, chosenItem, loggedAmount, startingAmount, underAGram, type Amount } from "./measures";
import { OwnFood } from "./OwnFood";
import { Credits, SourceLine } from "./SourceLine";

// What a scanned barcode opens (ROADMAP Stage 5 33b-iii-b): the product, its allergens, how much was
// eaten, the meal it was, and Add. Every number is the server's. Kept on the phone until the server
// has it, as any other meal.

const nowSection = (): MealType => sectionOf({ mealType: null, takenAt: new Date().toISOString() });

type Priced = { kind: "none" } | { kind: "ok"; item: MealItem; for: string } | { kind: "refused"; words: string; for: string };

export function BarcodeProduct({ product, onClose, onSaved }: { product: FoundProduct; onClose: () => void; onSaved: (type: MealType, name: string) => void }) {
  const { session } = useSession();
  const { outbox } = useMealOutbox();
  const { dishes, again } = useDishes();
  const food = product.food;
  const [amount, setAmount] = useState<Amount>(() => startingAmount(food));
  const [mealType, setMealType] = useState<MealType>(nowSection);
  const [priced, setPriced] = useState<Priced>({ kind: "none" });
  const [dishAsk, setDishAsk] = useState(0);
  const [panel, setPanel] = useState(false);
  const [full, setFull] = useState(false);
  const [adding, setAdding] = useState(false);
  const addingNow = useRef(false);

  const measure = food.measures.find((m) => m.id === amount.measure);
  const item = chosenItem(food.canonical, amount);
  const tooSmall = underAGram(measure, amount);
  const key = item === null ? "" : JSON.stringify(item);

  useEffect(() => {
    if (item === null || tooSmall) {
      setPriced({ kind: "none" });
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(() => {
      void session.signedIn({ method: "POST", path: "/v1/nutrition/meals/preview", body: { items: [item] } }, mealPreviewSchema).then((answer) => {
        if (stale) return;
        const first = answer.kind === "ok" ? answer.data.items[0] : undefined;
        if (first !== undefined) setPriced({ kind: "ok", item: first, for: key });
        else if (answer.kind === "refused" && amountRefusal(answer.error) !== null) setPriced({ kind: "refused", words: amountRefusal(answer.error) ?? "", for: key });
        else setPriced({ kind: "none" });
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `key` is the whole of `item`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tooSmall, session, dishAsk]);

  const numbers = priced.kind === "ok" && priced.for === key ? priced.item : null;
  const refused = priced.kind === "refused" && priced.for === key ? priced.words : null;
  const held = item === null || tooSmall || refused !== null || outbox === null || adding;

  const add = async () => {
    if (item === null || held || addingNow.current) return;
    addingNow.current = true;
    setAdding(true);
    const id = newGoalId();
    const kept = await outbox.add({
      id,
      body: { id, mealName: food.name.slice(0, 200), takenAt: new Date().toISOString(), mealType, items: [item] },
      items: numbers === null ? null : [numbers],
      totals: numbers === null ? null : { kcalPoint: numbers.kcalPoint, kcalLow: numbers.kcalLow, kcalHigh: numbers.kcalHigh, proteinG: numbers.proteinG, carbsG: numbers.carbsG, fatG: numbers.fatG },
      tried: false,
    });
    addingNow.current = false;
    setAdding(false);
    if (kept) onSaved(mealType, food.name);
    else setFull(true);
  };

  const check = checkWords(product);
  const words = allergenWords(product);
  const credits = new Set<string>([food.source, ...(product.allergensFrom === null ? [] : [product.allergensFrom])]);
  return (
    <Sheet open title={food.name} onClose={onClose}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listInner} keyboardShouldPersistTaps="handled">
        <SourceLine source={food.source} />
        {check === null ? null : (
          <Txt kind="small" colour="gold">
            {check}
          </Txt>
        )}
        <View style={styles.allergens} testID="pack-allergens">
          {words.contains === null ? null : (
            <Txt kind="small" colour="text">
              <Txt kind="strong">Contains: </Txt>
              {words.contains}
            </Txt>
          )}
          {words.mayContain === null ? null : (
            <Txt kind="small" colour="text">
              <Txt kind="strong">May contain: </Txt>
              {words.mayContain}
            </Txt>
          )}
          {words.typed === null ? null : (
            <Txt kind="small" colour="text">
              <Txt kind="strong">Also listed: </Txt>
              {words.typed}
            </Txt>
          )}
          {words.noneListed ? (
            <Txt kind="small" colour="gold">
              No allergens listed. Check the pack.
            </Txt>
          ) : (
            <Txt kind="tiny">{FOOD_ALLERGY_CAUTION}</Txt>
          )}
        </View>
        <AmountPicker
          measures={food.measures}
          amount={amount}
          onAmount={setAmount}
          dishes={dishes}
          onDishes={() => {
            again();
            setDishAsk((n) => n + 1);
          }}
          onPanel={setPanel}
          grams={numbers?.gramsPoint ?? null}
          usual={startingAmount(food)}
        />
        <View style={styles.chips} accessibilityRole="radiogroup">
          {MEAL_TYPES.map((m) => (
            <Chip key={m.type} label={m.name} on={mealType === m.type} onPress={() => { setMealType(m.type); }} />
          ))}
        </View>
        <Credits sources={credits} />
      </ScrollView>
      {panel ? null : (
        <View style={styles.foot}>
          {numbers === null ? null : (
            <Txt kind="small" colour="text">
              {kcalWords(numbers.kcalPoint)} · {loggedAmount(numbers)} · {`P ${String(Math.round(numbers.proteinG))} g · C ${String(Math.round(numbers.carbsG))} g · F ${String(Math.round(numbers.fatG))} g`}
            </Txt>
          )}
          {refused === null ? null : (
            <Txt kind="small" colour="badText">
              {refused}
            </Txt>
          )}
          {full ? (
            <Txt kind="small" colour="badText">
              Too many meals are waiting to be sent. Go online to send them, then add this one.
            </Txt>
          ) : null}
          <Button label={`Add to ${mealTypeName(mealType)}`} wide disabled={held} onPress={() => { void add(); }} />
        </View>
      )}
    </Sheet>
  );
}

/** A product not on the list, added with the person's own numbers: saved as its own meal. */
export function BarcodeOwnFood({ onClose, onSaved }: { onClose: () => void; onSaved: (type: MealType, name: string) => void }) {
  const { outbox } = useMealOutbox();
  const [full, setFull] = useState(false);
  const adding = useRef(false);
  const add = async (food: OwnFoodItem) => {
    if (outbox === null || adding.current) return;
    adding.current = true;
    const id = newGoalId();
    const mealType = nowSection();
    const kept = await outbox.add({ id, body: { id, mealName: food.name.slice(0, 200), takenAt: new Date().toISOString(), mealType, items: [food] }, items: null, totals: null, tried: false });
    adding.current = false;
    if (kept) onSaved(mealType, food.name);
    else setFull(true);
  };
  return (
    <Sheet open title="Your own food" onClose={onClose}>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        <OwnFood start={null} name="" action="Add" onDone={(food) => { void add(food); }} />
        {full ? (
          <Txt kind="small" colour="badText">
            Too many meals are waiting to be sent. Go online to send them, then add this one.
          </Txt>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** A code that won't scan, typed from the digits under it. `said` is what the last try answered. */
export function TypeBarcode({ busy, said, onLook, onClose }: { busy: boolean; said: string | null; onLook: (code: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [short, setShort] = useState(false);
  const look = () => {
    const code = codeFromTyped(typed);
    setShort(code === null);
    if (code !== null) onLook(code);
  };
  return (
    <Sheet open title="Type the number" onClose={onClose}>
      <Field label="Barcode number" value={typed} onChange={(v) => { setShort(false); setTyped(v); }} keyboard="number-pad" maxLength={14} ready spaced onDone={look} />
      {short ? (
        <Txt kind="small" colour="badText">
          Enter all the digits under the barcode.
        </Txt>
      ) : said === null ? null : (
        <Txt kind="small" colour="badText">
          {said}
        </Txt>
      )}
      <Button label={busy ? "Looking…" : "Look up"} wide disabled={busy} onPress={look} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, flexShrink: 1 },
  listInner: { gap: 14 },
  allergens: { gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  foot: { gap: sizes.gap / 2 },
});
