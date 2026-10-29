import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { Txt } from "../../look/Txt";
import { dishesOffered, useDishes, type PickDish } from "./AmountPicker";
import { FILL_CHOICES } from "./measures";

// The whole meal eaten from one dish (ROADMAP Stage 5 33b-i; Kd, 2026-10-30): which dish, and how full.
// Each food is then given its part of it (`dishShares.ts`); its own amount can still be changed after.

export interface DishPicked {
  dish: PickDish;
  fill: (typeof FILL_CHOICES)[number];
}

/** The dishes everybody has and the person's own, how full, and the button that uses them. `held`: a
 *  line saying why it cannot be used yet. */
export function WholeDish({ held, onUse }: { held: string | null; onUse: (picked: DishPicked) => void }) {
  const { dishes } = useDishes();
  const [dish, setDish] = useState<PickDish | null>(null);
  const [fill, setFill] = useState<(typeof FILL_CHOICES)[number] | null>(null);
  return (
    <View style={styles.box}>
      <Txt kind="small">Each food gets its part of the dish, in the amounts it has now.</Txt>
      <Txt kind="tiny" style={styles.label}>
        Dish
      </Txt>
      <View style={styles.chips}>
        {dishesOffered(dishes).map((d) => (
          <Chip key={d.id} label={`${d.label} · ${String(d.volumeMl)} ml`} on={dish?.id === d.id} onPress={() => { setDish(dish?.id === d.id ? null : d); }} />
        ))}
      </View>
      <Txt kind="tiny" style={styles.label}>
        How full
      </Txt>
      <View style={styles.chips}>
        {FILL_CHOICES.map((f) => (
          <Chip key={f.label} label={f.label} on={fill?.value === f.value} onPress={() => { setFill(fill?.value === f.value ? null : f); }} />
        ))}
      </View>
      {held === null ? null : (
        <Txt kind="small" colour="badText">
          {held}
        </Txt>
      )}
      {dish === null || fill === null ? (
        <Txt kind="small" colour="textSoft">
          Pick the dish and how full it was.
        </Txt>
      ) : null}
      <Button
        label={dish === null || fill === null ? "Use this dish" : `Use ${dish.label}, ${fill.words}`}
        wide
        disabled={dish === null || fill === null || held !== null}
        onPress={() => {
          if (dish !== null && fill !== null) onUse({ dish, fill });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
