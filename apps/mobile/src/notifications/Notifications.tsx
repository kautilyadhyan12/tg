import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { pushTokenResponseSchema } from "@app/shared";
import { Button } from "../look/Button";
import { Sheet } from "../look/Sheet";
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
  type Tapped,
} from "./phone";

// A gym's messages as phone notifications (ROADMAP Stage 5 item 18b-i). Once the tabs show, the app
// says why before Android asks, and once allowed it gives the server this phone's address for the
// person signed in, each time the app opens and whenever Firebase changes it. Drawn under the
// sign-in's own key, so somebody else signing in starts it again and the address moves to them.
// A tap on a gym's notification asks for that gym's Inbox, or for the class or event it is about
// (`useTapAsked`).

interface Asked {
  /** What a tapped notification asked for, until the Gym tab has opened it. */
  tapAsked: Tapped | null;
  tapOpened: () => void;
}

const AskedContext = createContext<Asked>({ tapAsked: null, tapOpened: () => undefined });
export const useTapAsked = () => useContext(AskedContext);

export const NOTIFICATIONS_ASK = {
  title: "Turn on notifications?",
  line: "Get your gym's messages, class reminders and places from the waitlist, even when the app is closed.",
} as const;

export function NotificationsProvider({ children, onTapped }: { children: ReactNode; onTapped?: () => void }) {
  const { session } = useSession();
  const [asking, setAsking] = useState(false);
  const [tapAsked, setTapAsked] = useState<Tapped | null>(null);

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
      setTapAsked(tapped);
      onTapped?.();
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
  const allow = async () => {
    setAsking(false);
    if (await askNotifications()) await give();
  };
  const tapOpened = useCallback(() => {
    setTapAsked(null);
  }, []);

  return (
    <AskedContext.Provider value={{ tapAsked, tapOpened }}>
      {children}
      <Sheet open={asking} title={NOTIFICATIONS_ASK.title} onClose={notNow}>
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
