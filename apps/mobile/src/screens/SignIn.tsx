import { useEffect, useState } from "react";
import { Image, Keyboard, LayoutAnimation, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SIGN_IN_CODE_RULES, authEmailSchema } from "@app/shared";
import { Button } from "../look/Button";
import { Card, Logo } from "../look/Card";
import { colours, pictureFade, sizes } from "../look/colours";
import { Field } from "../look/Field";
import { Icon } from "../look/Icon";
import { pictures } from "../look/pictures";
import { fonts, Txt } from "../look/Txt";
import type { Answer } from "../session/calls";
import { useSession } from "../session/SessionProvider";

// The browser's "Get started" page, fitted to a phone (apps/web/src/pages/Login.jsx): its
// picture fills the top and its form sits under it, by the thumb. Sign-up and sign-in are
// the same act: an email, the 6-digit code, and a new address gets its account on the spot.
// Google's button comes with ROADMAP Stage 5 item 12d.

const NO_ANSWER = "Can’t connect. Check your internet and try again.";
/** The phone's own robot check is item 12b-ii; until then a phone that is asked for it is told to wait. */
const ROBOT_ON_PHONE = "Too many requests from this network. Try again later.";
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

/** The picture's height for its width (docs/design/phone/compact.py makes it 1141 by 1200). */
const PHOTO_TALL = 1200 / 1141;

/** The server's sentence is written for people; a reply with none gets one plain line. */
function wordsFor(answer: Exclude<Answer<unknown>, { kind: "ok" }>, fallback: string): string {
  if (answer.kind === "no_answer") return NO_ANSWER;
  if (answer.error === "robot_check" || answer.error === "robot_failed") return ROBOT_ON_PHONE;
  return answer.message === "" ? fallback : answer.message;
}

