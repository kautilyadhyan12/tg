import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { cardFormMessageSchema, minorToPriceText, type CardForm } from "@app/shared";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { useNoScreenshots } from "../../look/useNoScreenshots";
import { pageAddress } from "../robotCheckPage";
import { CopyContext } from "../ThisCopy";
import { CHECK_SCRIPT, cardPage, cardWhereTo } from "./cardPage";
import { BANK_TITLE, CHECKING_BANK } from "./buyView";
import { Button } from "../../look/Button";

// The bank's check before Pay on a repeating membership (ROADMAP Stage 5 item 20i-ii). Pay asks Square to check the saved
// card for today's amount in Square's own page (`cardPage` with a check), held unseen while Square works; where the card's
// bank asks, Square draws the bank's own box on that page, and the page rises as a box from the bottom to show it. Square
// then hands back its pass for that card, which Pay sends to the server, which charges it once. The member closing the box,
// the bank saying no, or Square not answering ends the check with nothing sent.

/** `card_refused`: Square answered, but with no pass (a card it cannot use, round one H1); `not_reached`: no answer. */
export type BankCheckOutcome = { kind: "pass"; pass: string } | { kind: "bank_no" } | { kind: "card_refused" } | { kind: "closed" } | { kind: "not_reached" };

export interface BankCheckAsk {
  form: CardForm;
  cardId: string;
  amountMinor: number;
  currency: string;
}

/** Cancel on the box while Square works. */
const CANCEL = "Cancel";
/** Square's page not ready in this long reads as not reached; a bank's box typed by hand fits well inside the whole wait. */
const READY_WAIT_MS = 30 * 1000;
const CHECK_WAIT_MS = 10 * 60 * 1000;

/** A pass names the card it was made for (`<card id>#verf:…`): any other is never sent (round one, L1). */
export function passForCard(pass: string, cardId: string): boolean {
  return pass.startsWith(`${cardId}#verf:`);
}

interface Asked {
  page: string;
  /** The api's own address, which Square needs the page to be on (a secure page). */
  address: string;
  cardId: string;
  round: number;
}

