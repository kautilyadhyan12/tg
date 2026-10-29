import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMinor, myMembershipResponseSchema, receiptSchema, type MyMembership, type MyMembershipResponse, type Receipt } from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { RECEIPT_MOST } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import {
  NO_PAYMENTS,
  cancelledLine,
  classesText,
  couldNotOpenReceipt,
  couldNotRead,
  datesText,
  feeText,
  feesOf,
  myMembershipPath,
  myReceiptPath,
  noMembershipText,
  noRecordText,
  olderMemberships,
  olderPayments,
  olderPurchases,
  owedText,
  paidByText,
  paymentText,
  paysForText,
  purchaseLines,
  purchasePaid,
  receiptHead,
  receiptLines,
  receiptNotes,
  receiptSay,
  receiptTitle,
  refundText,
  statusTag,
  theirNoMembershipText,
  type FeeItem,
  type Tone,
} from "./membershipView";

// A place's My membership for its member (spec Part 3 §14.2; ROADMAP Stage 5 item 16c), laid out as Kd asked
// (`rulings/2026-10-15-18m.md`, `rulings/2026-10-29-16b.md`): Memberships (each with when it renews, what is owed and
// each payment with its refunds under it), Fees (every late cancel, no-show and freeze fee), Purchases (what they
// bought at the desk), and the people they pay for. Every payment, refund, purchase and paid fee opens its receipt
// in the middle box; none is emailed. Read when it opens and when the app comes back; the server decides whose
// money is shown.

export interface MembershipPlace {
  id: string;
  name: string;
}

/** The page over the Gym tab; closed while `place` is null. */
export function MembershipPage({ place, onClose }: { place: MembershipPlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="membership-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <MembershipBody key={place.id} place={place} onClose={onClose} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; view: MyMembershipResponse };
type Opened = { number: number; refund: boolean } & ({ kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; receipt: Receipt });

const PILL_TONES: Readonly<Record<Tone, "good" | "orange" | "bad" | "plain">> = { good: "good", orange: "orange", bad: "bad", plain: "plain" };
const TEXT_TONES: Readonly<Record<Tone, "goodText" | "orange" | "badText" | "textSoft">> = { good: "goodText", orange: "orange", bad: "badText", plain: "textSoft" };

function MembershipBody({ place, onClose, bottom }: { place: MembershipPlace; onClose: () => void; bottom: number }) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [opened, setOpened] = useState<Opened | null>(null);
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const started = useRef(0);
  const receiptAsked = useRef(0);
  const live = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: myMembershipPath(place.id) }, myMembershipResponseSchema);
      if (!live.current || number !== started.current) return;
      if (answer.kind === "ok") setHeld({ kind: "ok", view: answer.data });
      // A read made by itself never takes the page away.
      else if (!quiet) setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
    },
    [session, place.id],
  );

  useEffect(() => {
    live.current = true;
    void load(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void load(true);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load]);

  const openReceipt = useCallback(
    async (number: number, refund: boolean) => {
      receiptAsked.current += 1;
      const asked = receiptAsked.current;
      setOpened({ number, refund, kind: "loading" });
      const answer = await session.signedIn({ method: "GET", path: myReceiptPath(place.id, number) }, receiptSchema);
      if (!live.current || asked !== receiptAsked.current) return;
      // Only the receipt pressed is shown under its number: any other answer is no answer.
      if (answer.kind === "ok" && answer.data.number === number) setOpened({ number, refund, kind: "ok", receipt: answer.data });
      else setOpened({ number, refund, kind: "failed", status: answer.kind === "refused" ? answer.status : null });
    },
    [session, place.id],
  );
  const receiptButton = (number: number, what: string, refund = false) => (
    <Button label="Receipt" kind="link" small say={receiptSay(number, what, refund)} onPress={() => void openReceipt(number, refund)} />
  );

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">My membership</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
        {held.kind === "loading" ? (
          <Txt kind="small">Loading…</Txt>
        ) : held.kind === "failed" ? (
          <Card style={styles.box}>
            <Txt colour="badText">{couldNotRead(held.status, place.name)}</Txt>
            <Button
              label="Try again"
              kind="soft"
              small
              onPress={() => {
                setHeld({ kind: "loading" });
                void load(false);
              }}
            />
          </Card>
        ) : (
          <Sections view={held.view} receiptButton={receiptButton} />
        )}
      </ScrollView>
      <ReceiptBox
        opened={opened}
        onAgain={(o) => void openReceipt(o.number, o.refund)}
        onClose={() => {
          receiptAsked.current += 1;
          setOpened(null);
        }}
      />
    </>
  );
}

type ReceiptButton = (number: number, what: string, refund?: boolean) => React.JSX.Element;

