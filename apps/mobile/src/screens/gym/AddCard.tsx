import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { MEMBER_CARD_WORDS, cardFormMessageSchema, myCardResponseSchema, type MyCardView } from "@app/shared";
import { Button } from "../../look/Button";
import { Avatar, Card } from "../../look/Card";
import { colours } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Tick } from "../../look/Tick";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { pageAddress } from "../robotCheckPage";
import { NO_ANSWER } from "../SignIn";
import { CopyContext } from "../ThisCopy";
import { SAVE_SCRIPT, cardPage, cardWhereTo } from "./cardPage";
import { ADD_CARD, CARD_NOT_LOADED, CARD_NOT_READY, CARD_NOT_SAVED, CARD_NOT_TAKEN, SAVE_CARD, UPDATE_CARD, cardReadyToSave, myCardPath } from "./cardView";
import { newRequestKey } from "./classesView";

// Add card and Update card (ROADMAP Stage 5 item 20d): a page over My membership with Square's own card boxes, the
// gym's agreement to tick, and Save card at its foot. The page belongs to ONE business: its form is read for that
// business, Square's token is taken only while this page is saving, and it is saved only to that business. Square's
// boxes tell the person what is wrong with what they typed; the server's words say anything else.

export interface CardPlace {
  id: string;
  name: string;
}

/** Refusals that mean the page is out of date. */
const CHANGED = ["card_agreement_changed", "card_not_ready", "card_paid_by_payer", "card_not_your_record", "card_not_taken"];

/** The boxes' height before Square says its own, and the room Square's or the bank's check takes over the page. */
const FIRST_TALL = 110;
const CHECK_TALL = 600;

type Held = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ok"; view: MyCardView };

/** The page; closed while `place` is null. `onSaved` has the box as the server answers it, with the card saved. */
export function AddCardPage({ place, onClose, onSaved }: { place: CardPlace | null; onClose: () => void; onSaved: (gymId: string, view: MyCardView) => void }) {
  return place === null ? null : <Body key={place.id} place={place} onClose={onClose} onSaved={onSaved} />;
}

