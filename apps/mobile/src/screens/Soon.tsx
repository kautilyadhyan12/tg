import { StyleSheet, View } from "react-native";
import { Badge, Card, Pill } from "../look/Card";
import type { IconName } from "../look/Icon";
import { Txt } from "../look/Txt";

/** A tab's own feature comes with its own job; until then one line names it, with no made-up number. */
export const COMING_SOON = "Coming soon";

export function Soon({ icon, title }: { icon: IconName; title: string }) {
  return (
    <Card style={styles.row}>
      <Badge icon={icon} />
      <Txt kind="h3" style={styles.title}>
        {title}
      </Txt>
      {/* A pill keeps to its own top; this keeps it level with a title of two lines. */}
      <View>
        <Pill label={COMING_SOON} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1 },
});