function Sections({ view, receiptButton }: { view: MyMembershipResponse; receiptButton: ReceiptButton }) {
  const gym = view.gym.name;
  const none = noRecordText(view);
  if (none !== null) {
    return (
      <Card style={styles.box}>
        <Txt colour="text">{none}</Txt>
      </Card>
    );
  }
  const fees = feesOf(view.memberships);
  return (
    <>
      <View style={styles.section}>
        <Txt kind="eyebrow" colour="textFaint">
          Memberships
        </Txt>
        {view.paidBy === null ? null : (
          <Txt colour="text">
            {paidByText(view.paidBy)}
          </Txt>
        )}
        {view.memberships.length === 0 ? <Txt>{noMembershipText(gym)}</Txt> : null}
        {view.memberships.map((m) => (
          <MembershipCard key={m.id} m={m} gym={gym} paidBy={view.paidBy !== null} receiptButton={receiptButton} />
        ))}
        {view.earlierNotShown > 0 ? <Txt kind="small">{olderMemberships(gym)}</Txt> : null}
      </View>

      {fees.length === 0 ? null : (
        <View style={styles.section}>
          <Txt kind="eyebrow" colour="textFaint">
            Fees
          </Txt>
          {fees.map((item, i) => (
            <FeeCard key={`${item.fee.on}-${String(i)}`} item={item} gym={gym} receiptButton={receiptButton} />
          ))}
        </View>
      )}

      {view.purchases.length === 0 ? null : (
        <View style={styles.section}>
          <Txt kind="eyebrow" colour="textFaint">
            Purchases
          </Txt>
          {view.purchases.map((p) => (
            <Card key={p.receiptNumber} testID={`purchase-${String(p.receiptNumber)}`} style={styles.box}>
              {purchaseLines(p).map((line, i) => (
                <View key={`${line.label}-${String(i)}`} style={styles.amountRow}>
                  <Txt colour="text" style={styles.grow}>
                    {line.label}
                  </Txt>
                  <Txt colour="text">{line.amount}</Txt>
                </View>
              ))}
              <View style={styles.amountRow}>
                <Txt kind="h3" style={styles.grow}>
                  Total
                </Txt>
                <Txt kind="h3">{formatMinor(p.totalMinor, p.currency)}</Txt>
              </View>
              <View style={styles.row}>
                <Txt kind="small" style={styles.grow}>
                  {purchasePaid(p)}
                </Txt>
                {receiptButton(p.receiptNumber, `your purchase of ${p.lines.map((l) => l.name).join(", ")}`)}
              </View>
              {p.refunds.map((r) => {
                const t = refundText(r, p.currency);
                return (
                  <View key={r.receiptNumber} style={[styles.row, styles.under]}>
                    <View style={styles.grow}>
                      <Txt colour="text">{t.title}</Txt>
                      <Txt kind="small">{t.line}</Txt>
                    </View>
                    {receiptButton(r.receiptNumber, `your purchase of ${p.lines.map((l) => l.name).join(", ")}`, true)}
                  </View>
                );
              })}
            </Card>
          ))}
          {view.purchasesNotShown > 0 ? <Txt kind="small">{olderPurchases(gym)}</Txt> : null}
        </View>
      )}

      {view.paysFor.map((person, i) => {
        const theirFees = feesOf(person.memberships);
        return (
          <View key={`${person.name}-${String(i)}`} style={styles.section} testID={`pays-for-${String(i)}`}>
            <Txt kind="eyebrow" colour="textFaint">
              {person.name}
            </Txt>
            <Txt>{paysForText(person.name)}</Txt>
            {person.memberships.length === 0 ? <Txt>{theirNoMembershipText(person.name, gym)}</Txt> : null}
            {person.memberships.map((m) => (
              <MembershipCard key={m.id} m={m} gym={gym} paidBy={false} receiptButton={receiptButton} />
            ))}
            {theirFees.map((item, j) => (
              <FeeCard key={`${item.fee.on}-${String(j)}`} item={item} gym={gym} receiptButton={receiptButton} />
            ))}
            {person.earlierNotShown > 0 ? <Txt kind="small">{olderMemberships(gym)}</Txt> : null}
          </View>
        );
      })}
    </>
  );
}

