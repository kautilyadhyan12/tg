import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WAIVER_NAME_MAX_CHARS, AGREEMENT_AGREE_LABEL, PROMO_CODE_WORDS, cardName, cleanSignedName, forSaleResponseSchema, formatMinor, waiverReadyToSign, type DeskSigner, type ForSaleLine, type ForSaleResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { Avatar, Card } from "../../look/Card";
import { Options } from "../../look/Choice";
import { colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { Sheet } from "../../look/Sheet";
import { Tick } from "../../look/Tick";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { AddCardPage, type CardPlace } from "./AddCard";
import { termsHeading } from "./agreementView";
import { ADD_CARD, UPDATE_CARD } from "./cardView";
import {
  BUY,
  BUY_HEADING,
  BUY_SECURE,
  FACTS_HEADING,
  GUARDIAN_LINE,
  PAID_WITH,
  CANCELLED_TITLE,
  CONFIRMING_TITLE,
  MY_PURCHASES,
  NOT_COMPLETED_TITLE,
  PAID_TITLE,
  PASS_LINE,
  PAY_SECURE,
  PENDING_TITLE,
  PROMO_APPLY,
  PROMO_CHECKING,
  PROMO_INSTEAD,
  PROMO_LABEL,
  PROMO_MAX,
  PROMO_NOT_CHECKED,
  PROMO_REMOVE,
  SHOW_PASS,
  SIGNER_LABELS,
  TODAY_TITLE,
  TO_MEMBERSHIP,
  VIEW_MEMBERSHIP,
  WHO_SIGNS,
  buyBody,
  buySay,
  chargedThrough,
  codeOf,
  couldNotLoadForSale,
  forSaleListPath,
  lineSummary,
  notReadyLine,
  paidHow,
  type PaidHow,
  nameLabel,
  nothingForSale,
  notSoldNow,
  paidShortLine,
  payLabel,
  promoApplied,
  promoLine,
  signerOf,
  todayLine,
  todayParts,
  WHAT_YOU_GET,
  whatYouGet,
} from "./buyView";
import { SaidBox } from "./PayPart";
import { CHECK_AGAIN, NOT_PAID, PAY_WAITING } from "./payView";
import { RESUMED, useBuyInApp, type BuyInApp } from "./useBuyInApp";

// Buy in the app (ROADMAP Stage 5 item 20g; spec Part 3 §14.8; Kd's drawing of 2026-11-12, `reviews/20g-mock.png`). The
// Gym tab's Buy, where the place sells something in the app, opens what it sells: its packs, day passes and memberships
// paid once, each with its price and until when it lasts. Buy on a line opens its page: what they pay today, every detail
// in the agreement's own words, the gym's agreement with their name and the tick where it asks for one, and Pay held at
// the foot. Pay opens Square's own page in a tab; back in the app, how it ended is said on that page, and once paid the
// line is theirs and on My membership. The server works out every line and refuses anything but what was shown. A
// repeating membership (20i-i) is paid with the card saved in the app: its page names the card, asks for the card's own
// tick, word for word the server's, and Pay charges the card; with no card, or an expired one, Add card or Update card
// opens over the page and the list is read again once it closes. A promo code (20j) is typed above the lines: Apply reads
// the list again with it, each line showing what it takes off or why not, and Pay waits while that read is on its way.

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
        const answer = await session.signedIn({ method: "GET", path: forSaleListPath(id) }, forSaleResponseSchema);
        // Only "not found" means the place sells nothing to this reader; a refusal for too many asks or a failing server keeps
        // what was known.
        return { id, sells: answer.kind === "ok" ? answer.data.items.length > 0 : answer.kind === "refused" && answer.status === 404 ? false : null };
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
export function BuyPage({ place, onClose, onMembership, onPass }: { place: BuyPlace | null; onClose: () => void; onMembership: (place: BuyPlace) => void; onPass: (place: BuyPlace) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="buy-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <BuyBody key={place.id} place={place} onClose={onClose} onMembership={onMembership} onPass={onPass} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

/** `code`: the promo code the list shown was read with and that takes something off; "" for none (20j). */
type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; view: ForSaleResponse; code: string };
type Read = "ok" | "failed" | "stale";

function BuyBody({
  place,
  onClose,
  onMembership,
  onPass,
  bottom,
}: {
  place: BuyPlace;
  onClose: () => void;
  onMembership: (place: BuyPlace) => void;
  onPass: (place: BuyPlace) => void;
  bottom: number;
}) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  // The line whose page is open, by its type id: read from the newest list each time.
  const [openLine, setOpenLine] = useState<string | null>(null);
  // Add card or Update card, over a repeating membership's page.
  const [addingCard, setAddingCard] = useState<CardPlace | null>(null);
  const started = useRef(0);
  const live = useRef(true);
  // The promo code every read of the list is asked with (20j): "" for none. `wanted` is the same, for the screen: while it
  // differs from the code of the list shown, the list with it is on its way and Pay waits.
  const code = useRef("");
  const [wanted, setWanted] = useState("");
  const [typed, setTyped] = useState("");
  // Why the code typed takes nothing off, or could not be checked: said under the box.
  const [codeSaid, setCodeSaid] = useState<string | null>(null);

  const load = useCallback(
    async (quiet: boolean, asked: string = code.current): Promise<Read> => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: forSaleListPath(place.id, asked) }, forSaleResponseSchema);
      if (!live.current || number !== started.current) return "stale";
      if (answer.kind === "ok") {
        const takes = asked !== "" && answer.data.promo?.applied === true;
        if (asked !== "" && !takes) {
          // It takes nothing off, or no longer does: why is said under the box, and the list is read without it from now on.
          if (code.current === asked) {
            code.current = "";
            setWanted("");
          }
          setTyped(asked);
          setCodeSaid(answer.data.promo?.words ?? PROMO_CODE_WORDS.fits_nothing);
        }
        setHeld({ kind: "ok", view: answer.data, code: takes ? asked : "" });
        return "ok";
      }
      if (!quiet || (answer.kind === "refused" && answer.status === 404)) setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
      return "failed";
    },
    [session, place.id],
  );
  const readAgain = useCallback(() => void load(true), [load]);
  // Apply and Remove: the list read again with the code, or without one.
  const readWith = useCallback(
    async (next: string) => {
      const before = code.current;
      code.current = next;
      setWanted(next);
      setCodeSaid(null);
      const got = await load(true, next);
      if (got === "failed" && live.current && code.current === next) {
        code.current = before;
        setWanted(before);
        setCodeSaid(PROMO_NOT_CHECKED);
      }
    },
    [load],
  );
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

  // Bought: its page closes, and the box in the middle says so over the list.
  const boughtNow = buy.paid !== null;
  useEffect(() => {
    if (!boughtNow) return;
    setOpenLine(null);
    // A code goes with one purchase: the list is read again without it.
    if (code.current === "") return;
    code.current = "";
    setWanted("");
    setTyped("");
    setCodeSaid(null);
    void load(true, "");
  }, [boughtNow, load]);

  const view = held.kind === "ok" ? held.view : null;
  const shownCode = held.kind === "ok" ? held.code : "";
  // The list with another code (or none) is on its way: Pay waits for it.
  const codeBusy = held.kind === "ok" && wanted !== shownCode;
  const apply = () => {
    const next = codeOf(typed);
    if (next === "" || codeBusy) return;
    void readWith(next);
  };
  const line = view === null || openLine === null ? null : (view.items.find((one) => one.typeId === openLine) ?? null);
  const toMembership = () => {
    onMembership(place);
  };
  const open = (typeId: string) => {
    buy.clear();
    // A code typed and not applied yet is applied as the line opens; its page waits for it.
    if (shownCode === "" && !codeBusy && codeSaid === null && codeOf(typed) !== "") void readWith(codeOf(typed));
    setOpenLine(typeId);
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
      <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
        {buy.busy?.at === RESUMED ? <Txt kind="small">{buy.busy.line}</Txt> : null}
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
            {held.view.record === "shared" ? null : (
              <PromoBox
                applied={shownCode}
                typed={typed}
                busy={codeBusy}
                said={codeSaid}
                onType={(text) => {
                  setTyped(text.toUpperCase());
                  setCodeSaid(null);
                }}
                onApply={apply}
                onRemove={() => {
                  setTyped("");
                  void readWith("");
                }}
              />
            )}
            <Txt kind="eyebrow" colour="textFaint">
              {BUY_HEADING}
            </Txt>
            {held.view.record === "shared" ? <Txt colour="orange">{SHARED_LINE}</Txt> : null}
            {held.view.items.map((item) => (
              <LineCard
                key={item.typeId}
                item={item}
                canBuy={held.view.record !== "shared"}
                onOpen={() => {
                  open(item.typeId);
                }}
              />
            ))}
            <View style={styles.secure}>
              <Icon name="shield" size={12} colour="textFaint" />
              <Txt kind="tiny">{BUY_SECURE}</Txt>
            </View>
          </View>
        )}
        {held.kind === "ok" ? <Button label={MY_PURCHASES} kind="link" icon="folder" small say={`${MY_PURCHASES} at ${place.name}`} onPress={toMembership} /> : null}
      </ScrollView>
      <LinePage
        open={openLine !== null}
        place={place}
        line={line}
        view={view}
        buy={buy}
        typeId={openLine}
        codeBusy={codeBusy}
        codeSaid={codeSaid}
        onClose={() => {
          setOpenLine(null);
          buy.clear();
        }}
        onMembership={toMembership}
        onCard={() => {
          setAddingCard({ id: place.id, name: place.name });
        }}
      />
      <AddCardPage
        place={addingCard}
        // Saving closes the page, and closing reads the list again.
        onSaved={() => undefined}
        onClose={() => {
          setAddingCard(null);
          // The card saved, or what the page learnt meanwhile: the list names the card and the tick again.
          readAgain();
        }}
      />
      <ResultBox
        gym={place.name}
        buy={buy}
        onMembership={toMembership}
        onPass={() => {
          onPass(place);
        }}
      />
    </>
  );
}

