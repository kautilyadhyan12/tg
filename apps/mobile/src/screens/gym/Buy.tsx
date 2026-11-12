import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WAIVER_NAME_MAX_CHARS, AGREEMENT_AGREE_LABEL, cleanSignedName, forSaleResponseSchema, formatMinor, waiverReadyToSign, type DeskSigner, type ForSaleLine, type ForSaleResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { Avatar, Card } from "../../look/Card";
import { Options } from "../../look/Choice";
import { colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { Tick } from "../../look/Tick";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { termsHeading } from "./agreementView";
import {
  BUY,
  BUY_HEADING,
  BUY_SECURE,
  FACTS_HEADING,
  GUARDIAN_LINE,
  NOT_READY,
  NOT_READY_WHO,
  PAID_TITLE,
  PAY_SECURE,
  SIGNER_LABELS,
  TODAY_TITLE,
  TO_MEMBERSHIP,
  VIEW_MEMBERSHIP,
  WHO_SIGNS,
  buyBody,
  buySay,
  couldNotLoadForSale,
  forSalePath,
  lineSummary,
  nameLabel,
  nothingForSale,
  notSoldNow,
  paidBuyLine,
  paidResumedLine,
  payLabel,
  signerOf,
  todayLine,
  todayParts,
} from "./buyView";
import { SaidBox } from "./PayPart";
import { CHECK_AGAIN } from "./payView";
import { RESUMED, useBuyInApp, type BuyInApp } from "./useBuyInApp";

// Buy in the app (ROADMAP Stage 5 item 20g; spec Part 3 §14.8; Kd's drawing of 2026-11-12, `reviews/20g-mock.png`). The
// Gym tab's Buy, where the place sells something in the app, opens what it sells: its packs, day passes and memberships
// paid once, each with its price and until when it lasts. Buy on a line opens its page: what they pay today, every detail
// in the agreement's own words, the gym's agreement with their name and the tick where it asks for one, and Pay held at
// the foot. Pay opens Square's own page in a tab; back in the app, how it ended is said on that page, and once paid the
// line is theirs and on My membership. The server works out every line and refuses anything but what was shown.

export interface BuyPlace {
  id: string;
  name: string;
  /** A purchase kept from before Android closed the app behind Square's page: ended as Buy opens. */
  resume?: string | null;
}

/** Which of these places sell something in the app now, read with the places. A read that fails leaves a place as it was. */
export function useSellsInApp(gymIds: readonly string[], read: unknown): ReadonlySet<string> {
  const { session } = useSession();
  const [sells, setSells] = useState<ReadonlySet<string>>(new Set());
  const ids = gymIds.join(",");
  useEffect(() => {
    const run = { live: true };
    const asked = ids === "" ? [] : ids.split(",");
    void Promise.all(
      asked.map(async (id) => {
        const answer = await session.signedIn({ method: "GET", path: forSalePath(id) }, forSaleResponseSchema);
        return { id, sells: answer.kind === "ok" ? answer.data.items.length > 0 : answer.kind === "refused" ? false : null };
      }),
    ).then((answers) => {
      if (!run.live) return;
      setSells((before) => new Set(answers.filter((a) => a.sells === true || (a.sells === null && before.has(a.id))).map((a) => a.id)));
    });
    return () => {
      run.live = false;
    };
  }, [session, ids, read]);
  return sells;
}

/** The page over the Gym tab; closed while `place` is null. */
export function BuyPage({ place, onClose, onMembership }: { place: BuyPlace | null; onClose: () => void; onMembership: (place: BuyPlace) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="buy-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <BuyBody key={place.id} place={place} onClose={onClose} onMembership={onMembership} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; view: ForSaleResponse };

function BuyBody({ place, onClose, onMembership, bottom }: { place: BuyPlace; onClose: () => void; onMembership: (place: BuyPlace) => void; bottom: number }) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  // The line whose page is open, by its type id: read from the newest list each time.
  const [openLine, setOpenLine] = useState<string | null>(null);
  const started = useRef(0);
  const live = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: forSalePath(place.id) }, forSaleResponseSchema);
      if (!live.current || number !== started.current) return;
      if (answer.kind === "ok") setHeld({ kind: "ok", view: answer.data });
      else if (!quiet || (answer.kind === "refused" && answer.status === 404)) setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
    },
    [session, place.id],
  );
  const readAgain = useCallback(() => void load(true), [load]);
  const buy = useBuyInApp(place.id, readAgain);
  const { resume } = buy;

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

  // A purchase kept from before the app was closed is ended as Buy opens, once.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || place.resume === undefined || place.resume === null) return;
    resumed.current = true;
    resume(place.resume);
  }, [place.resume, resume]);

  const view = held.kind === "ok" ? held.view : null;
  const line = view === null || openLine === null ? null : (view.items.find((one) => one.typeId === openLine) ?? null);
  const toMembership = () => {
    onMembership(place);
  };

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">{BUY}</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
        <Resumed buy={buy} onMembership={toMembership} />
        {held.kind === "loading" ? (
          <Txt kind="small">Loading…</Txt>
        ) : held.kind === "failed" ? (
          <Card style={styles.box}>
            <Txt colour="badText">{couldNotLoadForSale(held.status, place.name)}</Txt>
            {held.status === 404 ? null : (
              <Button
                label="Try again"
                kind="soft"
                small
                onPress={() => {
                  setHeld({ kind: "loading" });
                  void load(false);
                }}
              />
            )}
          </Card>
        ) : held.view.items.length === 0 ? (
          <Card style={styles.box}>
            <Txt colour="text">{nothingForSale(held.view.gym.name)}</Txt>
          </Card>
        ) : (
          <View style={styles.section}>
            <Txt kind="eyebrow" colour="textFaint">
              {BUY_HEADING}
            </Txt>
            {held.view.record === "shared" ? <Txt colour="orange">{SHARED_LINE}</Txt> : null}
            {held.view.items.map((item) => (
              <LineCard
                key={item.typeId}
                item={item}
                canBuy={held.view.record !== "shared"}
                onBuy={() => {
                  buy.clear();
                  setOpenLine(item.typeId);
                }}
              />
            ))}
            <View style={styles.secure}>
              <Icon name="shield" size={12} colour="textFaint" />
              <Txt kind="tiny">{BUY_SECURE}</Txt>
            </View>
          </View>
        )}
      </ScrollView>
      <LinePage
        open={openLine !== null}
        place={place}
        line={line}
        view={view}
        buy={buy}
        typeId={openLine}
        onClose={() => {
          setOpenLine(null);
          buy.clear();
        }}
        onMembership={toMembership}
      />
    </>
  );
}

