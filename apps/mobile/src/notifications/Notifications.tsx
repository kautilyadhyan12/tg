import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { pushTokenResponseSchema } from "@app/shared";
import { Button } from "../look/Button";
import { Sheet } from "../look/Sheet";
import { useSetupComing } from "../screens/SetupGate";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import {
  ASK_AGAIN_MS,
  askNotifications,
  keepNotNow,
  notificationsAllowed,
  onTapped as onNotificationTapped,
  onNewAddress,
  phoneAddress,
  saidNotNowAt,
  startNotifications,
  type GymTapped,
  type NotificationsAllowed,
  type Tapped,
} from "./phone";

// A gym's messages as phone notifications (ROADMAP Stage 5 item 18b-i). Once the tabs show, the app
// says why before Android asks, and once allowed it gives the server this phone's address for the
// person signed in, each time the app opens and whenever Firebase changes it. Drawn under the
// sign-in's own key, so somebody else signing in starts it again and the address moves to them.
// A tap on a gym's notification asks for that gym's Inbox, or for the class or event it is about
// (`useTapAsked`); a training reminder's tap opens Workout or Food (19e-i). Settings reads whether Android lets the app show them, and turns them on (19d:
// `usePhoneAllows`).

interface Asked {
  /** What a tapped notification asked for, until the Gym tab has opened it. */
  tapAsked: GymTapped | null;
  tapOpened: () => void;
}

const AskedContext = createContext<Asked>({ tapAsked: null, tapOpened: () => undefined });
export const useTapAsked = () => useContext(AskedContext);

interface PhoneAllows {
  /** Whether Android lets the app show notifications; null until read. */
  allowed: NotificationsAllowed | null;
  /** Reads it again (back from the phone's settings); allowed, the server is given this phone's address. */
  readAgain: () => Promise<void>;
  /** Android's own question, then reads it again. */
  turnOn: () => Promise<void>;
}

const AllowsContext = createContext<PhoneAllows>({ allowed: null, readAgain: () => Promise.resolve(), turnOn: () => Promise.resolve() });
export const usePhoneAllows = () => useContext(AllowsContext);

export const NOTIFICATIONS_ASK = {
  title: "Turn on notifications?",
  line: "Get your reminders and messages, even when the app is closed.",
} as const;

export function NotificationsProvider({ children, onTapped }: { children: ReactNode; onTapped?: (tapped: Tapped) => void }) {
  const { session } = useSession();
  const [asking, setAsking] = useState(false);
  const [tapAsked, setTapAsked] = useState<GymTapped | null>(null);
  const [allowed, setAllowed] = useState<NotificationsAllowed | null>(null);
  // Not over the look or setup (14d): asked once setup is finished.
  const setupComing = useSetupComing();
  // The last answer read, so the address is given only when notifications have just been allowed.
  const lastAllowed = useRef<NotificationsAllowed | null>(null);

  const give = useCallback(
    async (known?: string) => {
      const token = known ?? (await phoneAddress());
      if (token === null) return;
      await session.signedIn({ method: "PUT", path: "/v1/push-tokens", body: { token, platform: "android" } }, pushTokenResponseSchema);
    },
    [session],
  );

  useEffect(() => {
    startNotifications();
    const run = { live: true };
    // Read through a call: the tabs may have closed during a wait.
    const live = () => run.live;
    void (async () => {
      const allowed = await notificationsAllowed();
      if (!live()) return;
      lastAllowed.current = allowed;
      setAllowed(allowed);
      if (allowed === "yes") {
        await give();
        return;
      }
      if (allowed !== "ask") return;
      const notNow = await saidNotNowAt();
      if (live() && (notNow === null || Date.now() - notNow >= ASK_AGAIN_MS)) setAsking(true);
    })();
    const offAddress = onNewAddress((address) => void give(address));
    const offTap = onNotificationTapped((tapped) => {
      if (!live()) return;
      if (tapped.kind !== "training" && tapped.kind !== "progress") setTapAsked(tapped);
      onTapped?.(tapped);
    });
    return () => {
      run.live = false;
      offAddress();
      offTap();
    };
  }, [give, onTapped]);

  const notNow = () => {
    setAsking(false);
    void keepNotNow(Date.now());
  };
  const readAgain = useCallback(async () => {
    const now = await notificationsAllowed();
    const was = lastAllowed.current;
    lastAllowed.current = now;
    setAllowed(now);
    if (now === "yes" && was !== "yes") await give();
  }, [give]);
  const allow = async () => {
    setAsking(false);
    await askNotifications();
    await readAgain();
  };
  const turnOn = useCallback(async () => {
    await askNotifications();
    await readAgain();
  }, [readAgain]);
  const tapOpened = useCallback(() => {
    setTapAsked(null);
  }, []);

  return (
    <AskedContext.Provider value={{ tapAsked, tapOpened }}>
      <AllowsContext.Provider value={{ allowed, readAgain, turnOn }}>{children}</AllowsContext.Provider>
      <Sheet open={asking && !setupComing} title={NOTIFICATIONS_ASK.title} onClose={notNow}>
        <Txt kind="body">{NOTIFICATIONS_ASK.line}</Txt>
        <View style={styles.two}>
          <Button label="Not now" kind="plain" style={styles.half} onPress={notNow} />
          <Button label="Continue" icon="bell" style={styles.half} onPress={() => void allow()} />
        </View>
      </Sheet>
    </AskedContext.Provider>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10, marginTop: 16 },
  half: { flex: 1 },
});