const SHARED_LINE = "Two app accounts share your record here, so buy at the front desk.";

/** How a page ended, in a box in the middle of the screen, over whatever is open: bought, with Show my pass and My
 *  membership; cancelled, pending, or not answered yet with Check status. A refusal at Pay is said beside Pay instead. */
function ResultBox({ gym, buy, onMembership, onPass }: { gym: string; buy: BuyInApp; onMembership: () => void; onPass: () => void }) {
  const paid = buy.paid?.purchase ?? null;
  const said = buy.said?.said.ended === true ? buy.said.said : null;
  const busy = buy.busy !== null && said !== null ? buy.busy.line : null;
  const cancelled = said?.line === NOT_PAID;
  const title = paid !== null ? PAID_TITLE : said === null ? "" : said.again === true ? CONFIRMING_TITLE : cancelled ? CANCELLED_TITLE : said.tone === "warn" ? PENDING_TITLE : NOT_COMPLETED_TITLE;
  const icon = paid !== null ? "check" : cancelled ? "x" : "info";
  const tone = paid !== null ? styles.markGood : said?.tone === "bad" ? styles.markBad : cancelled ? styles.markPlain : styles.markWarn;
  const iconColour = paid !== null ? "goodText" : said?.tone === "bad" ? "badText" : cancelled ? "textSoft" : "orange";
  const words = paid !== null ? `${paidShortLine(paid)} ${PASS_LINE}` : said === null ? "" : cancelled ? NOT_CHARGED : said.line;
  return (
    <Sheet open={paid !== null || said !== null} place="middle" title={title} onClose={buy.dismiss}>
      <View testID={paid !== null ? "buy-paid" : "buy-ended"} style={styles.result}>
        <View style={[styles.mark, tone]}>
          <Icon name={icon} size={28} colour={iconColour} />
        </View>
        <Txt style={styles.centre}>{words}</Txt>
        {busy === null ? null : (
          <Txt kind="small" style={styles.centre}>
            {busy}
          </Txt>
        )}
      </View>
      {paid !== null ? (
        <View style={styles.resultButtons}>
          <Button label={SHOW_PASS} icon="qr" wide say={`${SHOW_PASS} at ${gym}`} onPress={onPass} />
          <Button label={VIEW_MEMBERSHIP} kind="link" icon="folder" onPress={onMembership} />
          <Button label="Done" kind="quiet" onPress={buy.dismiss} />
        </View>
      ) : (
        <View style={styles.resultButtons}>
          {said?.again === true ? <Button label={CHECK_AGAIN} wide busy={busy !== null} onPress={buy.checkAgain} /> : null}
          {said?.again === true ? <Button label="Close" kind="quiet" onPress={buy.dismiss} /> : <Button label="OK" wide onPress={buy.dismiss} />}
        </View>
      )}
    </Sheet>
  );
}

