import { StyleSheet, View } from "react-native";
import type { MyCardView } from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { colours } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { CARD_TITLE, cardBox } from "./cardView";

// Card on file on My membership (ROADMAP Stage 5 item 20d): the card the gym charges, with Update card; or No card on
// file with Add card; or who pays for them. Nothing where the gym does not take cards in the app. What was just saved
// is said in this box (`said`).

export function CardOnFile({ view, said, onAdd }: { view: MyCardView; said: string | null; onAdd: () => void }) {
  const box = cardBox(view);
  if (box === null) return null;
  return (
    <View style={styles.section}>
      <Txt kind="eyebrow" colour="textFaint">
        {CARD_TITLE}
      </Txt>
      <Card testID="card-on-file" style={styles.box}>
        {said === null ? null : (
          <View testID="card-said" style={styles.said}>
            <Icon name="check" size={14} colour="goodText" />
            <Txt kind="small" colour="goodText" style={styles.grow}>
              {said}
            </Txt>
          </View>
        )}
        {box.kind === "paid_by" ? (
          <Txt colour="text">{box.line}</Txt>
        ) : box.kind === "card" ? (
          <>
            <View style={styles.row}>
              <View style={[styles.face, box.expired ? styles.faceBad : null]}>
                <Icon name="card" size={18} colour={box.expired ? "badText" : "textSoft"} />
              </View>
              <View style={styles.grow}>
                <Txt kind="h3">{box.name}</Txt>
                <Txt kind="small" colour={box.expired ? "badText" : "textSoft"}>
                  {box.expiry}
                </Txt>
              </View>
              {box.expired ? <Pill label="Expired" tone="bad" /> : box.button === null ? null : <Button label={box.button} kind="link" small onPress={onAdd} />}
            </View>
            {box.expired && box.button !== null ? <Button label={box.button} icon="card" wide onPress={onAdd} /> : null}
          </>
        ) : (
          <>
            <View style={styles.row}>
              <View style={[styles.face, styles.faceNone]}>
                <Icon name="card" size={18} colour="textFaint" />
              </View>
              <Txt kind="h3" style={styles.grow}>
                No card on file
              </Txt>
            </View>
            {box.line === null ? null : <Txt colour="text">{box.line}</Txt>}
            <Button label={box.button} icon="card" kind={box.line === null ? "soft" : "main"} wide onPress={onAdd} />
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  box: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  face: {
    width: 52,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  faceNone: { borderStyle: "dashed", backgroundColor: colours.fill },
  faceBad: { borderColor: colours.badLine },
  said: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.goodLine,
    backgroundColor: colours.goodFill,
  },
});