function Body({ place, onClose, onSaved }: { place: CardPlace; onClose: () => void; onSaved: (gymId: string, view: MyCardView) => void }) {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const address = pageAddress(apiUrl);
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [tall, setTall] = useState(FIRST_TALL);
  const [checking, setChecking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const web = useRef<WebView>(null);
  // Square's token is taken only between a press of Save card and its answer.
  const saving = useRef(false);
  const live = useRef(true);
  // The card as this page found it: after a lost answer, a newer one means the save went through.
  const savedBefore = useRef<string | null>(null);

  const load = useCallback(async (): Promise<MyCardView | null> => {
    const answer = await session.signedIn({ method: "GET", path: myCardPath(place.id) }, myCardResponseSchema);
    if (!live.current) return null;
    if (answer.kind === "ok") {
      setHeld({ kind: "ok", view: answer.data.myCard });
      return answer.data.myCard;
    }
    setHeld({ kind: "failed", message: answer.kind === "refused" ? answer.message : NO_ANSWER });
    return null;
  }, [session, place.id]);

  useEffect(() => {
    live.current = true;
    void load().then((view) => {
      savedBefore.current = view?.card?.savedAt ?? null;
    });
    return () => {
      live.current = false;
    };
  }, [load]);

  const view = held.kind === "ok" ? held.view : null;
  const page = view === null || view.form === null ? null : cardPage(view.form);
  const ready = cardReadyToSave(drawn, agreed, busy);

  const redraw = () => {
    setBlocked(false);
    setDrawn(false);
    setTall(FIRST_TALL);
    setRound((n) => n + 1);
  };

  const finish = (saved: MyCardView) => {
    if (saved.card === null) {
      setProblem(CARD_NOT_SAVED);
      return;
    }
    onSaved(place.id, saved);
    onClose();
  };

  const send = async (token: string) => {
    if (view === null) return;
    const answer = await session.signedIn(
      { method: "POST", path: myCardPath(place.id), body: { sourceId: token, agreed: true, agreement: view.agreement, requestKey: newRequestKey() } },
      myCardResponseSchema,
    );
    if (!live.current) return;
    setBusy(false);
    if (answer.kind === "ok") {
      finish(answer.data.myCard);
      return;
    }
    if (answer.kind === "no_answer") {
      // The save may have gone through before the answer was lost: read the card again.
      const now = await load();
      // A page closed meanwhile reads nothing (`load` answers null).
      if (now === null) return;
      if (now.card !== null && now.card.savedAt !== savedBefore.current) finish(now);
      else setProblem(NO_ANSWER);
      return;
    }
    setProblem(answer.message);
    // The agreement's words changed, or the gym or the record changed meanwhile: show what is asked now. A card the bank
    // or Square refused keeps the page as it is, to try again.
    if (answer.error === "card_agreement_changed") setAgreed(false);
    if (answer.status === 404 || CHANGED.includes(answer.error)) void load();
  };

  const save = () => {
    if (!ready || page === null) return;
    setBusy(true);
    setProblem("");
    saving.current = true;
    web.current?.injectJavaScript(SAVE_SCRIPT);
  };

  const title = view !== null && view.card !== null ? UPDATE_CARD : ADD_CARD;
  const canSave = view !== null && view.canSave && page !== null && address !== null;

  const foot = !canSave ? undefined : (
    <>
      {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
      <Button label={SAVE_CARD} wide busy={busy} disabled={!ready} say={`Save this card for ${place.name}`} onPress={save} />
      {drawn && agreed ? null : (
        <Txt kind="tiny" style={styles.centre}>
          {CARD_NOT_READY}
        </Txt>
      )}
    </>
  );

  return (
    <CoverPage open title={title} onClose={onClose} foot={foot}>
      <Card testID="add-card" style={styles.paper}>
        <View style={styles.head}>
          <Avatar name={place.name} size={52} />
          <View style={styles.grow}>
            <Txt kind="h3" numberOfLines={1}>
              {place.name}
            </Txt>
          </View>
        </View>
        <View style={styles.line} />
        {held.kind === "loading" ? (
          <Txt kind="small">Loading…</Txt>
        ) : held.kind === "failed" ? (
          <>
            <Txt colour="badText">{held.message}</Txt>
            <Button
              label="Try again"
              kind="soft"
              small
              onPress={() => {
                setHeld({ kind: "loading" });
                void load();
              }}
            />
          </>
        ) : !canSave ? (
          <Txt colour="text">{problem === "" ? MEMBER_CARD_WORDS.not_taken : problem}</Txt>
        ) : (
          <>
            {blocked ? (
              <View style={styles.trouble}>
                <Txt colour="badText">{CARD_NOT_LOADED}</Txt>
                <Button label="Try again" kind="link" onPress={redraw} />
              </View>
            ) : (
              <View style={{ height: checking ? CHECK_TALL : tall }}>
                <WebView
                  ref={web}
                  key={round}
                  testID="card-boxes"
                  source={{ html: page, baseUrl: address }}
                  originWhitelist={["*"]}
                  style={styles.web}
                  containerStyle={styles.web}
                  scrollEnabled={checking}
                  allowFileAccess={false}
                  mixedContentMode="never"
                  onMessage={(event) => {
                    // Only the page itself speaks, never a frame inside it.
                    if (pageAddress(event.nativeEvent.url) !== address) return;
                    let said: unknown;
                    try {
                      said = JSON.parse(event.nativeEvent.data);
                    } catch {
                      return;
                    }
                    const message = cardFormMessageSchema.safeParse(said);
                    if (!message.success) return;
                    const m = message.data;
                    if (m.kind === "ready") setDrawn(true);
                    else if (m.kind === "height") setTall(Math.min(Math.max(m.px, 48), CHECK_TALL));
                    else if (m.kind === "tall") setChecking(m.on);
                    else if (m.kind === "blocked") {
                      saving.current = false;
                      setBusy(false);
                      setBlocked(true);
                    } else if (m.kind === "not_taken") {
                      if (!saving.current) return;
                      saving.current = false;
                      setBusy(false);
                      setProblem(CARD_NOT_TAKEN);
                    } else {
                      // A token nobody asked for is never sent.
                      if (!saving.current) return;
                      saving.current = false;
                      void send(m.token);
                    }
                  }}
                  onError={() => {
                    setBlocked(true);
                  }}
                  onShouldStartLoadWithRequest={(request) => {
                    const where = cardWhereTo(request.url, request.isTopFrame, address);
                    if (where === "outside") void Linking.openURL(request.url);
                    return where === "load";
                  }}
                  onOpenWindow={(event) => {
                    if (cardWhereTo(event.nativeEvent.targetUrl, true, address) === "outside") void Linking.openURL(event.nativeEvent.targetUrl);
                  }}
                />
              </View>
            )}
            <Tick
              testID="card-agree"
              label={view.agreement}
              ticked={agreed}
              disabled={busy}
              onPress={() => {
                setAgreed((now) => !now);
              }}
            />
          </>
        )}
      </Card>
    </CoverPage>
  );
}


const styles = StyleSheet.create({
  grow: { flex: 1 },
  paper: { padding: 16, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { height: 1, backgroundColor: colours.line },
  web: { flex: 1, backgroundColor: colours.box },
  trouble: { gap: 8, alignItems: "flex-start" },
  centre: { textAlign: "center" },
});
