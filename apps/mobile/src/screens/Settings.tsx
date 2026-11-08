import { useContext, useEffect, useRef, useState, type RefObject } from "react";
import { AppState, Linking, Pressable, StyleSheet, Switch, View } from "react-native";
import {
  ACCOUNT_UNDO_DAYS,
  authEmailSchema,
  changeEmailResponseSchema,
  deleteAccountResponseSchema,
  displayNameSchema,
  dpdpExportSchema,
  GYM_COMMENTS_CHANNEL,
  GYM_MESSAGES_CHANNEL,
  GYM_PLACES_CHANNEL,
  TRAINING_PROGRESS_CHANNEL,
  TRAINING_REMINDERS_CHANNEL,
  myOrgsResponseSchema,
  onboardingResponseSchema,
  orgWords,
  sendCodeResponseSchema,
  userProfileResponseSchema,
  type MyOrgsResponse,
  type Units,
  type UserProfile,
} from "@app/shared";
import * as Sharing from "expo-sharing";
import { Button } from "../look/Button";
import { Avatar, Badge, Card } from "../look/Card";
import { Segments } from "../look/Choice";
import { colours, sizes } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon, type IconName } from "../look/Icon";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { usePhoneAllows } from "../notifications/Notifications";
import { channelsOff } from "../notifications/phone";
import { exportFileFor, forgetPersonFiles } from "../session/personFiles";
import { SIGNED_OUT_NOTES } from "../session/session";
import { useSession } from "../session/SessionProvider";
import { HideMe, useHideMe } from "./gym/hideMe";
import { CanSee } from "./Invitation";
import { tabWord } from "./placesHeading";
import { SAFE_MODE_LINE } from "./remindersView";
import { TrainingReminders } from "./TrainingReminders";
import { Setup, accountUnits } from "./setup/Setup";
import { UNIT_OPTIONS } from "./setup/SetupScreens";
import { setupPath } from "./setup/useSetupAnswers";
import { RobotCheck } from "./RobotCheck";
import { NO_ANSWER } from "./SignIn";
import { legalUrl, type LegalPage } from "./legalLinks";
import { CopyContext } from "./ThisCopy";

// Settings on the phone (ROADMAP Stage 5 item 19a): the browser's Profile name, Units, Hide me, what
// each place can see and Account, opened over Me. Each part saves on its own and says so in its own
// place; every answer shown is the server's. Setup's answers are under Me's "Your plan", not here again.
// Your data (19b): the server's export handed to the phone's Share box, and Delete account with a
// code emailed to the account's own address; the undo is the link in the email that follows.
// A gym's own owner deletes their account on the website where they manage the gym (19b-ii; Kd,
// 2026-11-04): their box says so and opens the console's Your account page in the browser.
// Notifications (19d): one switch for each kind the app sends, saved on the account at once; off, the
// server sends that kind to none of the person's phones. Android's own switch for the app is read too.

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

export type PushSwitch = "pushGymMessages" | "pushPlaces" | "pushComments" | "pushStreak" | "pushBadges" | "pushSummary";
type PushNow = Pick<UserProfile, PushSwitch>;
type Push = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; now: PushNow };

/** The three switches, named as the phone's own settings name the app's notification channels. Every
 *  word fits each kind of place (a gym, a studio, a trainer, a clinic); the place itself is named by
 *  `messagesFrom`. */
export const PUSH_SWITCHES: readonly { key: PushSwitch; channel: string; label: string; on: string; off: string }[] = [
  { key: "pushGymMessages", channel: GYM_MESSAGES_CHANNEL.id, label: "Messages", on: "From the places you belong to.", off: "Off. They still arrive in each Inbox." },
  { key: "pushPlaces", channel: GYM_PLACES_CHANNEL.id, label: "Classes and events", on: "A place for you, or a free place from the waitlist.", off: "Off. Check Classes and Events for places." },
  { key: "pushComments", channel: GYM_COMMENTS_CHANNEL.id, label: "Comments", on: "On your posts, and replies to your comments.", off: "Off. New comments still show on Updates." },
];

