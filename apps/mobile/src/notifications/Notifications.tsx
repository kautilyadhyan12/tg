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
  onGymTapped,
  onNewAddress,
  phoneAddress,
  saidNotNowAt,
  startNotifications,
} from "./phone";

// A gym's messages as phone notifications (ROADMAP Stage 5 item 18b-i). Once the tabs show, the app
// says why before Android asks, and once allowed it gives the server this phone's address for the
// person signed in, each time the app opens and whenever Firebase changes it. Drawn under the
// sign-in's own key, so somebody else signing in starts it again and the address moves to them.
// A tap on a gym's notification asks for that gym's Inbox (`useInboxAsked`).

interface Asked {
  /** The gym whose Inbox a tapped notification asked for, until the Gym tab has opened it. */
  inboxAsked: string | null;
  inboxOpened: () => void;
}

const AskedContext = createContext<Asked>({ inboxAsked: null, inboxOpened: () => undefined });
export const useInboxAsked = () => useContext(AskedContext);

export const NOTIFICATIONS_ASK = {
  title: "Turn on notifications?",
  line: "Get messages and class reminders from your gym, even when the app is closed.",
} as const;

export function NotificationsProvider({ children, onTapped }: { children: ReactNode; onTapped?: () => void }) {
  const { session } = useSession();
  const [asking, setAsking] = useState(false);
  const [inboxAsked, setInboxAsked] = useState<string | null>(null);

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
    const offTap = onGymTapped((gymId) => {
      if (!live()) return;
      setInboxAsked(gymId);
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
  const inboxOpened = useCallback(() => {
    setInboxAsked(null);
  }, []);

  return (
    <AskedContext.Provider value={{ inboxAsked, inboxOpened }}>
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
