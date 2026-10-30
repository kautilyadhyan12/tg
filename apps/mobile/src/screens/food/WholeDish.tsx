import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { STANDARD_DISHES, recentFoodsResponseSchema } from "@app/shared";
import { Chip } from "../../look/Chip";
import { colours } from "../../look/colours";
import { FillDish } from "../../look/FillDish";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NewDish, dishByName, dishesOffered, useDishes, type PickDish } from "./AmountPicker";
import { FILL_CHOICES } from "./measures";

// The whole meal eaten from one dish (ROADMAP Stage 5 33b-i; Kd, 2026-10-30), drawn as the dishes are in
// a food's own box: the dishes, then the dish drawn filled a quarter, half, three quarters and full. The
// dish last used is picked to start (the bowl everybody has for somebody who has used none), and nothing
// changes until a filled dish is tapped: a dish picked for the person must never quietly overwrite the
// amounts the photo saw. Each food is then given its part of it (`dishShares.ts`).

/** The dish and how full, as the meal has them now (`applied`), told by id or, for a logged meal, by
 *  the dish's name. */
export interface DishShown {
  id?: string;
  name?: string;
  fill: number;
}

export interface DishPicked {
  dish: PickDish;
  fill: (typeof FILL_CHOICES)[number];
}

const BOWL = STANDARD_DISHES[2];

/** The dish this person last ate a food from, as their recent foods show it, else the bowl. */
function useLastDish(dishes: ReturnType<typeof useDishes>["dishes"]): PickDish {
  const { session } = useSession();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    void session.signedIn({ method: "GET", path: "/v1/nutrition/foods/recent" }, recentFoodsResponseSchema).then((answer) => {
      if (stale || answer.kind !== "ok") return;
      const m = answer.data.items.map((f) => f.item.measure).find((x) => x?.id === "dish");
      if (m !== undefined) setName(m.name);
    });
    return () => {
      stale = true;
    };
  }, [session]);
  return (name === null ? null : dishByName(dishes, name)) ?? BOWL;
}

/** The dishes and the filled pictures. `held`: why it cannot be used yet, said in place of the pictures. */
export function WholeDish({ applied, held, onUse, onClear }: { applied: DishShown | null; held: string | null; onUse: (picked: DishPicked) => void; onClear: () => void }) {
  const { dishes, again } = useDishes();
  // A dish of the person's own, made here as in a food's own box.
  const [making, setMaking] = useState(false);
  const last = useLastDish(dishes);
  const offered = dishesOffered(dishes);
  const shown = applied === null ? null : (offered.find((d) => d.id === applied.id) ?? (applied.name === undefined ? null : dishByName(dishes, applied.name)));
  const [picked, setPicked] = useState<PickDish | null>(null);
  // A lit dish or a lit picture tapped again is unselected (Kd's click-through, 2026-10-30).
  const [cleared, setCleared] = useState(false);
  const dish = cleared ? null : (picked ?? shown ?? last);
  const on = (fill: number): boolean => applied !== null && shown !== null && shown.id === dish?.id && applied.fill === fill;
  const tapDish = (d: PickDish) => {
    if (dish?.id !== d.id) {
      setCleared(false);
      setPicked(d);
      return;
    }
    setCleared(true);
    setPicked(null);
    if (applied !== null && shown?.id === d.id) onClear();
  };
  return (
    <View style={styles.box}>
      {/* A box of its own, lifted above the keyboard, as a food's own dishes are made. */}
      <Sheet open={making} title="Eaten from one dish" onClose={() => { setMaking(false); }}>
        <NewDish
          onCancel={() => { setMaking(false); }}
          onSaved={(saved) => {
            again();
            setPicked(saved);
            setMaking(false);
          }}
        />
      </Sheet>
      <Txt kind="tiny" style={styles.label}>
        Eaten from one dish
      </Txt>
      <View style={styles.chips}>
        {offered.map((d) => (
          <Chip key={d.id} label={`${d.label} · ${String(d.volumeMl)} ml`} on={dish?.id === d.id} onPress={() => { tapDish(d); }} />
        ))}
        <Chip label="New dish" icon="plus" on={false} onPress={() => { setMaking(true); }} />
      </View>
      {dish === null ? null : held === null ? (
        <View style={styles.fills}>
          {FILL_CHOICES.map((f) => (
            <Pressable
              key={f.value}
              accessibilityRole="button"
              accessibilityLabel={`${dish.label}, ${f.words}`}
              accessibilityState={{ selected: on(f.value) }}
              onPress={() => {
                if (!on(f.value)) {
                  onUse({ dish, fill: f });
                  return;
                }
                setPicked(dish);
                onClear();
              }}
              style={({ pressed }) => [styles.fill, on(f.value) ? styles.fillOn : null, pressed ? styles.pressed : null]}
            >
              <FillDish containerClass={dish.containerClass} fill={f.value} size={56} colour={on(f.value) ? "orange" : "text"} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Txt kind="small">{held}</Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fills: { flexDirection: "row", gap: 8 },
  fill: {
    flex: 1,
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.glass,
    alignItems: "center",
    justifyContent: "center",
  },
  fillOn: { borderColor: colours.orange, backgroundColor: colours.orangeFill },
  pressed: { opacity: 0.8 },
});