export function SignInScreen({ note }: { note: string | null }) {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [step, setStep] = useState<"email" | "code">("email");
  const [typed, setTyped] = useState("");
  /** The address the code was asked for, as the server reads it. */
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  /** How the code step was reached: a code went out, or the server refused inside its gap and none did. */
  const [arrival, setArrival] = useState<"sent" | "too-soon">("sent");
  /** A code whose check got no answer: the server may have taken it and its reply been lost. */
  const [unanswered, setUnanswered] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  /** The keyboard is up: the picture makes way, so the box and its button stay in view. */
  const [typing, setTyping] = useState(false);
  /** The room the form leaves the picture, as the phone laid it out. */
  const [room, setRoom] = useState(0);

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

  const waitFor = (seconds: number) => {
    setResendAt(Date.now() + seconds * 1000);
    setNow(Date.now());
  };

  /** `too-soon`: a code was asked for inside the server's gap, so none went out; the code box opens either way. */
  async function askForCode(to: string): Promise<"sent" | "too-soon" | null> {
    setBusy(true);
    setProblem("");
    setSaid("");
    try {
      const answer = await session.sendCode(to);
      if (answer.kind === "ok") {
        waitFor(answer.data.resendAfterSeconds);
        return "sent";
      }
      if (answer.kind === "refused" && answer.error === "code_too_soon") {
        waitFor(answer.retryAfterSeconds ?? SIGN_IN_CODE_RULES.resendAfterSeconds);
        return "too-soon";
      }
      setProblem(wordsFor(answer, "We couldn’t send the code. Try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function continueWithEmail() {
    if (busy) return;
    if (typed.trim() === "") {
      setProblem("Enter your email address.");
      return;
    }
    const parsed = authEmailSchema.safeParse(typed);
    if (!parsed.success) {
      setProblem("Enter a valid email address.");
      return;
    }
    const arrived = await askForCode(parsed.data);
    if (arrived !== null) {
      setAddress(parsed.data);
      setCode("");
      setArrival(arrived);
      setStep("code");
    }
  }

  async function resend() {
    if (busy || secondsToResend > 0) return;
    if ((await askForCode(address)) === "sent") {
      setCode("");
      setArrival("sent");
      setSaid("New code sent.");
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
    // Signed in: the tabs take this screen's place.
    if (answer.kind === "ok") return;
    if (answer.kind === "no_answer") setUnanswered(code);
    // The same digits refused after a check with no answer: that check signed nobody in here, and spent them.
    const spent = answer.kind === "refused" && answer.error === "invalid_code" && code === unanswered;
    setProblem(spent ? "That code can’t be used again. Resend code." : wordsFor(answer, "That code didn’t work. Try again."));
    if (answer.kind === "refused") setCode("");
    setBusy(false);
  }

  const changeEmail = () => {
    setStep("email");
    setCode("");
    setProblem("");
    setSaid("");
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.fill, { paddingBottom: insets.bottom + 16 }]}
      keyboardShouldPersistTaps="handled"
      bounces={false}
    >
      {typing ? (
        <View style={{ height: insets.top }} />
      ) : (
        <View
          style={styles.hero}
          onLayout={(laid) => {
            setRoom(Math.round(laid.nativeEvent.layout.height));
          }}
        >
          {/* Kept from its top, where the picture's subject is; it fills whatever room it is left. */}
          <Image
            testID="get-started-picture"
            source={pictures.getstarted}
            resizeMode="cover"
            style={[styles.photo, { height: Math.max(room, Math.round(width * PHOTO_TALL)) }]}
            accessible={false}
          />
          <View style={[StyleSheet.absoluteFill, styles.fade]} />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.brand}>
          <Logo />
          <Txt kind="strong" style={styles.brandName}>
            AI Home Gym
          </Txt>
        </View>

        {step === "email" ? (
          <View style={styles.head}>
            <Txt kind="hero">Get started.</Txt>
            <Txt colour="textFaint">Sign in or create your account</Txt>
          </View>
        ) : arrival === "sent" ? (
          <View style={styles.head}>
            <Txt kind="hero">Check your email.</Txt>
            <View>
              <Txt colour="textFaint">Enter the 6-digit code sent to</Txt>
              <Txt kind="strong" numberOfLines={1}>
                {address}
              </Txt>
            </View>
          </View>
        ) : (
          <View style={styles.head}>
            <Txt kind="hero">Enter your code.</Txt>
            <View>
              <Txt colour="textFaint">{secondsToResend > 0 ? TOO_SOON.asked : TOO_SOON.have}</Txt>
              <Txt kind="strong" numberOfLines={1}>
                {address}
              </Txt>
              <Txt colour="textFaint">{secondsToResend > 0 ? TOO_SOON.wait : TOO_SOON.resend}</Txt>
            </View>
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
            {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
            <Button label="Continue" wide busy={busy} onPress={() => void continueWithEmail()} />
          </View>
        ) : (
          <View style={styles.form}>
            <Field
              key="code"
              label="6-digit code"
              bare
              value={code}
              onChange={(value) => {
                setCode(value.replace(/\D/g, "").slice(0, 6));
                setProblem("");
              }}
              placeholder="6-digit code"
              keyboard="number-pad"
              fills="one-time-code"
              maxLength={6}
              spaced
              ready
              onDone={() => void continueWithCode()}
            />
            {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
            <Button label="Continue" wide busy={busy} onPress={() => void continueWithCode()} />
            <View style={styles.links}>
              <Button
                label={secondsToResend > 0 ? `Resend code in ${String(secondsToResend)}s` : "Resend code"}
                kind="link"
                disabled={busy || secondsToResend > 0}
                onPress={() => void resend()}
              />
              <Button label="Use a different email" kind="quiet" disabled={busy} onPress={changeEmail} />
            </View>
            {said === "" ? null : (
              <Txt colour="goodText" style={styles.centre}>
                {said}
              </Txt>
            )}
          </View>
        )}
      </View>

      <Txt kind="tiny" style={styles.terms}>
        By continuing you agree to our Terms & Privacy Policy
      </Txt>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  fill: { flexGrow: 1 },
  hero: { flexGrow: 1, minHeight: 200, overflow: "hidden" },
  photo: { position: "absolute", top: 0, left: 0, width: "100%" },
  fade: { experimental_backgroundImage: pictureFade },
  body: { paddingHorizontal: sizes.edge, paddingTop: 16, gap: 18 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  head: { gap: 6 },
  note: { flexDirection: "row", alignItems: "center", gap: 10 },
  noteWords: { flex: 1 },
  form: { gap: 14 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  centre: { textAlign: "center" },
  terms: { paddingTop: 20, paddingHorizontal: sizes.edge, textAlign: "center" },
});
