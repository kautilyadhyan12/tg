import { useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { barcodeReplySchema } from "@app/shared";
import { Button } from "../../look/Button";
import { Field } from "../../look/Field";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { newGoalId } from "../goals/words";
import type { FoundProduct } from "./barcode";
import { labelToSave, type TypedLabel } from "./labelRead";

// The check box of a pack's label (ROADMAP Stage 5 33b-iii-c): what was read, each number changeable,
// nothing kept until Save. `id` is the saved label being changed, or null for a new one.

const CHECK_WORDS = {
  part_missing: "Some numbers couldn’t be read. Copy them from the pack.",
  doesnt_add_up: "These numbers don’t add up. Check the pack.",
} as const;

export function LabelCheck({
  start,
  code,
  id,
  check,
  onClose,
  onSaved,
}: {
  start: TypedLabel;
  code: string | null;
  id: string | null;
  check: "fine" | "part_missing" | "doesnt_add_up";
  onClose: () => void;
  onSaved: (product: FoundProduct) => void;
}) {
  const { session } = useSession();
  const [typed, setTyped] = useState(start);
  const [saying, setSaying] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The same id if it is sent again, so a save that was lost and tried again is one food.
  const saveId = useRef(id ?? newGoalId());
  const set = (field: keyof TypedLabel) => (value: string) => {
    setSaying(null);
    setTyped((now) => ({ ...now, [field]: value }));
  };
  const save = async () => {
    const made = labelToSave(typed, code);
    if ("missing" in made) {
      setSaying(made.missing);
      return;
    }
    setSaving(true);
    const answer = await session.signedIn({ method: "PUT", path: `/v1/nutrition/labels/${saveId.current}`, body: made.body }, barcodeReplySchema);
    setSaving(false);
    if (answer.kind === "ok" && answer.data.status === "found") onSaved(answer.data);
    else if (answer.kind === "refused") setSaying(answer.message);
    else setSaying("No connection. Try again.");
  };
  const noAllergens = typed.contains.trim() === "" && typed.mayContain.trim() === "";
  return (
    <Sheet open title="Check the label" onClose={onClose}>
      <ScrollView style={styles.list} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Txt kind="small" colour={check === "fine" ? "text" : "gold"}>
          {check === "fine" ? "Check these against the pack." : CHECK_WORDS[check]}
        </Txt>
        <Field label="Food name" value={typed.name} onChange={set("name")} maxLength={80} />
        <Field label={`Numbers are for (${typed.unit})`} value={typed.amount} onChange={set("amount")} keyboard="decimal-pad" maxLength={8} />
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field label="Calories" value={typed.kcal} onChange={set("kcal")} keyboard="decimal-pad" maxLength={8} />
          </View>
          <View style={styles.grow}>
            <Field label="Protein (g)" value={typed.proteinG} onChange={set("proteinG")} keyboard="decimal-pad" maxLength={8} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field label="Carbs (g)" value={typed.carbsG} onChange={set("carbsG")} keyboard="decimal-pad" maxLength={8} />
          </View>
          <View style={styles.grow}>
            <Field label="Fat (g)" value={typed.fatG} onChange={set("fatG")} keyboard="decimal-pad" maxLength={8} />
          </View>
        </View>
        <Field label="Contains" value={typed.contains} onChange={set("contains")} maxLength={400} />
        <Field label="May contain" value={typed.mayContain} onChange={set("mayContain")} maxLength={400} />
        {noAllergens ? (
          <Txt kind="small" colour="gold">
            No allergens listed. Check the pack.
          </Txt>
        ) : null}
        {saying === null ? null : (
          <Txt kind="small" colour="badText">
            {saying}
          </Txt>
        )}
      </ScrollView>
      <Button label={saving ? "Saving…" : "Save"} wide disabled={saving} onPress={() => { void save(); }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, flexShrink: 1 },
  inner: { gap: 12 },
  row: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
});
