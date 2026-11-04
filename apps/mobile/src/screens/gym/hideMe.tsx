import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Switch, View } from "react-native";
import { leaderboardVisibilitySchema, type LeaderboardVisibility } from "@app/shared";
import { Button } from "../../look/Button";
import { colours } from "../../look/colours";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";

// Hide me (spec Part 3 §15.5): one answer on the server for every gym's boards, drawn by the
// Leaderboard and by Settings from the same read and the same save. The switch only ever shows the
// server's last answer.

export const HIDE_ME_PATH = "/v1/users/me/leaderboard";

export type Hide = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; now: LeaderboardVisibility };

/** Hide me as the server holds it. `afterSave` runs after every press the server answered or not. */
export function useHideMe(afterSave: () => void = () => undefined) {
  const { session } = useSession();
  const [hide, setHide] = useState<Hide>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const started = useRef(0);
  const live = useRef(true);
  const after = useRef(afterSave);
  after.current = afterSave;

  const load = useCallback(async () => {
    started.current += 1;
    const number = started.current;
    const answer = await session.signedIn({ method: "GET", path: HIDE_ME_PATH }, leaderboardVisibilitySchema);
    if (!live.current || number !== started.current) return;
    if (answer.kind === "ok") setHide({ kind: "ok", now: answer.data });
    else setHide((was) => (was.kind === "ok" ? was : { kind: "failed" }));
  }, [session]);

  // Read again whenever the app comes back: the browser, or another phone, may have changed it.
  useEffect(() => {
    live.current = true;
    void load();
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load]);

  const save = async (hidden: boolean) => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    // A read that started before this press may not hold what the press does.
    started.current += 1;
    const answer = await session.signedIn({ method: "PUT", path: HIDE_ME_PATH, body: { hidden } }, leaderboardVisibilitySchema);
    // A read begun during the save, by the app coming back, may be older than this answer.
    started.current += 1;
    if (!live.current) return;
    setBusy(false);
    if (answer.kind === "ok") {
      setHide({ kind: "ok", now: answer.data });
    } else {
      setSaid(answer.kind === "refused" ? answer.message : NO_ANSWER);
      // The save may have reached the server: the switch shows what the server holds.
      void load();
    }
    after.current();
  };

  return { hide, busy, said, load, save };
}

interface HideMeProps {
  hide: Hide;
  busy: boolean;
  said: string | null;
  onChange: (hidden: boolean) => void;
  onAgain: () => void;
}

/** Drawn only from the server's answer: not known, there is no switch to read wrongly. */
export function HideMe({ hide, busy, said, onChange, onAgain }: HideMeProps) {
  if (hide.kind === "loading") return null;
  if (hide.kind === "failed") {
    return (
      <View style={styles.between}>
        <Txt kind="small" style={styles.grow}>
          Couldn’t load Hide me.
        </Txt>
        <Button label="Try again" kind="link" say="Try Hide me again" onPress={onAgain} />
      </View>
    );
  }
  const { now } = hide;
  return (
    <View style={styles.hide}>
      <View style={styles.between}>
        <View style={styles.grow}>
          <Txt kind="h3">Hide me</Txt>
          <Txt kind="small">{now.under18 && now.hidden ? "You’re under 18, so you’re hidden until you switch this off." : "Only staff will see you on the boards."}</Txt>
        </View>
        <Switch
          accessibilityLabel="Hide me on leaderboards"
          value={now.hidden}
          disabled={busy}
          onValueChange={onChange}
          trackColor={{ false: colours.lineStrong, true: colours.orange }}
          thumbColor={colours.text}
        />
      </View>
      {said === null ? null : (
        <Txt kind="small" colour="badText">
          {said}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  hide: { gap: 6 },
});
