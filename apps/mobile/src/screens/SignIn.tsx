import { useContext, useEffect, useRef, useState } from "react";
import { Image, Keyboard, LayoutAnimation, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SIGN_IN_CODE_RULES, authEmailSchema } from "@app/shared";
import { Button } from "../look/Button";
import { Card } from "../look/Card";
import { CodeBoxes } from "../look/CodeBoxes";
import { colours, shadows, signInGradient, sizes } from "../look/colours";
import { Field } from "../look/Field";
import { GoogleMark } from "../look/GoogleMark";
import { Icon } from "../look/Icon";
import { pictures } from "../look/pictures";
import { Txt } from "../look/Txt";
import { Wordmark } from "../look/Wordmark";
import type { Answer } from "../session/calls";
import { forgetWaiting, keepWaiting, readWaiting } from "../session/codeWaiting";
import type { KeyStore } from "../session/session";
import { useSession } from "../session/SessionProvider";
import { RobotCheck } from "./RobotCheck";
import { CopyContext } from "./ThisCopy";

// "Get started" (12e, Kd's drawing of 2026-11-08): his poster over the whole page, the app's name on it,
// and the form in one orange box by the thumb (the browser asks the same, apps/web/src/pages/Login.jsx). Sign-up and sign-in are
// the same act: an email, the 6-digit code, and a new address gets its account on the spot.
// Or Google: its own box from the bottom, and the server checks what Google answered.

export const NO_ANSWER = "Can’t connect. Check your internet and try again.";
export const GOOGLE_FAILED = "Google sign-in didn’t work. Try again, or sign in with your email.";
/** The resend gap in words, from the number the server enforces. */
const gapWords = (seconds: number) =>
  seconds === 60 ? "a minute" : seconds % 60 === 0 ? `${String(seconds / 60)} minutes` : `${String(seconds)} seconds`;
/** What a "too soon" refusal may claim (apps/web/src/pages/Login.jsx): that a code was asked for
 *  inside the gap. Never that one was sent just now, or that it is still good: it may be the
 *  code that signed this person in a moment ago. */
const TOO_SOON = {
  asked: `You asked for a code less than ${gapWords(SIGN_IN_CODE_RULES.resendAfterSeconds)} ago for`,
  wait: "Enter it, or resend when the countdown ends.",
  /** The countdown has run out, so "less than a minute ago" would now be false. */
  have: "Enter the code you have for",
  resend: "Or resend for a new one.",
};

/** The poster's own size, and how far down it its people end (the yoga mat's foot), as a share of its height. */
const POSTER = { width: 720, height: 1336, peopleFoot: 0.47 };
/** The room above the people taken by the app's name and the gap under it. */
const TOP_ROOM = 52;

/** The server's sentence is written for people; a reply with none gets one plain line. */
function wordsFor(answer: Exclude<Answer<unknown>, { kind: "ok" }>, fallback: string): string {
  if (answer.kind === "no_answer") return NO_ANSWER;
  return answer.message === "" ? fallback : answer.message;
}

/** `waiting`: where the code step is kept while the person fetches their code, so a reopen after Android closed the
 *  app comes back to it. */