/** The three the app decides by itself (19e-ii), under Your training for everyone. */
export const PROGRESS_SWITCHES: readonly { key: PushSwitch; channel: string; label: string; on: string; off: string }[] = [
  { key: "pushStreak", channel: TRAINING_PROGRESS_CHANNEL.id, label: "Streak reminder", on: "At 7 PM, on a day you haven’t trained yet.", off: "Off." },
  { key: "pushBadges", channel: TRAINING_PROGRESS_CHANNEL.id, label: "Badges", on: "When you earn a new badge.", off: "Off. New badges still show in Achievements." },
  { key: "pushSummary", channel: TRAINING_PROGRESS_CHANNEL.id, label: "Sunday summary", on: "Your week, on Sunday at 6 PM.", off: "Off." },
];
export const PROGRESS_FOOT = "At most one of these a day, and never at night.";

const pushOf = (user: UserProfile): PushNow => ({
  pushGymMessages: user.pushGymMessages,
  pushPlaces: user.pushPlaces,
  pushComments: user.pushComments,
  pushStreak: user.pushStreak,
  pushBadges: user.pushBadges,
  pushSummary: user.pushSummary,
});
type Place = MyOrgsResponse["orgs"][number];

function SettingsBody({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const [since, setSince] = useState<string | null>(null);
  // Each name, units or switch press counts here, so a read begun before it never puts the old answer back.
  const saves = useRef(0);
  const [push, setPush] = useState<Push>({ kind: "loading" });
  const [pushTries, setPushTries] = useState(0);
  useEffect(() => {
    const run = { live: true };
    const read = () => {
      const at = saves.current;
      void session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema).then((answer) => {
        if (!run.live) return;
        if (answer.kind !== "ok") {
          // A failed read keeps what was shown.
          setPush((was) => (was.kind === "ok" ? was : { kind: "failed" }));
          return;
        }
        setSince(memberSinceText(answer.data.user.createdAt));
        if (saves.current !== at) return;
        setPush({ kind: "ok", now: pushOf(answer.data.user) });
        // What the server holds now, as another device may have changed it since this phone last heard.
        const { email, displayName, units } = answer.data.user;
        void (email === null ? session.keepName(displayName) : session.keepEmail(email, displayName)).then(() => session.keepUnits(units));
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
  }, [session, pushTries]);
  const [places, setPlaces] = useState<Places>({ kind: "loading" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    const run = { live: true };
    const read = (again: boolean) => {
      void session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema).then((answer) => {
        if (!run.live) return;
        if (answer.kind === "ok") setPlaces({ kind: "ok", orgs: answer.data.orgs });
        // Read again on coming back, a failure keeps what was shown.
        else if (!again) setPlaces({ kind: "failed" });
      });
    };
    read(false);
    // Back from the browser, where an owner may have asked someone to take their gym over.
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") read(true);
    });
    return () => {
      run.live = false;
      back.remove();
    };
  }, [session, tries]);
  const memberOf: Places = places.kind === "ok" ? { kind: "ok", orgs: places.orgs.filter((org) => org.isMember) } : places;
  return (
    <View testID="settings-page" style={styles.page}>
      <Profile since={since} />
      <NamePart saves={saves} />
      <UnitsPart saves={saves} />
      <NotificationsPart push={push} setPush={setPush} saves={saves} places={memberOf} onAgain={() => { setPush({ kind: "loading" }); setPushTries((n) => n + 1); }} />
      <BoardsPart belongs={memberOf.kind === "ok" && memberOf.orgs.length > 0} />
      <PlacesPart places={memberOf} onAgain={() => { setTries((n) => n + 1); }} />
      <AccountPart onClose={onClose} saves={saves} />
      <DataPart places={places} onStale={() => { setTries((n) => n + 1); }} />
      <LegalPart />
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

/** The Messages line: the one place by its name, else every place the person belongs to. */
export function messagesFrom(places: Places): string | null {
  if (places.kind !== "ok") return null;
  const [only, ...more] = places.orgs;
  return only !== undefined && more.length === 0 ? `From ${only.name}.` : null;
}

// A place's switches show for somebody who belongs to one; Your training's reminders (19e-i) for everyone.
// While the account and the places are still being read, nothing is drawn.
function NotificationsPart(props: { push: Push; setPush: (push: Push) => void; saves: RefObject<number>; places: Places; onAgain: () => void }) {
  const { push, setPush, saves, places, onAgain } = props;
  const { session } = useSession();
  const phone = usePhoneAllows();
  const [busy, setBusy] = useState<PushSwitch | null>(null);
  // What a failed save said, and whether under the place's switches or Your training's.
  const [said, setSaid] = useState<{ words: string; progress: boolean } | null>(null);
  const { readAgain } = phone;
  // Each kind can also be turned off in the phone's own settings, apart from the app's switch.
  const [offOnPhone, setOffOnPhone] = useState<readonly string[]>([]);
  // Back from the phone's own settings, where the person may have turned notifications on again.
  useEffect(() => {
    const run = { live: true };
    const readChannels = () => {
      void channelsOff([...PUSH_SWITCHES.map((row) => row.channel), TRAINING_REMINDERS_CHANNEL.id, TRAINING_PROGRESS_CHANNEL.id]).then((off) => {
        if (run.live) setOffOnPhone(off);
      });
    };
    readChannels();
    const back = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void readAgain();
      readChannels();
    });
    return () => {
      run.live = false;
      back.remove();
    };
  }, [readAgain]);
  if (push.kind === "loading" || places.kind === "loading") return null;
  const belongs = places.kind === "failed" || places.orgs.length > 0;
  // The same word as the person's tab: "Gym", "Studio", "Trainer", "Clinic", or "Places".
  const heading = places.kind === "ok" ? tabWord(places.orgs.map((org) => org.orgType)) : null;
  const from = messagesFrom(places);
  const flip = async (key: PushSwitch, on: boolean) => {
    if (busy !== null || push.kind !== "ok") return;
    saves.current += 1;
    setBusy(key);
    setSaid(null);
    const answer = await session.signedIn({ method: "PATCH", path: "/v1/users/me", body: { [key]: on } }, userProfileResponseSchema);
    // Counted again when it ends, so a read that began during the save never puts back what it read.
    saves.current += 1;
    const progress = PROGRESS_SWITCHES.some((row) => row.key === key);
    if (answer.kind === "ok") {
      setPush({ kind: "ok", now: pushOf(answer.data.user) });
      // Switched on with Android not yet asked: it is asked now, so what was switched on can show.
      if (on && progress && phone.allowed === "ask") void phone.turnOn();
    } else setSaid({ words: answer.kind === "refused" ? answer.message : NO_ANSWER, progress });
    setBusy(null);
  };
  // One switch, its line, and a word when the phone's own settings turned its kind off.
  // `lined`: under Your training, drawn as its reminders are, a line above each.
  const switchRow = (row: (typeof PUSH_SWITCHES)[number], heldLine?: string, lined = false) => {
    if (push.kind !== "ok") return null;
      const on = push.now[row.key];
      const line = on && heldLine !== undefined ? heldLine : on ? (row.key === "pushGymMessages" && from !== null ? from : row.on) : row.off;
      const phoneOff = on && phone.allowed === "yes" && offOnPhone.includes(row.channel);
      return (
        <View key={row.key} style={[styles.email, lined ? styles.lined : null]}>
          <View style={styles.between}>
            <View style={styles.grow}>
              <Txt kind="h3">{row.label}</Txt>
              <Txt kind="small">{line}</Txt>
            </View>
            <Switch
              testID={`switch-${row.key}`}
              accessibilityLabel={`${row.label} notifications`}
              value={on}
              disabled={busy !== null}
              onValueChange={(value) => void flip(row.key, value)}
              trackColor={{ false: colours.lineStrong, true: colours.orange }}
              thumbColor={colours.text}
            />
          </View>
          {phoneOff ? (
            <View style={styles.phoneOff}>
              <Txt kind="small" colour="badText">
                Off on this phone.
              </Txt>
              <Button label="Open phone settings" kind="link" say={`Open phone settings for ${row.label}`} onPress={() => void Linking.openSettings()} />
            </View>
          ) : null}
        </View>
      );
  };
  return (
    <Part title="Notifications" icon="bell">
      {phone.allowed === "ask" || phone.allowed === "no" ? (
        <View style={styles.phoneOff}>
          <Txt kind="small" colour="badText">
            Notifications are off on this phone.
          </Txt>
          {phone.allowed === "ask" ? (
            <Button label="Turn on" kind="link" say="Turn on notifications" onPress={() => void phone.turnOn()} />
          ) : (
            <Button label="Open phone settings" kind="link" onPress={() => void Linking.openSettings()} />
          )}
        </View>
      ) : null}
      {!belongs ? null : push.kind === "failed" ? (
        <View style={styles.between}>
          <Txt kind="small" style={styles.grow}>
            Couldn’t load your notifications.
          </Txt>
          <Button label="Try again" kind="link" say="Try notifications again" onPress={onAgain} />
        </View>
      ) : (
        <>
          {heading === null ? null : <Txt kind="eyebrow">{heading}</Txt>}
          {PUSH_SWITCHES.map((row) => switchRow(row))}
        </>
      )}
      <Said words={said !== null && !said.progress ? said.words : null} bad />
      <TrainingReminders
        phoneAllowed={phone.allowed === "yes"}
        offOnPhone={offOnPhone.includes(TRAINING_REMINDERS_CHANNEL.id)}
        onTurnedOn={() => {
          if (phone.allowed === "ask") void phone.turnOn();
        }}
        after={(safeMode) =>
          push.kind === "failed" ? (
            belongs ? null : (
              <View style={styles.between}>
                <Txt kind="small" style={styles.grow}>
                  Couldn’t load your notifications.
                </Txt>
                <Button label="Try again" kind="link" say="Try notifications again" onPress={onAgain} />
              </View>
            )
          ) : (
            <>
              {/* Safe mode: the streak reminder waits, as the workout reminder does. */}
              {PROGRESS_SWITCHES.map((row) => switchRow(row, row.key === "pushStreak" && safeMode === true ? SAFE_MODE_LINE : undefined, true))}
              <Said words={said?.progress === true ? said.words : null} bad />
              <Txt kind="tiny" style={styles.foot}>
                {PROGRESS_FOOT}
              </Txt>
            </>
          )
        }
      />
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

/** Change email (19c), with what happened said under it. The address itself is at the page's head. */
function EmailLine({ saves }: { saves: RefObject<number> }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <View style={styles.email}>
      <Button label="Change email" kind="link" icon="mail" style={styles.start} onPress={() => { setSaid(null); setOpen(true); }} />
      <Said words={said} bad={false} />
      <ChangeEmail
        open={open}
        saves={saves}
        onClose={() => { setOpen(false); }}
        onChanged={(email) => {
          setOpen(false);
          setSaid(changedEmailLine(email));
        }}
      />
    </View>
  );
}

/** Said under the address once the account has moved. */
export function changedEmailLine(email: string): string {
  return `Your email is now ${email}. Sign in with it from now on.`;
}

/** Change email (19c; RULINGS 2026-09-23, E): the new address, then the code emailed to it. */
function ChangeEmail({ open, saves, onClose, onChanged }: { open: boolean; saves: RefObject<number>; onClose: () => void; onChanged: (email: string) => void }) {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  /** The server asked for the robot check before it sends a code (past the person's third of the day):
   *  its key, its sentence, and the ask it stands in front of. */
  const [robot, setRobot] = useState<{ key: string; line: string; to: string; again: boolean } | null>(null);
  const [step, setStep] = useState<"address" | "code">("address");
  const [typed, setTyped] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // Each opening starts at its first step, with nothing typed.
  useEffect(() => {
    if (!open) return;
    setStep("address");
    setTyped("");
    setSentTo("");
    setCode("");
    setProblem(null);
    setResent(false);
  }, [open]);
  const address = authEmailSchema.safeParse(typed);
  // Said once Email me a code is pressed, never while the address is still being typed.
  const ask = () => {
    if (address.success) void sendCode(address.data, false);
    else setProblem(typed.trim() === "" ? "Enter your new email address." : "Enter a valid email address.");
  };
  const sendCode = async (to: string, again: boolean, robotToken?: string) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    const body = robotToken === undefined ? { email: to } : { email: to, robotToken };
    const answer = await session.signedIn({ method: "POST", path: "/v1/users/me/email-code", body }, sendCodeResponseSchema);
    setBusy(false);
    if (answer.kind === "refused" && answer.robotCheckKey !== null && (answer.error === "robot_check" || answer.error === "robot_failed")) {
      setRobot({ key: answer.robotCheckKey, line: answer.message, to, again });
      return;
    }
    if (answer.kind === "ok") {
      setSentTo(to);
      setCode("");
      setResent(again);
      setStep("code");
    } else {
      setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
    }
  };
  const change = async () => {
    if (busy || code.length !== 6) return;
    saves.current += 1;
    setBusy(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "POST", path: "/v1/users/me/email", body: { email: sentTo, code } }, changeEmailResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") {
      await session.keepEmail(answer.data.email, answer.data.displayName);
      onChanged(answer.data.email);
      return;
    }
    if (answer.kind === "refused") setCode("");
    // The address is taken, or the account moved elsewhere meanwhile: no code for it can help, so back
    // to the address, filled in, with the server's sentence under it.
    if (answer.kind === "refused" && (answer.error === "email_in_use" || answer.error === "email_changed")) {
      setTyped(sentTo);
      setStep("address");
    }
    setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
  };
  /** The check passed: the ask it stood in front of goes with its answer. */
  const robotPassed = (token: string) => {
    const asked = robot;
    setRobot(null);
    if (asked !== null) void sendCode(asked.to, asked.again, token);
  };
  /** Closed before it passed: the box says why, and the same button asks again. */
  const robotClosed = () => {
    if (robot !== null) setProblem(robot.line);
    setRobot(null);
  };
  return (
    <>
    <RobotCheck siteKey={open ? (robot?.key ?? null) : null} apiUrl={apiUrl} line={robot?.line ?? ""} onToken={robotPassed} onClose={robotClosed} />
    <Sheet open={open && robot === null} title="Change email" onClose={onClose}>
      <View style={styles.ask}>
        {step === "address" ? (
          <>
            <Field
              key="email"
              label="New email address"
              bare
              value={typed}
              onChange={(value) => {
                setTyped(value);
                setProblem(null);
              }}
              placeholder="New email address"
              keyboard="email-address"
              fills="email"
              maxLength={254}
              ready
              onDone={ask}
            />
            {problem === null ? null : <Txt kind="small" colour="badText">{problem}</Txt>}
            <View style={styles.stack}>
              <Button label="Email me a code" wide busy={busy} onPress={ask} />
              <Button label="Cancel" kind="plain" wide onPress={onClose} />
            </View>
          </>
        ) : (
          <>
            {/* An address is long and is never cut: it has the whole line. */}
            <View>
              <Txt>We emailed a 6-digit code to</Txt>
              <Txt kind="strong">{sentTo}</Txt>
            </View>
            <Field
              key="code"
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
              onDone={() => void change()}
            />
            {problem === null ? null : <Txt kind="small" colour="badText">{problem}</Txt>}
            <View style={styles.stack}>
              <Button label="Confirm" wide busy={busy} disabled={code.length !== 6} onPress={() => void change()} />
              <Button label="Cancel" kind="plain" wide onPress={onClose} />
            </View>
            <Button label="Email me a new code" kind="link" busy={busy} style={styles.start} onPress={() => void sendCode(sentTo, true)} />
            {resent ? <Txt kind="small" colour="goodText">We emailed you a new code.</Txt> : null}
          </>
        )}
      </View>
    </Sheet>
    </>
  );
}

