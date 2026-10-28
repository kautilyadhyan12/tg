import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  INVITATION_WORDS,
  ORG_TYPES_PHRASE,
  checkinPassResponseSchema,
  checkinPhoneKeyResponseSchema,
  gymAttendanceHistoryResponseSchema,
  myInvitationsResponseSchema,
  myOrgsResponseSchema,
  orgWords,
  type MyInvitationsResponse,
  type MyOrgsResponse,
} from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card, Pill } from "../look/Card";
import { colours } from "../look/colours";
import { Icon } from "../look/Icon";
import { Page } from "../look/Page";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { InvitationList, PlaceHead, invitationsPath } from "./Invitation";
import { usePlaces } from "./places";
import { placesHeading } from "./placesHeading";
import { DaysYouCame } from "./gym/DaysYouCame";
import { OWN_PASS_AFTER_MS, PASS_PATH, PassSheet } from "./gym/Pass";
import { makePhonePass } from "./gym/phonePass";
import { NO_ANSWER } from "./SignIn";

// The Gym tab (docs/design/phone/pages/Gym and GymNone): the places the person joined, each with
// Show my pass and the days they came there, a place that removed them, and every invitation still open for their address. It reads again when the
// tab is opened or the app comes back, at most every 30 seconds. With the internet it also asks once
// for this sign-in's key for passes with no signal; with none, Show my pass stands alone where the
// places could not be read, or are more than two seconds away (a phone opened with no signal tries
// for a minute before it says so), for the pass works anywhere the person belongs (ROADMAP Stage 5
// item 15c).

export const GYM_READ_AGAIN_MS = 30_000;
export const PHONE_KEY_PATH = `${PASS_PATH}/phone-key`;

type Read<T> = { kind: "ok"; data: T } | { kind: "failed" };

