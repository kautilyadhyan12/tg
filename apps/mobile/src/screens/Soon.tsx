import { StyleSheet, View } from "react-native";
import { Badge, Card } from "../look/Card";
import type { IconName } from "../look/Icon";
import { Txt } from "../look/Txt";

/** Sign-in is ROADMAP Stage 5 item 12. Until it is built a tab has nothing of anybody's to show, and says so. */
export const NO_SIGN_IN = "This copy of the app has no sign-in yet.";

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
        {NO_SIGN_IN}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1 },
});
