import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import * as Brightness from "expo-brightness";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { CheckinPassResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { colours } from "../../look/colours";
import { Sheet } from "../../look/Sheet";
import { MIDDLE_INSET, passSide } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import type { Answer } from "../../session/calls";
import { PASS_GOOD_MS, PASS_QUIET_CELLS, nextPassDelayMs, passCells, passPath } from "./passView";
import { untilNextWindowMs } from "./phonePass";

// The member's pass (spec Part 3 §12.2): the code the front desk reads. One pass a person, good at
// every place they belong to, new every 30 seconds and taken once. It is never kept on the phone.
//
// It asks only while it is open and the app is in front. A pass is never left on screen to be
// scanned stale: it comes off when its renewal fails, and 30 seconds after it was asked for when
// the next has not arrived, whatever the reason. While it is open the screen stays awake and at
// full brightness, so a desk's camera reads it in poor light; both go back when it closes.
//
// With no signal (ROADMAP Stage 5 item 15c) the phone shows the pass it makes itself with this
// sign-in's key, new each window: when the server cannot be reached, and while its answer is more
// than two seconds away (a phone opened with no signal tries for a while before it says so). With
// it on screen the server is asked again every 25 seconds and when the app comes back to the front,
// and the server's pass, once it comes, is shown instead.

export const PASS_PATH = "/v1/users/me/checkin-pass";
export const PASS_COULD_NOT = "We couldn’t get your pass just now. Please try again.";
export const PASS_GETTING = "Getting your pass…";
export const PASS_OFFLINE = "You’re offline. Show this at the desk.";
/** How long the server's pass is waited for before the phone's own is shown. */
export const OWN_PASS_AFTER_MS = 2_000;
/** How often the server is asked again while the phone's own pass is on screen with no signal. */
export const OFFLINE_ASK_AGAIN_MS = 25_000;

const AWAKE_TAG = "pass";

export type FetchPass = () => Promise<Answer<CheckinPassResponse>>;
/** This window's pass made by the phone itself, or null when it cannot make one. */
export type MakeOwnPass = (nowMs: number) => string | null;
/** `offline`: the server could not be reached, rather than refused. */
type Shown = { status: "loading" } | { status: "ready"; pass: string } | { status: "failed"; message: string; offline: boolean };
const LOADING: Shown = { status: "loading" };

interface PassSheetProps {
  open: boolean;
  /** A personal trainer scans it themselves; anywhere else it is the scanner at the desk. */
  trainer: boolean;
  onClose: () => void;
  fetchPass: FetchPass;
  /** Null until the server has given this sign-in its key. */
  makeOwnPass: MakeOwnPass | null;
}

export function PassSheet({ open, trainer, onClose, fetchPass, makeOwnPass }: PassSheetProps) {
  return (
    <Sheet open={open} title="Your pass" onClose={onClose} place="middle">
      {open ? <PassBody trainer={trainer} fetchPass={fetchPass} makeOwnPass={makeOwnPass} /> : null}
    </Sheet>
  );
}

function PassBody({ trainer, fetchPass, makeOwnPass }: { trainer: boolean; fetchPass: FetchPass; makeOwnPass: MakeOwnPass | null }) {
  const [shown, setShown] = useState<Shown>(LOADING);
  // Bumped by Try again, which starts the asking over.
  const [attempt, setAttempt] = useState(0);
  const own = useOwnPass(makeOwnPass);
  // Read by the asking below, which is not started again when it changes.
  const canOwn = useRef(false);
  canOwn.current = own !== null;
  // The server's pass has been waited for long enough to show the phone's own.
  const [slow, setSlow] = useState(false);
  useBrightAndAwake();

  useEffect(() => {
    setSlow(false);
    const wait = setTimeout(() => {
      setSlow(true);
    }, OWN_PASS_AFTER_MS);
    return () => {
      clearTimeout(wait);
    };
  }, [attempt]);

  useEffect(() => {
    let stopped = false;
    let asking = false;
    let failed = false;
    let next: ReturnType<typeof setTimeout> | null = null;
    let stale: ReturnType<typeof setTimeout> | null = null;
    // When the pass on screen was asked for, by this phone's clock, or null with none shown: its 30
    // seconds run from when the server made it, not from when it arrived.
    let shownAt: number | null = null;

    const takeOff = () => {
      stale = null;
      if (stopped || shownAt === null) return;
      shownAt = null;
      setShown((held) => (held.status === "ready" ? LOADING : held));
    };

    const ask = async () => {
      next = null;
      if (asking) return;
      asking = true;
      const askedAt = Date.now();
      const answer = await fetchPass();
      asking = false;
      if (stopped) return;
      if (stale !== null) clearTimeout(stale);
      stale = null;
      if (answer.kind !== "ok") {
        // The old pass goes with the failure.
        shownAt = null;
        const offline = answer.kind === "no_answer";
        setShown({
          status: "failed",
          message: answer.kind === "refused" && answer.message !== "" ? answer.message : PASS_COULD_NOT,
          offline,
        });
        // With no signal and the phone's own pass on screen, the server is asked again, so its pass
        // and its words come back with the signal. Otherwise nothing asks again by itself: Try again does.
        if (offline && canOwn.current) {
          if (AppState.currentState !== "background") next = setTimeout(() => void ask(), OFFLINE_ASK_AGAIN_MS);
          return;
        }
        failed = true;
        return;
      }
      const age = Date.now() - askedAt;
      shownAt = askedAt;
      setShown({ status: "ready", pass: answer.data.pass });
      stale = setTimeout(takeOff, Math.max(0, PASS_GOOD_MS - age));
      // Not "active": the state the app starts in may not be known yet, and a pass on screen is in front.
      if (AppState.currentState !== "background") {
        // A slow answer has used up part of the wait already.
        next = setTimeout(() => void ask(), Math.max(1_000, nextPassDelayMs(answer.data.refreshAt, Date.now()) - age));
      }
    };

    // In the background it asks nothing. Back in front, a pass past its 30 seconds comes off at once
    // and the next is asked for.
    const moved = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (next !== null) clearTimeout(next);
        next = null;
        return;
      }
      if (failed) return;
      if (shownAt !== null && Date.now() - shownAt >= PASS_GOOD_MS) {
        if (stale !== null) clearTimeout(stale);
        takeOff();
      }
      if (next === null) void ask();
    });

    void ask();
    return () => {
      stopped = true;
      if (next !== null) clearTimeout(next);
      if (stale !== null) clearTimeout(stale);
      moved.remove();
    };
  }, [attempt, fetchPass]);

  // The phone's own pass, while the server's is slow or out of reach; never over a refusal.
  if (own !== null && (shown.status === "loading" ? slow : shown.status === "failed" && shown.offline)) {
    return <ReadyPass pass={own} trainer={trainer} offline={shown.status === "failed"} />;
  }
  if (shown.status === "loading") {
    return (
      <View style={styles.waiting}>
        <ActivityIndicator color={colours.textSoft} />
        <Txt kind="small">{PASS_GETTING}</Txt>
      </View>
    );
  }
  if (shown.status === "failed") {
    return (
      <View style={styles.failed}>
        <Txt colour="badText">{shown.message}</Txt>
        <Button
          label="Try again"
          kind="soft"
          small
          onPress={() => {
            setShown(LOADING);
            setAttempt((n) => n + 1);
          }}
        />
      </View>
    );
  }
  return <ReadyPass pass={shown.pass} trainer={trainer} offline={false} />;
}

