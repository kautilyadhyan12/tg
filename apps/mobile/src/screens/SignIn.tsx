import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SIGN_IN_CODE_RULES, authEmailSchema } from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card } from "../look/Card";
import { Field } from "../look/Field";
import { Page } from "../look/Page";
import { Txt } from "../look/Txt";
import type { Answer } from "../session/calls";
import { useSession } from "../session/SessionProvider";

// One "Get started" screen, as the member web's: sign-up and sign-in are the same act.
// Type your email, type the 6-digit code we send, and you are in; a new address gets a
// new account on the spot. Google's button comes with ROADMAP Stage 5 item 12d.

const NO_ANSWER = "We can’t reach the server. Check your internet connection and try again.";
/** The phone's own robot check is item 12b-ii; until then a phone that is asked for it says why it must wait. */
const ROBOT_ON_PHONE =
  "Too many codes were asked for from this Wi-Fi or network in the last hour. Switch to mobile data or another network, or try again in an hour.";

/** The resend gap in words, from the number the server enforces. */
const gapWords = (seconds: number) =>
  seconds === 60 ? "a minute" : seconds % 60 === 0 ? `${String(seconds / 60)} minutes` : `${String(seconds)} seconds`;
/** A "too soon" refusal says only that a code was asked for inside the gap, never that it is still good. */
const TOO_SOON = {
  when: `less than ${gapWords(SIGN_IN_CODE_RULES.resendAfterSeconds)} ago.`,
  next: "Type it below if you have it, or press Resend code when the countdown ends.",
};

/** The server's sentence is written for people; a reply with none gets one plain line. */
function wordsFor(answer: Exclude<Answer<unknown>, { kind: "ok" }>, fallback: string): string {
  if (answer.kind === "no_answer") return NO_ANSWER;
  if (answer.error === "robot_check" || answer.error === "robot_failed") return ROBOT_ON_PHONE;
  return answer.message === "" ? fallback : answer.message;
}

export function SignInScreen({ note }: { note: string | null }) {
  const { session } = useSession();
  const [step, setStep] = useState<"email" | "code">("email");
  const [typed, setTyped] = useState("");
  /** The address the code was asked for, as the server reads it. */
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  /** `sent`: a code went out. `too-soon`: the server refused inside the gap, so nothing did. */
  const [arrival, setArrival] = useState<"sent" | "too-soon">("sent");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

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

  async function askForCode(to: string): Promise<"sent" | "too-soon" | null> {
    setBusy(true);
    setProblem("");
    setSaid("");
    try {
      const answer = await session.sendCode(to);
      if (answer.kind === "ok") {
        waitFor(answer.data.resendAfterSeconds);
        setArrival("sent");
        return "sent";
      }
      if (answer.kind === "refused" && answer.error === "code_too_soon") {
        waitFor(answer.retryAfterSeconds ?? 0);
        setArrival("too-soon");
        return "too-soon";
      }
      setProblem(wordsFor(answer, "We could not send the code. Please try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function continueWithEmail() {
    if (busy) return;
    if (typed.trim() === "") {
      setProblem("Please type your email address.");
      return;
    }
    const parsed = authEmailSchema.safeParse(typed);
    if (!parsed.success) {
      setProblem("That doesn’t look like an email address. Check it and try again.");
      return;
    }
    // Sent or too soon, the code box is next: a good code may already be in the inbox.
    if ((await askForCode(parsed.data)) !== null) {
      setAddress(parsed.data);
      setCode("");
      setStep("code");
    }
  }

  async function resend() {
    if (busy || secondsToResend > 0) return;
    const result = await askForCode(address);
    if (result === "sent") {
      setCode("");
      setSaid("New code sent.");
    }
  }

  async function continueWithCode() {
    if (busy) return;
    if (code.length !== 6) {
      setProblem("Type the 6 digits from the email.");
      return;
    }
    setBusy(true);
    setProblem("");
    setSaid("");
    const answer = await session.verifyCode(address, code);
    // Signed in: the tabs take this screen's place.
    if (answer.kind === "ok") return;
    setProblem(wordsFor(answer, "That code did not work. Please try again."));
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
    <Page>
      <View style={styles.logo}>
        <Badge icon="dumbbell" />
        <Txt kind="strong">AI Home Gym</Txt>
      </View>
      <View style={styles.head}>
        <Txt kind="h1">Get started.</Txt>
        <Txt>Sign in or create your account. No password needed.</Txt>
      </View>

      {note === null ? null : (
        <Card>
          <Txt colour="text">{note}</Txt>
        </Card>
      )}

      {step === "email" ? (
        <View style={styles.form}>
          <Field
            label="Email"
            value={typed}
            onChange={(value) => {
              setTyped(value);
              setProblem("");
            }}
            placeholder="you@example.com"
            keyboard="email-address"
            fills="email"
            maxLength={254}
            onDone={() => void continueWithEmail()}
          />
          {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
          <Button
            label={busy ? "Sending your code…" : "Continue with email"}
            icon="mail"
            wide
            disabled={busy}
            onPress={() => void continueWithEmail()}
          />
          <Txt kind="small" colour="textFaint" style={styles.centre}>
            We’ll email you a 6-digit code.
          </Txt>
        </View>
      ) : (
        <View style={styles.form}>
          <Txt>
            {arrival === "sent" ? (
              <>
                We sent a 6-digit code to <Txt kind="strong">{address}</Txt>.
              </>
            ) : secondsToResend > 0 ? (
              <>
                You asked for a code for <Txt kind="strong">{address}</Txt> {TOO_SOON.when} {TOO_SOON.next}
              </>
            ) : (
              <>
                Type the 6-digit code for <Txt kind="strong">{address}</Txt>, or press Resend code for a new one.
              </>
            )}
          </Txt>
          <Field
            label="6-digit code"
            value={code}
            onChange={(value) => {
              setCode(value.replace(/\D/g, "").slice(0, 6));
              setProblem("");
            }}
            placeholder="123456"
            keyboard="number-pad"
            fills="one-time-code"
            maxLength={6}
            spaced
            onDone={() => void continueWithCode()}
          />
          {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
          <Button
            label={busy ? "One moment…" : "Continue"}
            wide
            disabled={busy}
            onPress={() => void continueWithCode()}
          />
          <View style={styles.row}>
            <Button
              label={secondsToResend > 0 ? `Resend code in ${String(secondsToResend)}s` : "Resend code"}
              kind="plain"
              small
              disabled={busy || secondsToResend > 0}
              onPress={() => void resend()}
            />
            <Button label="Use a different email" kind="plain" small disabled={busy} onPress={changeEmail} />
          </View>
          {said === "" ? null : <Txt colour="goodText">{said}</Txt>}
        </View>
      )}

      <Txt kind="small" colour="textFaint" style={styles.centre}>
        By continuing you agree to our Terms & Privacy Policy
      </Txt>
    </Page>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24 },
  head: { gap: 6, marginTop: 8 },
  form: { gap: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10 },
  centre: { textAlign: "center" },
});