const SHARED_LINE = "Two app accounts share your record here, so buy at the front desk.";

/** What happened to a page kept from before the app was closed, at the top of the list. */
function Resumed({ buy, onMembership }: { buy: BuyInApp; onMembership: () => void }) {
  const busy = buy.busy?.at === RESUMED ? buy.busy.line : null;
  const paid = buy.paid?.at === RESUMED ? buy.paid.purchase : null;
  const said = buy.said?.at === RESUMED ? buy.said.said : null;
  if (busy !== null) return <Txt kind="small">{busy}</Txt>;
  if (paid !== null) {
    return (
      <View testID="buy-resumed" style={styles.said}>
        <SaidBox testID="buy-resumed-paid" tone="good" line={paidResumedLine(paid)} />
        <Button label={VIEW_MEMBERSHIP} kind="link" small onPress={onMembership} />
      </View>
    );
  }
  if (said === null) return null;
  return (
    <View testID="buy-resumed" style={styles.said}>
      <SaidBox testID="buy-resumed-said" tone={said.tone} line={said.line} />
      {said.again === true ? <Button label={CHECK_AGAIN} kind="link" small onPress={buy.checkAgain} /> : null}
    </View>
  );
}

function LineCard({ item, canBuy, onBuy }: { item: ForSaleLine; canBuy: boolean; onBuy: () => void }) {
  const summary = lineSummary(item);
  const today = todayLine(item);
  return (
    <Card testID={`for-sale-${item.typeId}`} style={styles.box}>
      <View style={styles.row}>
        <Txt kind="h3" style={styles.grow}>
          {item.name}
        </Txt>
        <Txt kind="h3">{formatMinor(item.priceMinor, item.currency)}</Txt>
      </View>
      <View style={styles.lines}>
        <Txt kind="small">{summary.price}</Txt>
        {summary.until === null ? null : <Txt kind="small">{summary.until}</Txt>}
        {item.description === null || item.description.trim() === "" ? null : <Txt kind="small">{item.description}</Txt>}
        {today === null ? null : (
          <Txt kind="small" colour="orange">
            {today}
          </Txt>
        )}
      </View>
      {canBuy ? (
        <View style={[styles.row, styles.rule]}>
          <View style={styles.grow} />
          <Button label={BUY} compact say={buySay(item)} onPress={onBuy} />
        </View>
      ) : null}
    </Card>
  );
}