function AccountPart({ onClose, saves }: { onClose: () => void; saves: RefObject<number> }) {
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
      <EmailLine saves={saves} />
      <View style={styles.rule} />
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

/** What the sign-in screen says once the account is deleted: the undo link only where one was sent;
 *  "maybe" where another request deleted it at the same instant and sends its own. */
export function deletedNote(emailSent: boolean | "maybe", now: Date): string {
  const day = deletesOnText(now);
  if (emailSent === "maybe") return `Your account will be deleted on ${day}. To keep it, look for our email and open its link before then.`;
  return emailSent
    ? `Your account will be deleted on ${day}. To keep it, open the link we emailed you before then.`
    : `Your account will be deleted on ${day}.`;
}

export interface OwnedPlace {
  name: string;
  /** The website's Your account page, where an owner deletes their account. */
  url: string;
  orgType: Place["orgType"];
}

/** The places a deleted account leaves at once, and the open gyms it owns: an owner deletes their account
 *  on the website where they manage the gym (19b-ii; Kd, 2026-11-04), the server's own answer, sent to a
 *  gym's own owner alone. A co-owner, staff and members all leave (users/repo.ts softDeleteUser). */
export function placesOnDelete(orgs: readonly Place[]): { leaves: string[]; owns: OwnedPlace[] } {
  const ownsIt = (org: Place) => org.staffRole === "owner" && org.coOwner !== true;
  const owns: OwnedPlace[] = [];
  for (const org of orgs) {
    if (org.handOver !== undefined) owns.push({ name: org.name, url: org.handOver.url, orgType: org.orgType });
  }
  return {
    leaves: orgs.filter((org) => !ownsIt(org) && (org.isMember || org.staffRole !== null)).map((org) => org.name),
    owns,
  };
}

/** "You own Iron House. Delete your account on our website, where you manage your gym." */
export function ownerDeletesOnWebLine(owns: readonly OwnedPlace[]): string {
  const first = owns[0];
  const where = owns.length === 1 && first !== undefined ? `your ${orgWords(first.orgType).it}` : "them";
  return `You own ${namesText(owns.map((place) => place.name))}. Delete your account on our website, where you manage ${where}.`;
}



function DataPart({ places, onStale }: { places: Places; onStale: () => void }) {
  const { session, state } = useSession();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ words: string; bad: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const me = state.kind === "in" ? state.user.id : null;
  const download = async () => {
    if (busy || me === null) return;
    setSaid(null);
    setBusy(true);
    const answer = await session.signedIn({ method: "GET", path: "/v1/users/me/export", waitMs: 60_000 }, dpdpExportSchema.passthrough());
    // The file is only ever that of the person who asked for it, still signed in.
    if (answer.kind !== "ok" || answer.data.user["id"] !== me || session.state().kind !== "in") {
      setBusy(false);
      setSaid({ words: answer.kind === "refused" ? answer.message : NO_ANSWER, bad: true });
      return;
    }
    const name = `aihomegym-export-${answer.data.exportedAt.slice(0, 10)}.json`;
    // The phone's own Share box takes the file (Files, Drive, email): a folder box sends the app to the
    // back, where a phone short of memory closes it and the file is lost (Kd, 2026-11-04).
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setSaid({ words: "This phone can’t share files.", bad: true });
      } else {
        const file = exportFileFor(me, name, JSON.stringify(answer.data, null, 2));
        await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save your data" });
        setSaid({ words: `Your file is ${name}.`, bad: false });
      }
    } catch {
      setSaid({ words: "Couldn’t make the file. Try again.", bad: true });
    }
    setBusy(false);
  };
  return (
    <Part title="Your data" icon="folder">
      <Button label="Download my data" kind="link" icon="download" busy={busy} style={styles.start} onPress={() => void download()} />
      <Said words={said?.words ?? null} bad={said?.bad ?? false} />
      <View style={styles.rule} />
      <Button label="Delete account" kind="dangerLink" icon="trash" style={styles.start} onPress={() => { setAsking(true); }} />
      <DeleteAsk open={asking} places={places} onStale={onStale} onClose={() => { setAsking(false); }} />
    </Part>
  );
}