export function GymScreen() {
  const { session, state } = useSession();
  const userId = state.kind === "in" ? state.user.id : null;
  const [ownKey, setOwnKey] = useState<string | null>(() => session.passKey());
  // Asked once while the tab is open: the key is this sign-in's for as long as it lasts.
  const keyAsked = useRef(false);
  // The places have been waited for long enough to offer the pass without them.
  const [placesSlow, setPlacesSlow] = useState(false);
  const { setKinds } = usePlaces();
  const [mine, setMine] = useState<Read<MyOrgsResponse> | null>(null);
  const [invites, setInvites] = useState<Read<MyInvitationsResponse> | null>(null);
  /** The newest finished read of the invitations, numbered as reads start: an answer on the phone stands
   *  until a read that started after it has come back. */
  const [invitesRead, setInvitesRead] = useState(0);
  const invitesStarted = useRef(0);
  const [checking, setChecking] = useState(false);
  // "Check for an invitation" was pressed and found none: the sentence says what to do.
  const [checked, setChecked] = useState(false);
  const lastRead = useRef(0);
  const live = useRef(true);
  // The kind of place whose Show my pass was pressed, or null with the pass closed. The pass is the
  // person's, the same at every place; the kind says only who scans it.
  const [passOrgType, setPassOrgType] = useState<string | null>(null);
  // Counted up when each place's days are to be read again: with the places, and when the pass closes,
  // as a scan at the desk while it was open made a visit.
  const [visitsRead, setVisitsRead] = useState(0);

  const fetchPass = useCallback(() => session.signedIn({ method: "GET", path: PASS_PATH }, checkinPassResponseSchema), [session]);
  const makeOwnPass = useMemo(
    () => (ownKey === null || userId === null ? null : (nowMs: number) => makePhonePass(ownKey, userId, nowMs)),
    [ownKey, userId],
  );

  const readPhoneKey = useCallback(async () => {
    if (keyAsked.current) return;
    keyAsked.current = true;
    const signIn = session.signInNumber();
    const answer = await session.signedIn({ method: "GET", path: PHONE_KEY_PATH }, checkinPhoneKeyResponseSchema);
    if (answer.kind !== "ok") {
      // Asked again with the next read; a refusal is this sign-in's answer and is not.
      if (answer.kind === "no_answer") keyAsked.current = false;
      return;
    }
    await session.keepPassKey(answer.data.key, signIn);
    if (live.current) setOwnKey(session.passKey());
  }, [session]);

  const fetchVisits = useCallback((path: string) => session.signedIn({ method: "GET", path }, gymAttendanceHistoryResponseSchema), [session]);

  const readMine = useCallback(async () => {
    const answer = await session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema);
    if (!live.current) return;
    setMine(answer.kind === "ok" ? answer : { kind: "failed" });
    if (answer.kind === "ok") setKinds(answer.data.orgs.filter((org) => org.isMember).map((org) => org.orgType));
  }, [session, setKinds]);

  const readInvites = useCallback(async () => {
    invitesStarted.current += 1;
    const number = invitesStarted.current;
    const answer = await session.signedIn({ method: "GET", path: invitationsPath }, myInvitationsResponseSchema);
    if (!live.current) return;
    setInvites(answer.kind === "ok" ? answer : { kind: "failed" });
    if (answer.kind === "ok") setInvitesRead((newest) => Math.max(newest, number));
  }, [session]);

  const readAll = useCallback(
    async (always: boolean) => {
      const now = Date.now();
      if (!always && now - lastRead.current < GYM_READ_AGAIN_MS) return;
      lastRead.current = now;
      setVisitsRead((n) => n + 1);
      await Promise.all([readMine(), readInvites(), readPhoneKey()]);
    },
    [readMine, readInvites, readPhoneKey],
  );

  useEffect(() => {
    live.current = true;
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void readAll(false);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [readAll]);

  useEffect(() => {
    const wait = setTimeout(() => {
      setPlacesSlow(true);
    }, OWN_PASS_AFTER_MS);
    return () => {
      clearTimeout(wait);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void readAll(false);
    }, [readAll]),
  );

  const checkAgain = async () => {
    setChecking(true);
    await readAll(true);
    if (live.current) {
      setChecking(false);
      setChecked(true);
    }
  };

  const joined = mine?.kind === "ok" ? mine.data.orgs.filter((org) => org.isMember) : [];
  const removed = mine?.kind === "ok" ? mine.data.formerOrgs : [];
  // A place the person has joined is listed once, as theirs, never again as an invitation.
  const open =
    invites?.kind === "ok" && invites.data.addressProved
      ? invites.data.invitations.filter((invitation) => !joined.some((org) => org.id === invitation.gym.id))
      : [];
  const nothing = mine?.kind === "ok" && invites?.kind === "ok" && invites.data.addressProved && joined.length === 0 && open.length === 0;

  return (
    <Page>
      <Txt kind="h1">{placesHeading(joined.map((org) => org.orgType))}</Txt>

      {/* First, so it stays where it was when the failure comes in under it. */}
      {makeOwnPass !== null && (mine?.kind === "failed" || (mine === null && placesSlow)) ? (
        <Button label="Show my pass" icon="qr" wide onPress={() => { setPassOrgType("unknown"); }} />
      ) : null}

      {mine === null || invites === null ? null : mine.kind === "failed" && invites.kind === "failed" ? (
        <Card style={styles.box}>
          <Txt colour="badText">{NO_ANSWER}</Txt>
          <Button label="Try again" kind="soft" small busy={checking} onPress={() => void checkAgain()} />
        </Card>
      ) : null}

      {mine?.kind === "failed" && invites?.kind === "ok" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Couldn’t load your places.
          </Txt>
          <Button label="Try again" kind="link" busy={checking} onPress={() => void checkAgain()} />
        </View>
      ) : null}

      {joined.map((org) => (
        <Fragment key={org.id}>
          <Card style={styles.box}>
            <PlaceHead name={org.name} orgType={org.orgType} city={org.city}>
              <Pill label="Member" tone="good" icon="check" />
            </PlaceHead>
            <Txt kind="small">
              {org.orgType === "personal_trainer" ? "Show your pass to your trainer when you arrive." : "Show your pass at the front desk when you arrive."}
            </Txt>
            <Button label="Show my pass" icon="qr" wide onPress={() => { setPassOrgType(org.orgType); }} />
          </Card>
          <DaysYouCame gymId={org.id} read={visitsRead} fetchVisits={fetchVisits} />
        </Fragment>
      ))}
      <PassSheet
        open={passOrgType !== null}
        trainer={passOrgType === "personal_trainer"}
        onClose={() => {
          setPassOrgType(null);
          setVisitsRead((n) => n + 1);
        }}
        fetchPass={fetchPass}
        makeOwnPass={makeOwnPass}
      />

      {removed.map((org) => (
        <Card key={org.id} style={styles.box}>
          <View style={styles.row}>
            <Badge icon="building" tone="plain" />
            <View style={styles.grow}>
              <Txt kind="h3" numberOfLines={1}>
                {org.name}
              </Txt>
              <Txt kind="small">
                You’re no longer a {orgWords(org.orgType).person} of {org.name}
              </Txt>
            </View>
          </View>
        </Card>
      ))}

      {invites?.kind === "ok" && !invites.data.addressProved ? (
        <Card style={styles.box}>
          <Txt colour="text">{INVITATION_WORDS.address_not_proved(invites.data.address)}</Txt>
          <Button label="Sign in again" wide onPress={() => void session.signOut()} />
        </Card>
      ) : null}

      {mine?.kind === "ok" && invites?.kind === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Couldn’t load your invitations.
          </Txt>
          <Button label="Try again" kind="link" busy={checking} onPress={() => void checkAgain()} />
        </View>
      ) : null}

      {/* Kept even when the list empties, so a page opened from it stays open with what happened. */}
      <InvitationList
        label="Invitations"
        invitations={open}
        read={invitesRead}
        started={() => invitesStarted.current}
        onAnswered={(_, kind) => {
          // The page says what happened; the places above read again under it.
          if (kind === "joined") void readMine();
        }}
      />

      {nothing ? (
        <Card style={styles.none}>
          <Badge icon="building" />
          <Txt kind="h3">You haven’t joined a {ORG_TYPES_PHRASE} yet.</Txt>
          <Txt>A {ORG_TYPES_PHRASE} invites the email address it has for you, and the invitation shows up here.</Txt>
          <View style={styles.address}>
            <Icon name="mail" size={16} colour="textSoft" />
            <Txt colour="text" style={styles.grow} numberOfLines={1}>
              {invites.data.address}
            </Txt>
            <Txt kind="tiny">your address</Txt>
          </View>
          <Button label="Check for an invitation" kind="plain" wide busy={checking} onPress={() => void checkAgain()} />
          {checking || !checked ? null : (
            <Txt kind="small">{INVITATION_WORDS.no_invitation(invites.data.address)}</Txt>
          )}
        </Card>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, gap: 12 },
  none: { padding: 18, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  address: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 14,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.fieldLine,
    backgroundColor: colours.field,
  },
});
