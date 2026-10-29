import { Linking, StyleSheet, View } from "react-native";
import type { FoodSearchItem } from "@app/shared";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { creditsFor } from "./day";

// Where a food's numbers come from, and the food data's own credits, for every screen that lists
// foods: the Food tab and a meal photo's review (ROADMAP Stage 5 32b-i, 33b-i).

export const SOURCE_WORDS: Readonly<Record<FoodSearchItem["source"], string>> = {
  curated: "Verified",
  usda: "USDA",
  openfoodfacts: "Packaged product",
  estimate: "Estimate",
};

/** Where a food's numbers come from; the hand-checked foods with a tick. */
export function SourceLine({ source, before = "" }: { source: FoodSearchItem["source"]; before?: string }) {
  return (
    <View style={styles.source}>
      <Txt kind="tiny">{before}</Txt>
      {source === "curated" ? <Icon name="check" size={12} colour="goodText" /> : null}
      <Txt kind="tiny" colour={source === "curated" ? "goodText" : "textFaint"}>
        {SOURCE_WORDS[source]}
      </Txt>
    </View>
  );
}

/** The food data's own credits, for the sources on screen (food/day.ts, `creditsFor`). */
export function Credits({ sources }: { sources: ReadonlySet<string> }) {
  const credits = creditsFor(sources);
  if (credits.length === 0) return null;
  return (
    <View style={styles.credits}>
      {credits.map((credit) => (
        <Txt key={credit.key} kind="tiny">
          {credit.parts.map((part) =>
            "link" in part ? (
              <Txt
                key={part.text}
                kind="tiny"
                colour="textSoft"
                style={styles.link}
                onPress={() => { void Linking.openURL(part.link); }}
              >
                {part.text}
              </Txt>
            ) : (
              part.text
            ),
          )}
        </Txt>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  source: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  credits: { gap: 6, paddingTop: 4 },
  link: { textDecorationLine: "underline" },
});