/** Our Privacy Policy and Terms of Use (21b-i), on the website, in the phone's browser. */
function LegalPart() {
  const webUrl = useContext(CopyContext).extra?.webUrl;
  const [failed, setFailed] = useState(false);
  const open = (page: LegalPage) => {
    setFailed(false);
    const url = legalUrl(webUrl, page);
    if (url === null) { setFailed(true); return; }
    Linking.openURL(url).catch(() => { setFailed(true); });
  };
  return (
    <Part title="Privacy and terms" icon="info">
      <Button label="Privacy Policy" kind="link" icon="shield" style={styles.start} onPress={() => { open("privacy"); }} />
      <View style={styles.rule} />
      <Button label="Terms of Use" kind="link" icon="book" style={styles.start} onPress={() => { open("terms"); }} />
      <Said words={failed ? "Couldn’t open the page. Try again." : null} bad />
    </Part>
  );
}

function DeleteAsk({ open, places, onStale, onClose }: { open: boolean; places: Places; onStale: () => void; onClose: () => void }) {
  const { session, state } = useSession();
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [noBrowser, setNoBrowser] = useState(false);
  // Each opening starts at its first step, with nothing typed.
  useEffect(() => {
    if (!open) return;
    setStep("ask");
    setCode("");
    setProblem(null);
    setResent(false);
    setNoBrowser(false);
  }, [open]);
  if (state.kind !== "in") return null;
  const me = state.user;
  const { leaves, owns } = places.kind === "ok" ? placesOnDelete(places.orgs) : { leaves: [], owns: [] };
  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    const answer = await session.signedIn({ method: "POST", path: "/v1/users/me/delete-code" }, sendCodeResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") {
      setCode("");
      setResent(step === "code");
      setStep("code");
    } else {
      setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
      // The server knows of a gym they own that this box was not shown: read their places again.
      if (answer.kind === "refused" && answer.error === "owns_gym") onStale();
    }
  };
  const remove = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "DELETE", path: "/v1/users/me", body: { code } }, deleteAccountResponseSchema);
    if (answer.kind === "ok") {
      await forgetMe(answer.data.deletedByAnother === true ? "maybe" : answer.data.emailSent);
      return;
    }
    // The server replies only once the undo email is sent, so its reply can be lost after the account is
    // gone. Only a DELETE that went out and came back with nothing is asked about once more; a sign-in the
    // server then turns away as no longer valid means deleted. Signed out already, or signed in on another
    // phone, it was turned away before it was read: nothing is forgotten.
    if (answer.kind === "no_answer" && session.state().kind === "in") {
      await session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema);
      const now = session.state();
      if (now.kind === "out" && now.note === SIGNED_OUT_NOTES.ended) {
        // Its undo email was most likely sent before the reply was lost.
        await forgetMe("maybe");
        return;
      }
    }
    setBusy(false);
    if (answer.kind === "refused") setCode("");
    setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
    if (answer.kind === "refused" && answer.error === "owns_gym") {
      setStep("ask");
      onStale();
    }
  };
  // Nothing of the person stays: their waiting meals and drafts, then the sign-in and its pass keys;
  // the files again once nothing of theirs is open, for a write that was already on its way.
  const forgetMe = async (emailSent: boolean | "maybe") => {
    forgetPersonFiles(me.id);
    await session.accountDeleted(deletedNote(emailSent, new Date()));
    forgetPersonFiles(me.id);
  };
  return (
    <Sheet open={open} title="Delete account?" onClose={onClose}>
      <View style={styles.ask}>
        {step === "ask" && owns[0] !== undefined ? (
          <>
            <Txt>{ownerDeletesOnWebLine(owns)}</Txt>
            <View style={styles.stack}>
              <Button
                label="Open the website"
                wide
                onPress={() => {
                  const to = owns[0]?.url;
                  if (to === undefined) return;
                  setNoBrowser(false);
                  void Linking.openURL(to).catch(() => {
                    setNoBrowser(true);
                  });
                }}
              />
              <Button label="Cancel" kind="plain" wide onPress={onClose} />
            </View>
            {noBrowser ? <Txt kind="small" colour="badText">Couldn’t open the browser.</Txt> : null}
          </>
        ) : step === "ask" ? (
          <>
            <Txt>
              Your workouts, meals, goals and progress are deleted for good after {String(ACCOUNT_UNDO_DAYS)} days. Until then, the link we email you brings them back.
            </Txt>
            {leaves.length > 0 ? <Txt>You leave {namesText(leaves)} today. To come back later, ask them to add you again.</Txt> : null}
            {places.kind === "failed" ? <Txt>You leave the places you’re a member of today.</Txt> : null}
            {problem === null ? null : <Txt kind="small" colour="badText">{problem}</Txt>}
            <View style={styles.stack}>
              <Button label="Email me a code" kind="danger" wide busy={busy} onPress={() => void sendCode()} />
              <Button label="Cancel" kind="plain" wide onPress={onClose} />
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
            <View style={styles.stack}>
              <Button label="Delete" kind="danger" icon="trash" wide busy={busy} disabled={code.length !== 6} onPress={() => void remove()} />
              <Button label="Cancel" kind="plain" wide onPress={onClose} />
            </View>
            <Button label="Email me a new code" kind="link" busy={busy} style={styles.start} onPress={() => void sendCode()} />
            {resent ? <Txt kind="small" colour="goodText">We emailed you a new code.</Txt> : null}
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
  email: { gap: 6 },
  lined: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colours.line },
  foot: { marginTop: 4 },
  ask: { gap: 14 },
  two: { flexDirection: "row", gap: 10 },
  // One above the other, the whole width: a box's words never spill out of its buttons on a small phone or in large text.
  stack: { gap: 10 },
  half: { flex: 1 },
  // The words, then their button under them: a long label never spills out on a small phone.
  phoneOff: { gap: 6, alignItems: "flex-start" },
});