const NOT_CHARGED = "You weren’t charged.";

/** Above the lines (20j), as the code changes their prices: the Promo code box with Apply, and why a code takes nothing off; once one does, the code with Remove. */
function PromoBox({
  applied,
  typed,
  busy,
  said,
  onType,
  onApply,
  onRemove,
}: {
  applied: string;
  typed: string;
  busy: boolean;
  said: string | null;
  onType: (text: string) => void;
  onApply: () => void;
  onRemove: () => void;
}) {
  if (applied !== "")
    return (
      <Card testID="promo-applied" style={[styles.box, styles.row]}>
        <Icon name="check" size={18} colour="goodText" />
        <Txt colour="text" style={styles.grow}>
          {promoApplied(applied)}
        </Txt>
        <Button label={PROMO_REMOVE} kind="link" small disabled={busy} say={`${PROMO_REMOVE} the code ${applied}`} onPress={onRemove} />
      </Card>
    );
  return (
    <View testID="promo-box" style={styles.said}>
      <View style={styles.promoRow}>
        <View style={styles.grow}>
          <Field label={PROMO_LABEL} bare placeholder={PROMO_LABEL} value={typed} onChange={onType} maxLength={PROMO_MAX} disabled={busy} onDone={onApply} />
        </View>
        <Button label={PROMO_APPLY} kind="soft" busy={busy} disabled={busy || codeOf(typed) === ""} say={`${PROMO_APPLY} the promo code`} onPress={onApply} />
      </View>
      {said === null ? null : (
        <Txt kind="small" colour="badText">
          {said}
        </Txt>
      )}
    </View>
  );
}