function ReadyPass({ pass, trainer, offline }: { pass: string; trainer: boolean; offline: boolean }) {
  return (
    <View style={styles.ready}>
      <PassCode pass={pass} />
      <Txt colour="text" style={styles.centre}>
        {trainer ? "Hold this up for your trainer to scan." : "Hold this up to the scanner to check in."}
      </Txt>
      <Txt kind="small" style={styles.centre}>
        {offline ? PASS_OFFLINE : "It changes every 30 seconds."}
      </Txt>
    </View>
  );
}

/** The phone's own pass for this window, made again as each window begins and when the app comes
 *  back to the front (a phone in the background may not have woken for it), or null. */
function useOwnPass(makeOwnPass: MakeOwnPass | null): string | null {
  const [own, setOwn] = useState<string | null>(() => makeOwnPass?.(Date.now()) ?? null);
  useEffect(() => {
    if (makeOwnPass === null) {
      setOwn(null);
      return;
    }
    let next: ReturnType<typeof setTimeout> | null = null;
    const make = () => {
      if (next !== null) clearTimeout(next);
      setOwn(makeOwnPass(Date.now()));
      next = setTimeout(make, untilNextWindowMs(Date.now()));
    };
    make();
    const moved = AppState.addEventListener("change", (state) => {
      if (state === "active") make();
    });
    return () => {
      if (next !== null) clearTimeout(next);
      moved.remove();
    };
  }, [makeOwnPass]);
  return own;
}

