import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  INVITATION_WORDS,
  ORG_TYPES_PHRASE,
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
import { NO_ANSWER } from "./SignIn";
import { Soon } from "./Soon";

// The Gym tab (docs/design/phone/pages/Gym and GymNone): the places the person joined, a place
// that removed them, and every invitation still open for their address. It reads again when the
// tab is opened or the app comes back, at most every 30 seconds.

export const GYM_READ_AGAIN_MS = 30_000;

type Read<T> = { kind: "ok"; data: T } | { kind: "failed" };

export function GymScreen() {
  const { session } = useSession();
  const { setKinds } = usePlaces();
  const [mine, setMine] = useState<Read<MyOrgsResponse> | null>(null);
  const [invites, setInvites] = useState<Read<MyInvitationsResponse> | null>(null);
  const [checking, setChecking] = useState(false);
  // "Check for an invitation" was pressed and found none: the sentence says what to do.
  const [checked, setChecked] = useState(false);
  const lastRead = useRef(0);
  const live = useRef(true);

  const readMine = useCallback(async () => {
    const answer = await session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema);
    if (!live.current) return;
    setMine(answer.kind === "ok" ? answer : { kind: "failed" });
    if (answer.kind === "ok") setKinds(answer.data.orgs.filter((org) => org.isMember).map((org) => org.orgType));
  }, [session, setKinds]);

  const readInvites = useCallback(async () => {
    const answer = await session.signedIn({ method: "GET", path: invitationsPath }, myInvitationsResponseSchema);
    if (live.current) setInvites(answer.kind === "ok" ? answer : { kind: "failed" });
  }, [session]);

  const readAll = useCallback(
    async (always: boolean) => {
      const now = Date.now();
      if (!always && now - lastRead.current < GYM_READ_AGAIN_MS) return;
      lastRead.current = now;
      await Promise.all([readMine(), readInvites()]);
    },
    [readMine, readInvites],
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
  const open = invites?.kind === "ok" && invites.data.addressProved ? invites.data.invitations : [];
  const nothing = mine?.kind === "ok" && invites?.kind === "ok" && invites.data.addressProved && joined.length === 0 && open.length === 0;

  return (
    <Page>
      <Txt kind="h1">{placesHeading(joined.map((org) => org.orgType))}</Txt>

      {mine === null || invites === null ? null : mine.kind === "failed" && invites.kind === "failed" ? (
        <Card style={styles.box}>
          <Txt colour="badText">{NO_ANSWER}</Txt>
          <Button label="Try again" kind="soft" small busy={checking} onPress={() => void checkAgain()} />
        </Card>
      ) : null}

      {joined.map((org) => (
        <Card key={org.id} style={styles.box}>
          <PlaceHead name={org.name} orgType={org.orgType} city={org.city}>
            <Pill label="Member" tone="good" icon="check" />
          </PlaceHead>
        </Card>
      ))}
      {joined.length === 0 ? null : <Soon icon="qr" title="Your pass" />}

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

      {open.length === 0 ? null : (
        <InvitationList
          label="Invitations"
          invitations={open}
          onAnswered={(_, kind) => {
            // The page says what happened; the places above read again under it.
            if (kind === "joined") void readMine();
          }}
        />
      )}

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