function LineCard({ item, canBuy, onOpen }: { item: ForSaleLine; canBuy: boolean; onOpen: () => void }) {
  const summary = lineSummary(item);
  const today = todayLine(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatMinor(item.priceMinor, item.currency)}. ${DETAILS}`}
      onPress={onOpen}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Card testID={`for-sale-${item.typeId}`} style={styles.box}>
        <View style={styles.row}>
          <Txt kind="h3" style={styles.grow}>
            {item.name}
          </Txt>
          <Txt kind="h3">{formatMinor(item.priceMinor, item.currency)}</Txt>
        </View>
        <View style={styles.lines}>
          {item.includes.map((one) => (
            <Txt key={one} kind="small" colour="text">
              {one}
            </Txt>
          ))}
          <Txt kind="small">{summary.price}</Txt>
          {summary.until === null ? null : <Txt kind="small">{summary.until}</Txt>}
          {item.description === null || item.description.trim() === "" ? null : <Txt kind="small">{item.description}</Txt>}
          {today === null ? null : (
            <Txt kind="small" colour="orange">
              {today}
            </Txt>
          )}
          {item.promoWords === null ? null : <Txt kind="small">{item.promoWords}</Txt>}
        </View>
        <View style={[styles.row, styles.rule]}>
          <Txt kind="small" colour="orange" style={styles.grow}>
            {DETAILS}
          </Txt>
          {canBuy ? <Button label={BUY} compact say={buySay(item)} onPress={onOpen} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

const DETAILS = "See details";

/** A line's page: what they pay today, its details, the agreement to sign where the gym asks for one, and Pay. Closed while
 *  `open` is false. `line` is the newest list's; null where the gym no longer sells it. */
function LinePage({
  open,
  place,
  line,
  view,
  buy,
  typeId,
  codeBusy,
  codeSaid,
  onClose,
  onMembership,
  onCard,
}: {
  open: boolean;
  place: BuyPlace;
  line: ForSaleLine | null;
  view: ForSaleResponse | null;
  buy: BuyInApp;
  typeId: string | null;
  codeBusy: boolean;
  codeSaid: string | null;
  onClose: () => void;
  onMembership: () => void;
  onCard: () => void;
}) {
  return open && typeId !== null ? (
    <LineBody
      key={typeId}
      place={place}
      line={line}
      view={view}
      buy={buy}
      typeId={typeId}
      codeBusy={codeBusy}
      codeSaid={codeSaid}
      onClose={onClose}
      onMembership={onMembership}
      onCard={onCard}
    />
  ) : null;
}

function LineBody({
  place,
  line,
  view,
  buy,
  typeId,
  codeBusy,
  codeSaid,
  onClose,
  onMembership,
  onCard,
}: {
  place: BuyPlace;
  line: ForSaleLine | null;
  view: ForSaleResponse | null;
  buy: BuyInApp;
  typeId: string;
  /** The list with another promo code is on its way: Pay waits for it (20j). */
  codeBusy: boolean;
  /** Why the code typed takes nothing off, said where no code is used on this line. */
  codeSaid: string | null;
  onClose: () => void;
  onMembership: () => void;
  onCard: () => void;
}) {
  const known = view === null ? null : signerOf(view.signer);
  const [picked, setPicked] = useState<DeskSigner | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  // The card's own tick, on a repeating membership.
  const [cardAgreed, setCardAgreed] = useState(false);
  const how: PaidHow = line === null || view === null ? { kind: "page" } : paidHow(line, view);
  const signer = known ?? picked;
  const busy = buy.busy?.at === typeId ? buy.busy.line : null;
  // What Pay was refused with is said beside it; how a page ended is the box in the middle.
  const said = buy.said?.at === typeId && buy.said.said.ended !== true ? buy.said.said : null;
  // What they read changed (the details, the wording or who signs): the tick is given again on what is shown now.
  const agreementId = line?.agreement?.id ?? null;
  const factsKey = line?.factsKey ?? null;
  const [readKey, setReadKey] = useState(`${agreementId ?? ""}:${factsKey ?? ""}:${known ?? ""}`);
  const nowKey = `${agreementId ?? ""}:${factsKey ?? ""}:${known ?? ""}`;
  if (nowKey !== readKey) {
    setReadKey(nowKey);
    setAgreed(false);
    setCardAgreed(false);
  }
  // The card's tick names the card and the amounts: another card, or other amounts, take that tick alone away.
  const chargeWords = how.kind === "card" ? how.words : "";
  const [readWords, setReadWords] = useState(chargeWords);
  if (chargeWords !== readWords) {
    setReadWords(chargeWords);
    setCardAgreed(false);
  }
  // A card charge Square has not answered yet: said here, with Check status, in place of Pay.
  const charging = buy.waiting === typeId && busy === null && said === null;
  // A record two app accounts share buys at the front desk: its page reads, with nothing to sign or pay.
  const shared = view?.record === "shared";
  const ready =
    line !== null &&
    !shared &&
    !codeBusy &&
    (how.kind === "page" || (how.kind === "card" && cardAgreed)) &&
    (line.agreement === null || (signer !== null && waiverReadyToSign(name, agreed)));

  const pay = () => {
    if (line === null || !ready || busy !== null) return;
    const sign = line.agreement === null || signer === null ? null : { signer, name: cleanSignedName(name) };
    buy.pay(line.typeId, buyBody(line, sign));
  };

  const foot =
    line === null ? undefined : shared ? (
      <View testID="buy-shared">
        <Txt colour="orange" style={styles.centre}>
          {SHARED_LINE}
        </Txt>
      </View>
    ) : (
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
        {said?.updateCard === true && how.kind === "card" ? <Button label={UPDATE_CARD} kind="link" icon="card" small onPress={onCard} /> : null}
        {charging ? (
          <View testID="buy-charging" style={styles.said}>
            <SaidBox testID="buy-charging-said" tone="warn" line={PAY_WAITING} />
            <Button label={CHECK_AGAIN} wide onPress={buy.checkAgain} />
          </View>
        ) : how.kind === "no_record" || how.kind === "changed" ? (
          <Txt colour="orange" style={styles.centre}>
            {how.line}
          </Txt>
        ) : how.kind === "add_card" || how.kind === "update_card" ? (
          <View testID="buy-card-first" style={styles.said}>
            <Txt colour="orange" style={styles.centre}>
              {how.line}
            </Txt>
            <Button label={how.kind === "add_card" ? ADD_CARD : UPDATE_CARD} icon="card" wide onPress={onCard} />
          </View>
        ) : said?.toMembership === true ? (
          <Button label={TO_MEMBERSHIP} icon="folder" wide onPress={onMembership} />
        ) : (
          <Button label={payLabel(line)} icon="shield" wide busy={busy !== null} disabled={busy !== null || !ready} say={`${payLabel(line)} for ${line.name}`} onPress={pay} />
        )}
        {charging || said?.toMembership === true || (how.kind !== "page" && how.kind !== "card") ? null : (
          <Txt kind="tiny" style={styles.centre}>
            {codeBusy ? PROMO_CHECKING : ready ? (how.kind === "card" ? chargedThrough(how.card) : PAY_SECURE) : notReadyLine(line.agreement !== null, how.kind === "card", signer !== null)}
          </Txt>
        )}
      </>
    );

  const parts = line === null ? null : todayParts(line);
  const promo = line === null ? null : promoLine(line);
  // Why no code comes off this line: the line's own reason, or the list's where the code takes nothing off anywhere.
  const noCode = line === null || line.firstPayment.promo !== null ? null : (line.promoWords ?? codeSaid);
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
          <View testID="buy-what" style={styles.what}>
            <Txt kind="eyebrow" colour="textFaint">
              {WHAT_YOU_GET}
            </Txt>
            {whatYouGet(line).map((one) => (
              <View key={one} style={styles.whatRow}>
                <Icon name="check" size={16} colour="orange" />
                <Txt colour="text" style={styles.grow}>
                  {one}
                </Txt>
              </View>
            ))}
          </View>
          <View testID="buy-today" style={styles.today}>
            <View style={styles.grow}>
              <Txt colour="text">{TODAY_TITLE}</Txt>
              {parts === null ? null : <Txt kind="small">{parts}</Txt>}
              {promo === null ? null : (
                <Txt kind="small" colour="goodText">
                  {promo}
                </Txt>
              )}
              {line.firstPayment.promo?.instead == null ? null : <Txt kind="small">{PROMO_INSTEAD}</Txt>}
              {noCode === null ? null : <Txt kind="small">{noCode}</Txt>}
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
          {line.agreement === null || shared ? null : (
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
          {how.kind !== "card" || shared ? null : (
            <>
              <View style={styles.line} />
              <View testID="buy-card" style={styles.row}>
                <Icon name="card" size={18} colour="orange" />
                <View style={styles.grow}>
                  <Txt kind="small">{PAID_WITH}</Txt>
                  <Txt colour="text">{cardName(how.card)}</Txt>
                </View>
                <Button label={UPDATE_CARD} kind="link" small disabled={busy !== null} say={`${UPDATE_CARD}, ${cardName(how.card)}`} onPress={onCard} />
              </View>
              <Tick
                testID="buy-card-tick"
                label={how.words}
                ticked={cardAgreed}
                disabled={busy !== null}
                onPress={() => {
                  setCardAgreed((now) => !now);
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
  promoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  pressed: { opacity: 0.85 },
  what: { gap: 8 },
  whatRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  result: { alignItems: "center", gap: 12 },
  resultButtons: { gap: 4, alignItems: "center", alignSelf: "stretch", paddingTop: 8 },
  mark: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  markGood: { backgroundColor: colours.goodFill, borderColor: colours.goodLine },
  markBad: { backgroundColor: colours.badFill, borderColor: colours.badLine },
  markWarn: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  markPlain: { backgroundColor: colours.fill, borderColor: colours.lineStrong },
});
