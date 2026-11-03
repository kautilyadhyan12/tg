import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { displayNameSchema, myOrgsResponseSchema, onboardingResponseSchema, orgWords, userProfileResponseSchema, type MyOrgsResponse, type Units } from "@app/shared";
import { Button } from "../look/Button";
import { Avatar, Badge, Card } from "../look/Card";
import { Segments } from "../look/Choice";
import { colours, sizes } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon, type IconName } from "../look/Icon";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { HideMe, useHideMe } from "./gym/hideMe";
import { CanSee } from "./Invitation";
import { Setup, accountUnits } from "./setup/Setup";
import { UNIT_OPTIONS } from "./setup/SetupScreens";
import { setupPath } from "./setup/useSetupAnswers";
import { NO_ANSWER } from "./SignIn";

// Settings on the phone (ROADMAP Stage 5 item 19a): the browser's Profile name, Units, Hide me, what
// each place can see and Account, opened over Me. Each part saves on its own and says so in its own
// place; every answer shown is the server's. Setup's answers are under Me's "Your plan", not here again.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2026", the month the account was made, in UTC. */
export function memberSinceText(createdAt: string): string | null {
  const at = new Date(createdAt);
  const month = MONTHS[at.getUTCMonth()];
  return Number.isNaN(at.getTime()) || month === undefined ? null : `${month} ${String(at.getUTCFullYear())}`;
}

export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <CoverPage open={open} title="Settings" picture="setting" tall={0.86} onClose={onClose}>
      {open ? <SettingsBody onClose={onClose} /> : null}
    </CoverPage>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    const run = { live: true };
    void session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema).then((answer) => {
      if (!run.live || answer.kind !== "ok") return;
      setSince(memberSinceText(answer.data.user.createdAt));
      // What the server holds now, as another device may have changed it since this phone last heard.
      void session.keepName(answer.data.user.displayName).then(() => session.keepUnits(answer.data.user.units));
    });
    return () => {
      run.live = false;
    };
  }, [session]);
  return (
    <View testID="settings-page" style={styles.page}>
      <Profile since={since} />
      <NamePart />
      <UnitsPart />
      <BoardsPart />
      <PlacesPart />
      <AccountPart onClose={onClose} />
    </View>
  );
}

/** Who this is, as the browser's Settings shows it at its head: the initial, the name, the email. */
function Profile({ since }: { since: string | null }) {
  const { state } = useSession();
  if (state.kind !== "in") return null;
  return (
    <Card glass style={styles.profile}>
      <Avatar name={state.user.displayName} size={56} />
      <View style={styles.grow}>
        <Txt kind="h3">{state.user.displayName}</Txt>
        {/* An address is long and is never cut: it has the whole line. */}
        <Txt kind="small">{state.user.email}</Txt>
        {since === null ? null : <Txt kind="tiny">Member since {since}</Txt>}
      </View>
    </Card>
  );
}

function Part({ title, icon, children }: { title: string; icon: IconName; children: React.ReactNode }) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Badge icon={icon} />
        <Txt kind="h3">{title}</Txt>
      </View>
      {children}
    </Card>
  );
}

function Said({ words, bad }: { words: string | null; bad: boolean }) {
  if (words === null) return null;
  return (
    <Txt kind="small" colour={bad ? "badText" : "goodText"}>
      {words}
    </Txt>
  );
}

function NamePart() {
  const { session, state } = useSession();
  const now = state.kind === "in" ? state.user.displayName : "";
  const [name, setName] = useState(now);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  // A name changed elsewhere (the browser) shows here once the server has said it, unless the person is typing.
  useEffect(() => {
    if (!typing) setName(now);
  }, [now, typing]);
  const [said, setSaid] = useState<{ words: string; bad: boolean } | null>(null);
  const typed = displayNameSchema.safeParse(name);
  const changed = typed.success && typed.data !== now;
  const save = async () => {
    if (!typed.success || !changed || busy) return;
    setBusy(true);
    setSaid(null);
    const answer = await session.signedIn({ method: "PATCH", path: "/v1/users/me", body: { displayName: typed.data } }, userProfileResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") {
      await session.keepName(answer.data.user.displayName);
      setName(answer.data.user.displayName);
      setTyping(false);
      setSaid({ words: "Your name is saved.", bad: false });
    } else {
      setSaid({ words: answer.kind === "refused" ? answer.message : NO_ANSWER, bad: true });
    }
  };
  return (
    <Part title="Your name" icon="user">
      <Field label="Full name" bare placeholder="First and last name" value={name} onChange={(v) => { setName(v); setTyping(true); setSaid(null); }} name maxLength={100} onDone={() => void save()} />
      {typed.success ? null : <Txt kind="small" colour="badText">Enter your name.</Txt>}
      <Said words={said?.words ?? null} bad={said?.bad ?? false} />
      {changed ? <Button label="Save name" small busy={busy} onPress={() => void save()} style={styles.start} /> : null}
    </Part>
  );
}

