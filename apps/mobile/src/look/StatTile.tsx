import { Image, StyleSheet, View } from "react-native";
import { Badge, Card } from "./Card";
import { boxShade } from "./colours";
import type { IconName } from "./Icon";
import { pictures, type PictureName } from "./pictures";
import { Txt } from "./Txt";
import { Shown } from "./Waiting";

/** A number in its box, two to a row, its picture standing on the right behind a shade, as on the
 *  Dashboard: its icon, the number, what it counts, and a note under that where there is one. */
export function StatTile(props: { picture: PictureName; icon: IconName; tone?: "orange" | "gold"; value: string | null; failed?: boolean; label: string; note?: string; say?: string }) {
  return (
    <Card style={styles.stat}>
      <Image source={pictures[props.picture]} resizeMode="contain" style={styles.art} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <Badge icon={props.icon} tone={props.tone ?? "orange"} />
      <View accessible accessibilityLabel={props.say ?? (props.value !== null ? `${props.value} ${props.label}` : props.failed === true ? `${props.label}, couldn’t load` : `${props.label}, loading`)}>
        <Shown kind="big" width={48} value={props.value} failed={props.failed ?? false} />
        <Txt kind="small" style={styles.label}>
          {props.label}
        </Txt>
        {props.note === undefined ? null : <Txt kind="tiny">{props.note}</Txt>}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stat: { width: "47%", flexGrow: 1, minHeight: 96, padding: 12, gap: 6 },
  art: { position: "absolute", top: 0, right: 0, width: "65%", height: "100%", opacity: 0.95 },
  shade: { experimental_backgroundImage: boxShade },
  label: { fontSize: 12, lineHeight: 16 },
});
