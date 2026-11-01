import { StyleSheet, View } from "react-native";
import { FOOD_ALLERGY_CAUTION, type PackagedCheck } from "@app/shared";
import { Txt } from "../../look/Txt";
import { allergenWords, checkWords } from "./barcode";

interface Props {
  kcal: number;
  check: PackagedCheck;
  allergens: readonly string[];
  mayContain: readonly string[];
  listedAsTyped: readonly string[];
  /** A row of a list: what is known, without the lines every row would repeat. */
  brief?: boolean;
}

/** What a person is told about a packaged product, the same from a barcode and from a search: why to check
 *  its numbers, and its allergens. An empty list never reads as safe. */
export function PackWords({ kcal, check, allergens, mayContain, listedAsTyped, brief = false }: Props) {
  const why = checkWords({ check, food: { kcal } });
  const words = allergenWords({ allergens: [...allergens], mayContain: [...mayContain], listedAsTyped: [...listedAsTyped] });
  return (
    <>
      {why === null ? null : (
        <Txt kind="small" colour="gold">
          {why}
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
        {brief ? null : words.noneListed ? (
          <Txt kind="small" colour="gold">
            No allergens listed. Check the pack.
          </Txt>
        ) : (
          <Txt kind="tiny">{FOOD_ALLERGY_CAUTION}</Txt>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({ allergens: { gap: 4 } });
