import { StyleSheet, View } from "react-native";
import { Badge, Card } from "../look/Card";
import type { IconName } from "../look/Icon";
import { Txt } from "../look/Txt";

/** A tab's own feature comes with its own job; until then the tab says so, with no made-up number. */
export const NOT_BUILT = "Not in the app yet.";

/** What a tab will hold, in the tab's own box, with no made-up number. */
export function Soon({ icon, title, line }: { icon: IconName; title: string; line: string }) {
  return (
    <Card>
      <View style={styles.head}>
        <Badge icon={icon} />
        <Txt kind="h3" style={styles.title}>
          {title}
        </Txt>
      </View>
      <Txt>{line}</Txt>
      <Txt kind="small" colour="textFaint">
        {NOT_BUILT}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1 },
});
