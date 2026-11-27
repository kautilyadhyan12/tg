import { heartZoneOf } from "@app/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { colours, sizes } from "../look/colours";
import { Icon } from "../look/Icon";
import { Txt } from "../look/Txt";
import { zoneColour } from "./HeartZones";
import type { BluetoothState } from "./monitor";

/** What stands for the heart rate when there is none: why, where the phone knows (37n, the bug hunt's C1, C2, C5). */
export function noSignalWords(bluetooth: BluetoothState = "on"): string {
  if (bluetooth === "off") return "Bluetooth off";
  // Android's Nearby devices is allowed or not, never on or off (round one, L6); the box it opens has Allow.
  if (bluetooth === "denied") return "Allow Nearby devices";
  if (bluetooth === "location") return "Location off";
  return "No signal";
}

/** The heart rate now (37f-i), on a run beside the GPS light and over a workout's picture (64a-vi): No signal, never 0
 *  and never an old number. With a maximum heart rate (37f-ii-a), its zone too, in the zone's colour. `big` on a
 *  workout, read from a step back. */
export function HeartPill({ bpm, max, big = false, bluetooth = "on", onPress }: { bpm: number | null; max: number | null; big?: boolean; bluetooth?: BluetoothState; onPress?: () => void }) {
  const zone = bpm === null || max === null ? null : heartZoneOf(bpm, max);
  const none = noSignalWords(bluetooth);
  const said = bpm === null ? `Heart rate: ${none.toLowerCase()}` : `Heart rate ${String(bpm)} beats a minute${zone === null ? "" : `, zone ${String(zone)}`}`;
  const style = [styles.pill, big ? styles.big : null, zone === null ? null : { borderColor: colours[zoneColour(zone)] }];
  const inside = (
    <>
      <Icon name="heart" size={big ? 17 : 14} colour={bpm === null ? "textFaint" : zone === null ? "orange" : zoneColour(zone)} filled={big && bpm !== null} />
      <Txt kind={big ? "strong" : "small"} colour={bpm === null ? "textSoft" : "text"} numberOfLines={1} fit={big} style={big ? styles.bigWords : null}>
        {bpm === null ? none : `${String(bpm)} bpm${zone === null ? "" : ` · Zone ${String(zone)}`}`}
      </Txt>
      {onPress === undefined ? null : <Icon name="go" size={14} colour="textSoft" />}
    </>
  );
  // `onPress`: on a run with no heart rate, the pill opens the monitor box, which says what to do (37n).
  if (onPress !== undefined) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${said}. Open heart rate monitor`} onPress={onPress} hitSlop={6} style={({ pressed }) => [...style, pressed ? styles.pressed : null]} testID="heart-pill">
        {inside}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={said} style={style} testID="heart-pill">
      {inside}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: sizes.round, backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.lineStrong },
  // On a workout: as tall as the sound switch beside it, filling its row, on the panel's own colour.
  big: { gap: 8, paddingHorizontal: 14, minHeight: 48, backgroundColor: colours.raised },
  bigWords: { flexShrink: 1 },
  pressed: { opacity: 0.8 },
});
