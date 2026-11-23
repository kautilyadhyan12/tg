import { heartZoneOf } from "@app/shared";
import { StyleSheet, View } from "react-native";
import { colours, sizes } from "../look/colours";
import { Icon } from "../look/Icon";
import { Txt } from "../look/Txt";
import { zoneColour } from "./HeartZones";

/** The heart rate now (37f-i), on a run beside the GPS light and over a workout's picture (64a-vi): No signal, never 0
 *  and never an old number. With a maximum heart rate (37f-ii-a), its zone too, in the zone's colour. `big` on a
 *  workout, read from a step back. */
export function HeartPill({ bpm, max, big = false }: { bpm: number | null; max: number | null; big?: boolean }) {
  const zone = bpm === null || max === null ? null : heartZoneOf(bpm, max);
  const said = bpm === null ? "Heart rate: no signal" : `Heart rate ${String(bpm)} beats a minute${zone === null ? "" : `, zone ${String(zone)}`}`;
  return (
    <View accessibilityLabel={said} style={[styles.pill, big ? styles.big : null, zone === null ? null : { borderColor: colours[zoneColour(zone)] }]} testID="heart-pill">
      <Icon name="heart" size={big ? 17 : 14} colour={bpm === null ? "textFaint" : zone === null ? "orange" : zoneColour(zone)} filled={big && bpm !== null} />
      <Txt kind={big ? "strong" : "small"} colour={bpm === null ? "textSoft" : "text"} numberOfLines={1} fit={big} style={big ? styles.bigWords : null}>
        {bpm === null ? "No signal" : `${String(bpm)} bpm${zone === null ? "" : ` · Zone ${String(zone)}`}`}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: sizes.round, backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.lineStrong },
  // On a workout: as tall as the sound switch beside it, filling its row, on the panel's own colour.
  big: { gap: 8, paddingHorizontal: 14, minHeight: 48, backgroundColor: colours.raised },
  bigWords: { flexShrink: 1 },
});