export function SignInScreen({ note, waiting }: { note: string | null; waiting: KeyStore }) {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [step, setStep] = useState<"email" | "code">("email");
  const [typed, setTyped] = useState("");
  /** The address the code was asked for, as the server reads it. */
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  /** Google's sign-in is away, and what it last said, under its own button. */
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleProblem, setGoogleProblem] = useState("");
  /** How the code step was reached: a code went out, or the server refused inside its gap and none did. */
  const [arrival, setArrival] = useState<"sent" | "too-soon">("sent");
  /** A code whose check got no answer: the server may have taken it and its reply been lost. */
  const [unanswered, setUnanswered] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  /** The keyboard is up: the box rises over the people, so it and its button stay in view. */
  const [typing, setTyping] = useState(false);
  /** The server asked for the robot check before it sends a code: its key, its sentence, and the
   *  press that the check's answer finishes. */
  const [robot, setRobot] = useState<{ key: string; line: string; press: "email" | "resend" } | null>(null);

  useEffect(() => {
    const show = (up: boolean) => () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTyping(up);
    };
    const shown = Keyboard.addListener("keyboardDidShow", show(true));
    const hidden = Keyboard.addListener("keyboardDidHide", show(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (step !== "code" || resendAt <= now) return undefined;
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [step, resendAt, now]);

  const secondsToResend = Math.max(0, Math.ceil((resendAt - now) / 1000));

  /** When Resend may next be pressed, as the last answer set it: kept with the code step. */
  const resendAtNow = useRef(0);
  const waitFor = (seconds: number) => {
    resendAtNow.current = Date.now() + seconds * 1000;
    setResendAt(resendAtNow.current);
    setNow(Date.now());
  };

  /** Reading whether a code step was left open: until then the box waits, so the email step never flashes first. */
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let live = true;
    void readWaiting(waiting, Date.now()).then((left) => {
      if (!live) return;
      if (left !== null) {
        setAddress(left.email);
        setTyped(left.email);
        setArrival(left.arrival);
        setResendAt(left.resendAt);
        setNow(Date.now());
        setStep("code");
      }
      setRestoring(false);
    });
    return () => {
      live = false;
    };
  }, [waiting]);

  /** `too-soon`: a code was asked for inside the server's gap, so none went out; the code box opens either way. */
  async function askForCode(to: string, press: "email" | "resend", robotToken?: string): Promise<"sent" | "too-soon" | null> {
    setBusy(true);
    setProblem("");
    setSaid("");
    try {
      const answer = await session.sendCode(to, robotToken);
      if (answer.kind === "ok") {
        waitFor(answer.data.resendAfterSeconds);
        return "sent";
      }
      if (answer.kind === "refused" && answer.error === "code_too_soon") {
        waitFor(answer.retryAfterSeconds ?? SIGN_IN_CODE_RULES.resendAfterSeconds);
        return "too-soon";
      }
      if (answer.kind === "refused" && answer.robotCheckKey !== null && (answer.error === "robot_check" || answer.error === "robot_failed")) {
        setRobot({ key: answer.robotCheckKey, line: answer.message, press });
        return null;
      }
      setProblem(wordsFor(answer, "We couldn’t send the code. Try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function continueWithEmail(robotToken?: string) {
    if (busy) return;
    // The other way in is being tried: what Google last said no longer stands.
    setGoogleProblem("");
    if (typed.trim() === "") {
      setProblem("Enter your email address.");
      return;
    }
    const parsed = authEmailSchema.safeParse(typed);
    if (!parsed.success) {
      setProblem("Enter a valid email address.");
      return;
    }
    const arrived = await askForCode(parsed.data, "email", robotToken);
    if (arrived !== null) {
      setAddress(parsed.data);
      setCode("");
      setArrival(arrived);
      setStep("code");
      void keepStep(parsed.data, arrived);
    }
  }

  /** Keeps the code step for a reopen. Refused as too soon, no code went: the step lasts only as long as the earlier
   *  code, so it keeps that code's time where it was kept, or the earliest that code can have gone. */
  async function keepStep(email: string, arrived: "sent" | "too-soon") {
    const now = Date.now();
    let sentAt = now;
    if (arrived === "too-soon") {
      const kept = await readWaiting(waiting, now);
      sentAt = kept !== null && kept.email === email ? kept.sentAt : now - SIGN_IN_CODE_RULES.resendAfterSeconds * 1000;
    }
    await keepWaiting(waiting, { email, sentAt, resendAt: resendAtNow.current, arrival: arrived });
  }

  async function resend(robotToken?: string) {
    if (busy || secondsToResend > 0) return;
    if ((await askForCode(address, "resend", robotToken)) === "sent") {
      setCode("");
      setArrival("sent");
      setSaid("New code sent.");
      void keepWaiting(waiting, { email: address, sentAt: Date.now(), resendAt: resendAtNow.current, arrival: "sent" });
    }
  }

  async function continueWithCode() {
    if (busy) return;
    if (code.length !== 6) {
      setProblem("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setProblem("");
    setSaid("");
    const answer = await session.verifyCode(address, code);
    // Signed in: the tabs take this screen's place, and the kept code step goes.
    if (answer.kind === "ok") {
      void forgetWaiting(waiting);
      return;
    }
    if (answer.kind === "no_answer") setUnanswered(code);
    // The same digits refused after a check with no answer: that check may have spent them at the
    // server, or they were wrong all along. Either way a new code is the way on, and the line says so.
    const afterNoAnswer = answer.kind === "refused" && answer.error === "invalid_code" && code === unanswered;
    setProblem(afterNoAnswer ? "That code didn’t work. Resend code." : wordsFor(answer, "That code didn’t work. Try again."));
    if (answer.kind === "refused") setCode("");
    setBusy(false);
  }

  /** The check passed: the press it stood in front of is finished with its answer. */
  const robotPassed = (token: string) => {
    const press = robot?.press;
    setRobot(null);
    if (press === "email") void continueWithEmail(token);
    else if (press === "resend") void resend(token);
  };

  /** Closed before it passed: the page says what is still to do, and the same button asks again. */
  const robotClosed = () => {
    if (robot !== null) setProblem(robot.line);
    setRobot(null);
  };

  async function continueWithGoogle() {
    if (busy || googleBusy) return;
    setGoogleBusy(true);
    setGoogleProblem("");
    setProblem("");
    const answer = await session.signInWithGoogle();
    // Signed in: the tabs take this screen's place, and any kept code step goes.
    if (answer.kind === "ok") {
      void forgetWaiting(waiting);
      return;
    }
    // Closed by the person: nothing to say, and the page is as it was.
    if (answer.kind === "failed") setGoogleProblem(GOOGLE_FAILED);
    else if (answer.kind !== "closed") setGoogleProblem(wordsFor(answer, GOOGLE_FAILED));
    setGoogleBusy(false);
  }

  const changeEmail = () => {
    void forgetWaiting(waiting);
    setStep("email");
    setGoogleProblem("");
    setCode("");
    setProblem("");
    setSaid("");
  };
  // The poster covers the page from its top, cut only at its sides; where the screen is wider than the poster's
  // shape (an opened folding phone) it is drawn to the width and runs on under the box.
  const scale = Math.max(width / POSTER.width, (height + insets.top + insets.bottom) / POSTER.height);
  const posterWidth = Math.round(POSTER.width * scale);
  const posterHeight = Math.round(POSTER.height * scale);

  return (
    <View style={styles.page}>
      <Image
        testID="sign-in-picture"
        source={pictures.signin}
        resizeMode="cover"
        style={[styles.poster, { width: posterWidth, height: posterHeight, left: Math.round((width - posterWidth) / 2) }]}
        accessible={false}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.fill, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.top}>
          <Wordmark />
        </View>

        {/* The people stay in view above the box; while typing the box rises over them, to the keyboard. */}
        <View style={typing ? styles.typing : { flexGrow: 1, minHeight: Math.max(0, Math.round(posterHeight * POSTER.peopleFoot) - insets.top - TOP_ROOM) }} />

        {restoring ? null : (
          <View style={styles.box}>
            {step === "email" ? (
              <View style={styles.head}>
                <Txt kind="h1">Get started.</Txt>
                <Txt colour="onSignIn">Sign in or create your account</Txt>
              </View>
            ) : arrival === "sent" ? (
              <View style={styles.head}>
                <Txt kind="h1">Check your email.</Txt>
                <Txt colour="onSignIn">Enter the 6-digit code sent to</Txt>
                <Address address={address} />
              </View>
            ) : (
              <View style={styles.head}>
                <Txt kind="h1">Enter your code.</Txt>
                <Txt colour="onSignIn">{secondsToResend > 0 ? TOO_SOON.asked : TOO_SOON.have}</Txt>
                <Address address={address} />
                <Txt colour="onSignIn">{secondsToResend > 0 ? TOO_SOON.wait : TOO_SOON.resend}</Txt>
              </View>
            )}

            {/* Why the person is here again; once they have asked for a code it has been read. */}
            {note === null || step === "code" ? null : (
              <Card style={styles.note}>
                <Icon name="logout" size={16} colour="textSoft" />
                <Txt colour="text" style={styles.noteWords}>
                  {note}
                </Txt>
              </Card>
            )}

            {step === "email" ? (
              <View style={styles.form}>
                <Field
                  key="email"
                  label="Email"
                  bare
                  icon="mail"
                  light
                  value={typed}
                  onChange={(value) => {
                    setTyped(value);
                    setProblem("");
                  }}
                  placeholder="Email address"
                  keyboard="email-address"
                  fills="email"
                  maxLength={254}
                  onDone={() => void continueWithEmail()}
                />
                {problem === "" ? null : <Said tone="bad" words={problem} />}
                <Button label="Continue" kind="dark" wide raised busy={busy} disabled={googleBusy} onPress={() => void continueWithEmail()} />
                <View style={styles.or}>
                  <View style={styles.orLine} />
                  <Txt kind="tiny" colour="onSignIn">
                    or
                  </Txt>
                  <View style={styles.orLine} />
                </View>
                <Button
                  label="Continue with Google"
                  kind="light"
                  wide
                  raised
                  lead={<GoogleMark />}
                  busy={googleBusy}
                  disabled={busy}
                  onPress={() => void continueWithGoogle()}
                />
                {googleProblem === "" ? null : <Said tone="bad" words={googleProblem} />}
              </View>
            ) : (
              <View style={styles.form}>
                <CodeBoxes
                  label="6-digit code"
                  length={6}
                  value={code}
                  onChange={(value) => {
                    setCode(value.replace(/\D/g, "").slice(0, 6));
                    setProblem("");
                  }}
                  onDone={() => void continueWithCode()}
                />
                {problem === "" ? null : <Said tone="bad" words={problem} />}
                <Button label="Continue" kind="dark" wide raised busy={busy} onPress={() => void continueWithCode()} />
                <View style={styles.links}>
                  <Button
                    label={secondsToResend > 0 ? `Resend code in ${String(secondsToResend)}s` : "Resend code"}
                    kind="lightLink"
                    disabled={busy || secondsToResend > 0}
                    onPress={() => void resend()}
                  />
                  <Button label="Use a different email" kind="lightLink" disabled={busy} onPress={changeEmail} />
                </View>
                {said === "" ? null : (
                  <Said tone="good" words={said} />
                )}
              </View>
            )}

            <Txt kind="tiny" colour="onSignIn" style={styles.centre}>
              By continuing you agree to our Terms & Privacy Policy
            </Txt>
          </View>
        )}
      </ScrollView>

      <RobotCheck
        siteKey={robot?.key ?? null}
        apiUrl={apiUrl}
        line={robot?.line ?? ""}
        onToken={robotPassed}
        onClose={robotClosed}
      />
    </View>
  );
}

/** What went wrong, or that a new code went: dark words on a white strip, so they read on the orange box. */
function Said({ tone, words }: { tone: "bad" | "good"; words: string }) {
  return (
    <View style={styles.said}>
      <Txt kind="strong" colour={tone} style={styles.centre}>
        {words}
      </Txt>
    </View>
  );
}

/** The address a code went to, in a pill under the line that names it. */
function Address({ address }: { address: string }) {
  return (
    <View style={styles.address}>
      <Icon name="mail" size={16} colour="onOrange" />
      <Txt kind="strong" numberOfLines={1} style={styles.addressWords}>
        {address}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page, overflow: "hidden" },
  poster: { position: "absolute", top: 0 },
  scroll: { flex: 1 },
  fill: { flexGrow: 1 },
  top: { paddingHorizontal: sizes.edge },
  typing: { height: 12 },
  box: {
    marginHorizontal: 12,
    padding: 16,
    paddingTop: 20,
    gap: 14,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: colours.light,
    backgroundColor: colours.signInFoot,
    experimental_backgroundImage: signInGradient,
    boxShadow: shadows.signInBox,
  },
  head: { gap: 6 },
  address: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 8,
    marginTop: 4,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.onSignInFaint,
    backgroundColor: colours.veil,
  },
  addressWords: { flexShrink: 1 },
  note: { flexDirection: "row", alignItems: "center", gap: 10 },
  noteWords: { flex: 1 },
  form: { gap: 14 },
  or: { flexDirection: "row", alignItems: "center", gap: 12 },
  orLine: { flex: 1, height: 1, backgroundColor: colours.onSignInFaint },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  centre: { textAlign: "center" },
  said: { alignSelf: "stretch", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colours.light },
});