function PassCode({ pass }: { pass: string }) {
  const { width, height } = useWindowDimensions();
  const cells = passCells(pass);
  if (cells === null) return <Txt colour="badText">{PASS_COULD_NOT}</Txt>;
  const across = cells.length + PASS_QUIET_CELLS * 2;
  // A whole number of points a cell, so no cell's edge is blurred into the next.
  const side = Math.max(1, Math.floor(passSide(width, height, MIDDLE_INSET) / across)) * across;
  return (
    // Black on white whatever the app's colours: that is what a scanner reads.
    <View accessible accessibilityRole="image" accessibilityLabel="Your check-in pass" style={[styles.code, { width: side, height: side }]}>
      <Svg width={side} height={side} viewBox={`0 0 ${String(across)} ${String(across)}`}>
        <Rect width={across} height={across} fill={colours.passLight} />
        <Path testID="pass-code" d={passPath(cells)} fill={colours.passDark} />
      </Svg>
    </View>
  );
}

/** The screen kept awake and at full brightness while the pass is open, and put back when it closes.
 *  Android brightens this app's own window and gives the phone's setting back on close. Elsewhere the
 *  brightness is the whole phone's: the brightness before is kept and set again on close, and while
 *  the app is in the background, so other apps are not left bright. A phone that can do neither still
 *  shows the pass. */
function useBrightAndAwake() {
  useEffect(() => {
    const android = Platform.OS === "android";
    let before: number | null = null;
    // One change at a time, in order: a close straight after opening waits for the brightening.
    let last: Promise<unknown> = Promise.resolve();
    const then = (step: () => Promise<unknown> | undefined) => {
      last = last.then(step).catch(() => undefined);
    };
    const brighten = () => {
      then(async () => {
        if (!android) before = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      });
    };
    const giveBack = () => {
      then(() => (android ? Brightness.restoreSystemBrightnessAsync() : before === null ? undefined : Brightness.setBrightnessAsync(before)));
    };
    void activateKeepAwakeAsync(AWAKE_TAG).catch(() => undefined);
    brighten();
    const moved = android
      ? null
      : AppState.addEventListener("change", (state) => {
          if (state === "active") brighten();
          else if (state === "background") giveBack();
        });
    return () => {
      moved?.remove();
      void deactivateKeepAwake(AWAKE_TAG).catch(() => undefined);
      giveBack();
    };
  }, []);
}

const styles = StyleSheet.create({
  waiting: { alignItems: "center", gap: 10, paddingVertical: 48 },
  failed: { gap: 12, alignItems: "flex-start", paddingBottom: 8 },
  ready: { alignItems: "center", gap: 8 },
  code: { alignSelf: "center", borderRadius: 16, overflow: "hidden", backgroundColor: colours.passLight },
  centre: { textAlign: "center" },
});