function UnitsPart() {
  const { session, state } = useSession();
  const now = state.kind === "in" ? accountUnits(state.user.units) : null;
  const [busy, setBusy] = useState<Units | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const pick = async (units: Units) => {
    if (busy !== null || units === now) return;
    setBusy(units);
    setSaid(null);
    const answer = await session.signedIn({ method: "PATCH", path: "/v1/users/me", body: { units } }, userProfileResponseSchema);
    if (answer.kind === "ok") await session.keepUnits(answer.data.user.units);
    else setSaid(answer.kind === "refused" ? answer.message : NO_ANSWER);
    setBusy(null);
  };
  return (
    <Part title="Units" icon="ruler">
      <Txt kind="small">Weights and heights in the app.</Txt>
      <Segments options={UNIT_OPTIONS} selected={busy ?? now} onPick={(units) => void pick(units)} />
      <Said words={said} bad />
    </Part>
  );
}

function BoardsPart() {
  const { hide, busy, said, load, save } = useHideMe();
  if (hide.kind === "loading") return null;
  return (
    <Part title="Leaderboards" icon="trophy">
      <HideMe hide={hide} busy={busy} said={said} onChange={(hidden) => void save(hidden)} onAgain={() => void load()} />
      {hide.kind === "ok" ? <Txt kind="small">The same at every place you belong to.</Txt> : null}
    </Part>
  );
}

type Places = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; orgs: MyOrgsResponse["orgs"] };

function PlacesPart() {
  const { session } = useSession();
  const [places, setPlaces] = useState<Places>({ kind: "loading" });
  const [shown, setShown] = useState<MyOrgsResponse["orgs"][number] | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    const run = { live: true };
    void session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema).then((answer) => {
      if (!run.live) return;
      setPlaces(answer.kind === "ok" ? { kind: "ok", orgs: answer.data.orgs.filter((org) => org.isMember) } : { kind: "failed" });
    });
    return () => {
      run.live = false;
    };
  }, [session, tries]);
  if (places.kind === "loading" || (places.kind === "ok" && places.orgs.length === 0)) return null;
  return (
    <Part title="Your privacy" icon="shield">
      {places.kind === "failed" ? (
        <View style={styles.between}>
          <Txt kind="small" style={styles.grow}>
            Couldn’t load your places.
          </Txt>
          <Button label="Try again" kind="link" say="Try your places again" onPress={() => { setTries((n) => n + 1); }} />
        </View>
      ) : (
        places.orgs.map((org) => (
          <Pressable
            key={org.id}
            accessibilityRole="button"
            accessibilityLabel={`What ${org.name} can see`}
            onPress={() => { setShown(org); }}
            style={styles.line}
          >
            <Badge icon="building" tone="plain" />
            <Txt kind="strong" style={styles.grow}>
              What {org.name} can see
            </Txt>
            <Icon name="go" size={18} colour="textFaint" />
          </Pressable>
        ))
      )}
      <Sheet open={shown !== null} title={shown === null ? "" : shown.name} onClose={() => { setShown(null); }}>
        {shown === null ? null : <CanSee gymName={shown.name} person={orgWords(shown.orgType).person} />}
      </Sheet>
    </Part>
  );
}

function AccountPart({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const startAgain = async () => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    const answer = await session.signedIn({ method: "DELETE", path: setupPath() }, onboardingResponseSchema);
    setBusy(false);
    if (answer.kind !== "ok") {
      setSaid(answer.kind === "refused" ? answer.message : NO_ANSWER);
      return;
    }
    await session.keepSetupDone(false);
    setAsking(false);
    setAgain(true);
  };
  return (
    <Part title="Account" icon="settings">
      <View style={styles.between}>
        <Txt kind="small">Sign-in</Txt>
        <Txt kind="strong" style={styles.value}>
          Email code or Google
        </Txt>
      </View>
      <View style={styles.rule} />
      <Button label="Start setup again" kind="link" icon="sliders" style={styles.start} onPress={() => { setSaid(null); setAsking(true); }} />
      <Sheet open={asking} title="Start setup again?" onClose={() => { setAsking(false); }}>
        <View style={styles.ask}>
          <Txt>This clears every setup answer, your health answer too, and takes you through setup again. Your name and weigh-ins are kept.</Txt>
          <Said words={said} bad />
          <View style={styles.two}>
            <Button label="Cancel" kind="plain" style={styles.half} onPress={() => { setAsking(false); }} />
            <Button label="Start again" kind="danger" busy={busy} style={styles.half} onPress={() => void startAgain()} />
          </View>
        </View>
      </Sheet>
      <Setup
        open={again}
        mode="front"
        again
        onClose={() => {
          setAgain(false);
          onClose();
        }}
      />
    </Part>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14 },
  card: { gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  line: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.press },
  grow: { flex: 1 },
  value: { flexShrink: 1, textAlign: "right" },
  rule: { height: 1, backgroundColor: colours.line },
  start: { alignSelf: "flex-start" },
  ask: { gap: 14 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