/** A line's page: what they pay today, its details, the agreement to sign where the gym asks for one, and Pay. Closed while
 *  `open` is false. `line` is the newest list's; null where the gym no longer sells it. */
function LinePage({
  open,
  place,
  line,
  view,
  buy,
  typeId,
  onClose,
  onMembership,
}: {
  open: boolean;
  place: BuyPlace;
  line: ForSaleLine | null;
  view: ForSaleResponse | null;
  buy: BuyInApp;
  typeId: string | null;
  onClose: () => void;
  onMembership: () => void;
}) {
  return open && typeId !== null ? <LineBody key={typeId} place={place} line={line} view={view} buy={buy} typeId={typeId} onClose={onClose} onMembership={onMembership} /> : null;
}

function LineBody({
  place,
  line,
  view,
  buy,
  typeId,
  onClose,
  onMembership,
}: {
  place: BuyPlace;
  line: ForSaleLine | null;
  view: ForSaleResponse | null;
  buy: BuyInApp;
  typeId: string;
  onClose: () => void;
  onMembership: () => void;
}) {
  const known = view === null ? null : signerOf(view.signer);
  const [picked, setPicked] = useState<DeskSigner | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  // Whether the press that was paid signed the agreement, for the line saying so.
  const [sentSigned, setSentSigned] = useState(false);
  const signer = known ?? picked;
  const busy = buy.busy?.at === typeId ? buy.busy.line : null;
  const said = buy.said?.at === typeId ? buy.said.said : null;
  const paid = buy.paid?.at === typeId ? buy.paid.purchase : null;
  // What they read changed (the details, the wording or who signs): the tick is given again on what is shown now.
  const agreementId = line?.agreement?.id ?? null;
  const factsKey = line?.factsKey ?? null;
  const [readKey, setReadKey] = useState(`${agreementId ?? ""}:${factsKey ?? ""}:${known ?? ""}`);
  const nowKey = `${agreementId ?? ""}:${factsKey ?? ""}:${known ?? ""}`;
  if (nowKey !== readKey) {
    setReadKey(nowKey);
    setAgreed(false);
  }
  const ready = line !== null && (line.agreement === null || (signer !== null && waiverReadyToSign(name, agreed)));

  if (paid !== null) {
    return (
      <CoverPage
        open
        title={paid.name}
        onClose={onClose}
        foot={
          <>
            <Button label={VIEW_MEMBERSHIP} icon="folder" wide onPress={onMembership} />
            <Button label="Done" kind="quiet" onPress={onClose} />
          </>
        }
      >
        <View testID="buy-paid" style={styles.done}>
          <View style={styles.doneMark}>
            <Icon name="check" size={32} colour="goodText" />
          </View>
          <Txt kind="h2" style={styles.centre}>
            {PAID_TITLE}
          </Txt>
          <Txt style={styles.centre}>{paidBuyLine(paid, sentSigned)}</Txt>
        </View>
      </CoverPage>
    );
  }

  const pay = () => {
    if (line === null || !ready || busy !== null) return;
    const sign = line.agreement === null || signer === null ? null : { signer, name: cleanSignedName(name) };
    setSentSigned(sign !== null);
    buy.pay(line.typeId, buyBody(line, sign));
  };

  const foot =
    line === null ? undefined : (
      <>
        {busy !== null ? (
          <Txt kind="small" style={styles.centre}>
            {busy}
          </Txt>
        ) : said !== null ? (
          <View style={styles.said}>
            <SaidBox testID="buy-said" tone={said.tone} line={said.line} />
            {said.again === true ? <Button label={CHECK_AGAIN} kind="link" small onPress={buy.checkAgain} /> : null}
          </View>
        ) : null}
        {said?.toMembership === true ? (
          <Button label={TO_MEMBERSHIP} icon="folder" wide onPress={onMembership} />
        ) : (
          <Button label={payLabel(line)} icon="shield" wide busy={busy !== null} disabled={busy !== null || !ready} say={`${payLabel(line)} for ${line.name}`} onPress={pay} />
        )}
        {said?.toMembership === true ? null : (
          <Txt kind="tiny" style={styles.centre}>
            {ready ? PAY_SECURE : signer === null ? NOT_READY_WHO : NOT_READY}
          </Txt>
        )}
      </>
    );

  const parts = line === null ? null : todayParts(line);
  return (
    <CoverPage open title={line?.name ?? ""} onClose={onClose} foot={foot}>
      {line === null ? (
        <Card testID="buy-gone" style={styles.paper}>
          {said === null ? null : <SaidBox testID="buy-said" tone={said.tone} line={said.line} />}
          <Txt colour="text">{view === null ? couldNotLoadForSale(null, place.name) : view.items.length === 0 ? nothingForSale(view.gym.name) : notSoldNow(view.gym.name)}</Txt>
        </Card>
      ) : (
        <Card testID="buy-line" style={styles.paper}>
          <View style={styles.row}>
            <Avatar name={place.name} size={52} />
            <View style={styles.grow}>
              <Txt kind="h3" numberOfLines={1}>
                {place.name}
              </Txt>
              <Txt kind="small" numberOfLines={2}>
                {line.name}
              </Txt>
            </View>
          </View>
          <View testID="buy-today" style={styles.today}>
            <View style={styles.grow}>
              <Txt colour="text">{TODAY_TITLE}</Txt>
              {parts === null ? null : <Txt kind="small">{parts}</Txt>}
            </View>
            <Txt kind="h3">{formatMinor(line.firstPayment.amountMinor, line.currency)}</Txt>
          </View>
          <Txt kind="eyebrow" colour="textFaint">
            {FACTS_HEADING}
          </Txt>
          <View testID="buy-facts" style={styles.facts}>
            {line.facts.map((fact) => (
              <View key={fact.label} style={styles.fact}>
                <Txt kind="small" style={styles.factLabel}>
                  {fact.label}
                </Txt>
                <Txt colour="text" style={styles.factValue}>
                  {fact.value}
                </Txt>
              </View>
            ))}
          </View>
          {line.agreement === null ? null : (
            <>
              <View style={styles.line} />
              <Txt kind="eyebrow" colour="textFaint">
                {termsHeading(place.name, line.agreement.name)}
              </Txt>
              <Txt colour="text" style={styles.words}>
                {line.agreement.text}
              </Txt>
              <View style={styles.line} />
              {known === null ? (
                <View style={styles.who}>
                  <Txt colour="text">{WHO_SIGNS}</Txt>
                  <Options
                    solid
                    options={(["person", "guardian"] as const).map((value) => ({ value, label: SIGNER_LABELS[value] }))}
                    selected={picked}
                    disabled={busy !== null}
                    onPick={(value) => {
                      setPicked(value);
                      setAgreed(false);
                    }}
                  />
                </View>
              ) : known === "guardian" ? (
                <Txt colour="orange">{GUARDIAN_LINE}</Txt>
              ) : null}
              <Field label={nameLabel(signer)} value={name} onChange={setName} fills="name" name maxLength={WAIVER_NAME_MAX_CHARS} disabled={busy !== null} />
              <Tick
                label={AGREEMENT_AGREE_LABEL}
                ticked={agreed}
                disabled={busy !== null}
                onPress={() => {
                  setAgreed((now) => !now);
                }}
              />
            </>
          )}
        </Card>
      )}
    </CoverPage>
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
  lines: { gap: 2 },
  rule: { paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  grow: { flex: 1 },
  secure: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 4 },
  said: { gap: 4 },
  paper: { padding: 16, gap: 14 },
  today: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    backgroundColor: colours.orangeFill,
  },
  facts: { gap: 8 },
  fact: { flexDirection: "row", gap: 14 },
  // The label and its value side by side, as the agreement lists them; each grows with the largest text.
  factLabel: { flex: 2 },
  factValue: { flex: 3 },
  line: { height: 1, backgroundColor: colours.line },
  words: { lineHeight: 21 },
  who: { gap: 10 },
  centre: { textAlign: "center" },
  done: { alignItems: "center", gap: 10, paddingTop: 48 },
  doneMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.goodFill,
    borderWidth: 1,
    borderColor: colours.goodLine,
  },
});