function MembershipCard({ m, gym, paidBy, receiptButton }: { m: MyMembership; gym: string; paidBy: boolean; receiptButton: ReceiptButton }) {
  const tag = statusTag(m);
  const dates = datesText(m);
  const classes = classesText(m);
  const owed = owedText(m);
  return (
    <Card testID={`membership-${m.id}`} style={styles.box}>
      <View style={styles.row}>
        <Txt kind="h3" style={styles.grow}>
          {m.name}
        </Txt>
        <Pill label={tag.label} tone={PILL_TONES[tag.tone]} />
      </View>
      {dates === null ? null : <Txt kind="small">{dates}</Txt>}
      {classes === null ? null : <Txt kind="small">{classes}</Txt>}
      {owed === null ? null : <Txt colour={TEXT_TONES[owed.tone]}>{owed.text}</Txt>}
      {m.payments.map((p) => {
        const t = paymentText(p, m.currency);
        return (
          <View key={p.receiptNumber} style={styles.payment}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Txt colour="text">{t.title}</Txt>
                <Txt kind="small">{t.line}</Txt>
              </View>
              {receiptButton(p.receiptNumber, m.name)}
            </View>
            {p.refunds.map((r) => {
              const rt = refundText(r, m.currency);
              return (
                <View key={r.receiptNumber} style={[styles.row, styles.under]}>
                  <View style={styles.grow}>
                    <Txt colour="text">{rt.title}</Txt>
                    <Txt kind="small">{rt.line}</Txt>
                  </View>
                  {receiptButton(r.receiptNumber, m.name, true)}
                </View>
              );
            })}
          </View>
        );
      })}
      {!paidBy && m.payments.length === 0 && m.priceMinor !== null && m.priceMinor > 0 ? <Txt kind="small">{NO_PAYMENTS}</Txt> : null}
      {m.olderPeriodsNotShown > 0 ? <Txt kind="small">{olderPayments(gym)}</Txt> : null}
    </Card>
  );
}

function FeeCard({ item, gym, receiptButton }: { item: FeeItem; gym: string; receiptButton: ReceiptButton }) {
  const t = feeText(item, gym);
  return (
    <Card style={styles.box}>
      <View style={styles.row}>
        <Txt kind="h3" style={styles.grow}>
          {t.title}
        </Txt>
        <Pill label={t.tag.label} tone={PILL_TONES[t.tag.tone]} />
      </View>
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          {t.line}
        </Txt>
        {t.receipt === null ? null : receiptButton(t.receipt, t.title)}
      </View>
      {t.note === null ? null : <Txt colour={TEXT_TONES[t.tag.tone]}>{t.note}</Txt>}
    </Card>
  );
}

function ReceiptBox({ opened, onAgain, onClose }: { opened: Opened | null; onAgain: (o: Opened) => void; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const receipt = opened?.kind === "ok" ? opened.receipt : null;
  const title = receipt !== null ? receiptTitle(receipt) : opened === null ? "" : `${opened.refund ? "Refund receipt" : "Receipt"} #${String(opened.number)}`;
  return (
    <Sheet open={opened !== null} place="middle" title={title} onClose={onClose}>
      {opened === null ? null : opened.kind === "loading" ? (
        <Txt kind="small">Opening the receipt…</Txt>
      ) : opened.kind === "failed" ? (
        <View testID="receipt-failed" style={styles.ask}>
          <Txt colour="badText">{couldNotOpenReceipt(opened.status)}</Txt>
          {opened.status === 404 ? null : (
            <Button
              label="Try again"
              kind="soft"
              small
              onPress={() => {
                onAgain(opened);
              }}
            />
          )}
        </View>
      ) : (
        <ScrollView testID="receipt" style={{ maxHeight: height * RECEIPT_MOST }} contentContainerStyle={styles.receipt}>
          <View>
            <Txt kind="h3">{opened.receipt.gym.name}</Txt>
            {opened.receipt.gym.address === null ? null : <Txt kind="small">{opened.receipt.gym.address}</Txt>}
          </View>
          {cancelledLine(opened.receipt) === null ? null : <Txt colour="badText">{cancelledLine(opened.receipt)}</Txt>}
          <View style={styles.rule}>
            {receiptHead(opened.receipt).map((row) => (
              <View key={row.label} style={styles.amountRow}>
                <Txt kind="small" style={styles.grow}>
                  {row.label}
                </Txt>
                <Txt kind="small" colour="text">
                  {row.value}
                </Txt>
              </View>
            ))}
          </View>
          <View style={styles.rule}>
            {receiptLines(opened.receipt).map((line, i) => (
              <View key={`${line.label}-${String(i)}`} style={styles.amountRow}>
                <Txt kind={line.total === true ? "h3" : "body"} colour={line.total === true || line.strong === true ? "text" : "textSoft"} style={styles.grow}>
                  {line.label}
                </Txt>
                {line.amount === null ? null : (
                  <Txt kind={line.total === true ? "h3" : "body"} colour={line.total === true || line.strong === true ? "text" : "textSoft"}>
                    {line.amount}
                  </Txt>
                )}
              </View>
            ))}
          </View>
          {receiptNotes(opened.receipt).map((note) => (
            <Txt key={note} kind="small">
              {note}
            </Txt>
          ))}
        </ScrollView>
      )}
      {opened === null ? null : <Button label="Done" kind="quiet" style={styles.middle} onPress={onClose} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: sizes.edge, paddingTop: sizes.edge, paddingBottom: 8 },
  back: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: sizes.edge, gap: sizes.gap },
  section: { gap: 10 },
  box: { padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  amountRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  grow: { flex: 1 },
  payment: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  under: { paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: colours.orangeLine },
  ask: { gap: 12 },
  receipt: { gap: 12 },
  rule: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  middle: { alignSelf: "center" },
});
