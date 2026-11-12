import { StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { colours } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { CHECK_AGAIN, PAY, PAY_CHECK, paySay, type PayTarget, type PayTone } from "./payView";
import type { PayInApp } from "./usePayInApp";

// Pay on My membership (ROADMAP Stage 5 item 20f): the button beside what is due, and under it what Pay is doing or
// how it ended, said in that same place.

/** Pay beside a bill or fee that can be paid in the app now; nothing where it cannot. */
export function PayButton({ target, pay }: { target: PayTarget | null; pay: PayInApp }) {
  if (target === null || !pay.inApp) return null;
  return <Button label={PAY} compact say={paySay(target)} busy={pay.busy?.key === target.key} disabled={pay.busy !== null && pay.busy.key !== target.key} onPress={() => { pay.pay(target); }} />;
}

const TONE_STYLE = { good: "goodSaid", plain: "plainSaid", warn: "warnSaid", bad: "badSaid" } as const;
const TONE_TEXT = { good: "goodText", plain: "textSoft", warn: "orange", bad: "badText" } as const;

/** What happened, in a box of its tone (Buy says it the same way, 20g). */
export function SaidBox({ tone, line, testID }: { tone: PayTone; line: string; testID: string }) {
  return (
    <View testID={testID} style={[styles.box, styles[TONE_STYLE[tone]]]}>
      {tone === "good" ? <Icon name="check" size={14} colour="goodText" /> : null}
      <Txt kind="small" colour={TONE_TEXT[tone]} style={styles.grow}>
        {line}
      </Txt>
    </View>
  );
}

/** Under a bill or fee: what Pay is doing, how it ended with Check again where Square had not said, or that the front
 *  desk is checking an earlier payment. `mine` says whether a Pay key is this bill's or fee's. */
export function PayLines({ mine, check, pay, testID }: { mine: (key: string) => boolean; check: boolean; pay: PayInApp; testID: string }) {
  const busy = pay.busy !== null && mine(pay.busy.key) ? pay.busy.line : null;
  const said = busy === null && pay.said !== null && mine(pay.said.key) ? pay.said.said : null;
  return (
    <>
      {busy === null ? null : (
        <View testID={`${testID}-busy`}>
          <Txt kind="small">{busy}</Txt>
        </View>
      )}
      {said === null ? null : (
        <View style={styles.said}>
          <SaidBox testID={`${testID}-said`} tone={said.tone} line={said.line} />
          {said.again === true ? <Button label={CHECK_AGAIN} kind="link" small onPress={pay.checkAgain} /> : null}
        </View>
      )}
      {check && said?.line !== PAY_CHECK && busy === null ? <SaidBox testID={`${testID}-check`} tone="warn" line={PAY_CHECK} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  said: { gap: 4 },
  box: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  grow: { flex: 1 },
  goodSaid: { backgroundColor: colours.goodFill, borderColor: colours.goodLine },
  plainSaid: { backgroundColor: colours.fill, borderColor: colours.lineStrong },
  warnSaid: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  badSaid: { backgroundColor: colours.badFill, borderColor: colours.badLine },
});
