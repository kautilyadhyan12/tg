import { useEffect, useRef, useState, type RefObject } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import {
  ACCOUNT_UNDO_DAYS,
  deleteAccountResponseSchema,
  displayNameSchema,
  dpdpExportSchema,
  myOrgsResponseSchema,
  onboardingResponseSchema,
  orgWords,
  sendCodeResponseSchema,
  userProfileResponseSchema,
  type MyOrgsResponse,
  type Units,
} from "@app/shared";
import { Directory } from "expo-file-system";
import { Button } from "../look/Button";
import { Avatar, Badge, Card } from "../look/Card";
import { Segments } from "../look/Choice";
import { colours, sizes } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon, type IconName } from "../look/Icon";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { forgetPersonFiles } from "../session/personFiles";
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
// Your data (19b): the server's export saved to a folder the person picks, and Delete account with a
// code emailed to the account's own address; the undo is the link in the email that follows.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2026", the month the account was made on the phone's own calendar, as the browser shows it. */
export function memberSinceText(createdAt: string): string | null {
  const at = new Date(createdAt);
  const month = MONTHS[at.getMonth()];
  return Number.isNaN(at.getTime()) || month === undefined ? null : `${month} ${String(at.getFullYear())}`;
}

export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <CoverPage open={open} title="Settings" picture="setting" tall={0.86} onClose={onClose}>
      {open ? <SettingsBody onClose={onClose} /> : null}
    </CoverPage>
  );
}

type Places = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; orgs: MyOrgsResponse["orgs"] };
type Place = MyOrgsResponse["orgs"][number];