/** `run` starts a check and ends with its outcome; `view` holds Square's page and goes anywhere on the screen. */
export function useBankCheck(): { run: (ask: BankCheckAsk) => Promise<BankCheckOutcome>; view: ReactNode } {
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const address = pageAddress(apiUrl);
  const insets = useSafeAreaInsets();
  const [asked, setAsked] = useState<Asked | null>(null);
  const [tall, setTall] = useState(false);
  const web = useRef<WebView>(null);
  const answer = useRef<((outcome: BankCheckOutcome) => void) | null>(null);
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const round = useRef(0);
  // The bank's box shows the card's number: never in a screenshot or a screen recording. The box is a window of its own,
  // which Android marks only if it opens after the app's mark, so it opens once the mark is on (as Add card does).
  const marked = useNoScreenshots(asked !== null);

  const finish = useCallback((outcome: BankCheckOutcome) => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    const give = answer.current;
    answer.current = null;
    started.current = false;
    setAsked(null);
    setTall(false);
    give?.(outcome);
  }, []);

  useEffect(
    () => () => {
      finish({ kind: "closed" });
    },
    [finish],
  );

  const run = useCallback(
    (ask: BankCheckAsk): Promise<BankCheckOutcome> => {
      if (answer.current !== null) return Promise.resolve({ kind: "not_reached" });
      const page = cardPage(ask.form, { cardId: ask.cardId, amount: minorToPriceText(ask.amountMinor, ask.currency), currencyCode: ask.currency });
      if (page === null || address === null) return Promise.resolve({ kind: "not_reached" });
      round.current += 1;
      started.current = false;
      return new Promise<BankCheckOutcome>((resolve) => {
        answer.current = resolve;
        timers.current = [
          setTimeout(() => {
            if (!started.current) finish({ kind: "not_reached" });
          }, READY_WAIT_MS),
          setTimeout(() => {
            finish({ kind: "not_reached" });
          }, CHECK_WAIT_MS),
        ];
        setAsked({ page, address, cardId: ask.cardId, round: round.current });
      });
    },
    [finish, address],
  );

  const close = useCallback(() => {
    finish({ kind: "closed" });
  }, [finish]);

  const view =
    asked === null || !marked ? null : (
      <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        {/* The box covers the screen as soon as the check starts (round one, L2): while Square works it says so, with Cancel;
            where the bank asks, it rises with the bank's page. Square's page stays the same one throughout. */}
        <View testID="bank-check" style={tall ? styles.scrim : styles.waitScrim}>
          <View style={tall ? [styles.sheet, { marginTop: insets.top + 8, paddingBottom: insets.bottom + 12 }] : styles.wait}>
            {tall ? (
              <View key="head" testID="bank-check-box" style={styles.head}>
                <Txt kind="h2" style={styles.title}>
                  {BANK_TITLE}
                </Txt>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.close}>
                  <Icon name="x" size={18} />
                </Pressable>
              </View>
            ) : (
              <View key="wait" testID="bank-check-wait" style={styles.waitBody}>
                <ActivityIndicator size="large" color={colours.orange} />
                <Txt colour="text" style={styles.centre}>
                  {CHECKING_BANK}
                </Txt>
                <Button label={CANCEL} kind="link" small style={styles.cancel} onPress={close} />
              </View>
            )}
            <WebView
              key={`web-${String(asked.round)}`}
              ref={web}
              testID="bank-check-page"
              source={{ html: asked.page, baseUrl: asked.address }}
              originWhitelist={["*"]}
              style={styles.web}
              containerStyle={tall ? styles.web : styles.unseen}
              scrollEnabled={tall}
              nestedScrollEnabled={tall}
              allowFileAccess={false}
              mixedContentMode="never"
              onMessage={(event) => {
                // Only the page itself speaks, never a frame inside it.
                if (pageAddress(event.nativeEvent.url) !== asked.address) return;
                let said: unknown;
                try {
                  said = JSON.parse(event.nativeEvent.data);
                } catch {
                  return;
                }
                const message = cardFormMessageSchema.safeParse(said);
                if (!message.success) return;
                const m = message.data;
                if (m.kind === "ready") {
                  if (started.current) return;
                  started.current = true;
                  web.current?.injectJavaScript(CHECK_SCRIPT);
                } else if (m.kind === "tall") setTall(m.on);
                else if (m.kind === "pass") {
                  if (!started.current) return;
                  finish(passForCard(m.token, asked.cardId) ? { kind: "pass", pass: m.token } : { kind: "card_refused" });
                } else if (m.kind === "bank_no") {
                  if (started.current) finish({ kind: "bank_no" });
                } else if (m.kind === "not_taken") finish({ kind: "card_refused" });
                else if (m.kind === "blocked") finish({ kind: "not_reached" });
              }}
              onError={() => {
                finish({ kind: "not_reached" });
              }}
              onShouldStartLoadWithRequest={(request) => {
                const where = cardWhereTo(request.url, request.isTopFrame, asked.address);
                if (where === "outside") void Linking.openURL(request.url);
                return where === "load";
              }}
              onOpenWindow={(event) => {
                if (cardWhereTo(event.nativeEvent.targetUrl, true, asked.address) === "outside") void Linking.openURL(event.nativeEvent.targetUrl);
              }}
            />
          </View>
        </View>
      </Modal>
    );

  return { run, view };
}

const styles = StyleSheet.create({
  unseen: { position: "absolute", top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  waitScrim: { flex: 1, backgroundColor: colours.scrim, justifyContent: "center", alignItems: "center", padding: sizes.edge },
  wait: {
    minWidth: 240,
    maxWidth: 360,
    paddingVertical: 22,
    paddingHorizontal: 24,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    borderRadius: 24,
  },
  waitBody: { alignItems: "center", gap: 12 },
  centre: { textAlign: "center" },
  cancel: { alignSelf: "center" },
  scrim: { flex: 1, backgroundColor: colours.scrim, justifyContent: "flex-end" },
  sheet: {
    flex: 1,
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: sizes.edge,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colours.lineStrong,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  web: { flex: 1, backgroundColor: colours.box },
});