function SettingsBody({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const [since, setSince] = useState<string | null>(null);
  // Each name or units press counts here, so a read begun before it never puts the old answer back.
  const saves = useRef(0);
  useEffect(() => {
    const run = { live: true };
    const read = () => {
      const at = saves.current;
      void session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema).then((answer) => {
        if (!run.live || answer.kind !== "ok") return;
        setSince(memberSinceText(answer.data.user.createdAt));
        if (saves.current !== at) return;
        // What the server holds now, as another device may have changed it since this phone last heard.
        void session.keepName(answer.data.user.displayName).then(() => session.keepUnits(answer.data.user.units));
      });
    };
    read();
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    return () => {
      run.live = false;
      back.remove();
    };
  }, [session]);
  const [places, setPlaces] = useState<Places>({ kind: "loading" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    const run = { live: true };
    void session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema).then((answer) => {
      if (!run.live) return;
      setPlaces(answer.kind === "ok" ? { kind: "ok", orgs: answer.data.orgs } : { kind: "failed" });
    });
    return () => {
      run.live = false;
    };
  }, [session, tries]);
  const memberOf: Places = places.kind === "ok" ? { kind: "ok", orgs: places.orgs.filter((org) => org.isMember) } : places;
  return (
    <View testID="settings-page" style={styles.page}>
      <Profile since={since} />
      <NamePart saves={saves} />
      <UnitsPart saves={saves} />
      <BoardsPart belongs={memberOf.kind === "ok" && memberOf.orgs.length > 0} />
      <PlacesPart places={memberOf} onAgain={() => { setTries((n) => n + 1); }} />
      <AccountPart onClose={onClose} />
      <DataPart places={places} />
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

function NamePart({ saves }: { saves: RefObject<number> }) {
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
    saves.current += 1;
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

function UnitsPart({ saves }: { saves: RefObject<number> }) {
  const { session, state } = useSession();
  const now = state.kind === "in" ? accountUnits(state.user.units) : null;
  const [busy, setBusy] = useState<Units | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const pick = async (units: Units) => {
    if (busy !== null || units === now) return;
    saves.current += 1;
    setBusy(units);
    setSaid(null);
    const answer = await session.signedIn({ method: "PATCH", path: "/v1/users/me", body: { units } }, userProfileResponseSchema);
    if (answer.kind === "ok") await session.keepUnits(answer.data.user.units, true);
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

function BoardsPart({ belongs }: { belongs: boolean }) {
  const { hide, busy, said, load, save } = useHideMe();
  if (hide.kind === "loading") return null;
  return (
    <Part title="Leaderboards" icon="trophy">
      <HideMe hide={hide} busy={busy} said={said} onChange={(hidden) => void save(hidden)} onAgain={() => void load()} />
      {hide.kind === "ok" && belongs ? <Txt kind="small">The same at every place you belong to.</Txt> : null}
    </Part>
  );
}

function PlacesPart({ places, onAgain }: { places: Places; onAgain: () => void }) {
  const [shown, setShown] = useState<Place | null>(null);
  if (places.kind === "loading" || (places.kind === "ok" && places.orgs.length === 0)) return null;
  return (
    <Part title="Your privacy" icon="shield">
      {places.kind === "failed" ? (
        <View style={styles.between}>
          <Txt kind="small" style={styles.grow}>
            Couldn’t load your places.
          </Txt>
          <Button label="Try again" kind="link" say="Try your places again" onPress={onAgain} />
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

/** "Iron House", "Iron House and Lotus Yoga", "Iron House, Lotus Yoga and Pulse". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** "18 November": the day an account deleted now is removed for good, on the phone's own calendar. */
export function deletesOnText(now: Date): string {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ACCOUNT_UNDO_DAYS);
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ""}`;
}

/** What the sign-in screen says once the account is deleted: the undo link only where one was sent. */
export function deletedNote(emailSent: boolean, now: Date): string {
  const day = deletesOnText(now);
  return emailSent
    ? `Your account will be deleted on ${day}. To keep it, open the link we emailed you before then.`
    : `Your account will be deleted on ${day}.`;
}

/** The places a deleted account leaves at once (a member, or staff where they do not own it), and the ones it owns. */
export function placesOnDelete(orgs: readonly Place[]): { leaves: string[]; owns: string[] } {
  return {
    leaves: orgs.filter((org) => org.isMember || (org.staffRole !== null && org.staffRole !== "owner")).map((org) => org.name),
    owns: orgs.filter((org) => org.staffRole === "owner").map((org) => org.name),
  };
}

function DataPart({ places }: { places: Places }) {
  const { session, state } = useSession();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ words: string; bad: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const me = state.kind === "in" ? state.user.id : null;
  const download = async () => {
    if (busy || me === null) return;
    setSaid(null);
    // The folder first, as Save as does: closing the phone's own box saves nothing and says nothing.
    let folder: Directory;
    try {
      folder = await Directory.pickDirectoryAsync();
    } catch {
      return;
    }
    setBusy(true);
    const answer = await session.signedIn({ method: "GET", path: "/v1/users/me/export", waitMs: 60_000 }, dpdpExportSchema);
    // The file is only ever that of the person who asked for it, still signed in.
    if (answer.kind !== "ok" || answer.data.user["id"] !== me || session.state().kind !== "in") {
      setBusy(false);
      setSaid({ words: answer.kind === "refused" ? answer.message : NO_ANSWER, bad: true });
      return;
    }
    const name = `aihomegym-export-${answer.data.exportedAt.slice(0, 10)}.json`;
    try {
      const file = folder.createFile(name, "application/json");
      file.write(JSON.stringify(answer.data, null, 2));
      setSaid({ words: `Saved as ${name}.`, bad: false });
    } catch {
      setSaid({ words: "Couldn’t save the file there. Try another folder.", bad: true });
    }
    setBusy(false);
  };
  return (
    <Part title="Your data" icon="folder">
      <Button label="Download my data" kind="link" icon="download" busy={busy} style={styles.start} onPress={() => void download()} />
      <Said words={said?.words ?? null} bad={said?.bad ?? false} />
      <View style={styles.rule} />
      <Button label="Delete account" kind="link" icon="trash" style={styles.start} onPress={() => { setAsking(true); }} />
      <DeleteAsk open={asking} places={places} onClose={() => { setAsking(false); }} />
    </Part>
  );
}

function DeleteAsk({ open, places, onClose }: { open: boolean; places: Places; onClose: () => void }) {
  const { session, state } = useSession();
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Each opening starts at its first step, with nothing typed.
  useEffect(() => {
    if (!open) return;
    setStep("ask");
    setCode("");
    setProblem(null);
  }, [open]);
  if (state.kind !== "in") return null;
  const me = state.user;
  const { leaves, owns } = places.kind === "ok" ? placesOnDelete(places.orgs) : { leaves: [], owns: [] };
  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "POST", path: "/v1/users/me/delete-code" }, sendCodeResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") {
      setCode("");
      setStep("code");
    } else {
      setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
    }
  };
  const remove = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "DELETE", path: "/v1/users/me", body: { code } }, deleteAccountResponseSchema);
    if (answer.kind !== "ok") {
      setBusy(false);
      if (answer.kind === "refused") setCode("");
      setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
      return;
    }
    // Nothing of the person stays: their waiting meals and drafts, then the sign-in and its pass keys;
    // the files again once nothing of theirs is open, for a write that was already on its way.
    forgetPersonFiles(me.id);
    await session.accountDeleted(deletedNote(answer.data.emailSent, new Date()));
    forgetPersonFiles(me.id);
  };
  return (
    <Sheet open={open} title="Delete account?" onClose={onClose}>
      <View style={styles.ask}>
        {step === "ask" ? (
          <>
            <Txt>
              Your workouts, meals, goals and progress are deleted for good after {String(ACCOUNT_UNDO_DAYS)} days. Until then, the link we email you brings them back.
            </Txt>
            {leaves.length > 0 ? <Txt>You leave {namesText(leaves)} today. To come back, join again from the invitation.</Txt> : null}
            {places.kind === "ok" ? null : <Txt>You also leave every place you belong to.</Txt>}
            {owns.length > 0 ? <Txt>You own {namesText(owns)}. Deleting your account does not close it.</Txt> : null}
            {problem === null ? null : <Txt kind="small" colour="badText">{problem}</Txt>}
            <View style={styles.two}>
              <Button label="Cancel" kind="plain" style={styles.half} onPress={onClose} />
              <Button label="Email me a code" kind="danger" busy={busy} style={styles.half} onPress={() => void sendCode()} />
            </View>
          </>
        ) : (
          <>
            <Txt>We emailed a 6-digit code to {me.email}.</Txt>
            <Field
              label="6-digit code"
              bare
              value={code}
              onChange={(value) => {
                setCode(value.replace(/\D/g, "").slice(0, 6));
                setProblem(null);
              }}
              placeholder="6-digit code"
              keyboard="number-pad"
              fills="one-time-code"
              maxLength={6}
              spaced
              ready
              onDone={() => void remove()}
            />
            {problem === null ? null : <Txt kind="small" colour="badText">{problem}</Txt>}
            <View style={styles.two}>
              <Button label="Cancel" kind="plain" style={styles.half} onPress={onClose} />
              <Button label="Delete" kind="danger" icon="trash" busy={busy} style={styles.half} onPress={() => void remove()} />
            </View>
            <Button label="Email me a new code" kind="link" style={styles.start} onPress={() => void sendCode()} />
          </>
        )}
      </View>
    </Sheet>
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
