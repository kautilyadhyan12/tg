import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { robotCheckMessageSchema } from "@app/shared";
import { Button } from "../look/Button";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { pageAddress, robotCheckPage, whereTo } from "./robotCheckPage";

/** The box's own failure, Cloudflare's refusal, or the script never loaded (no internet, a blocker). */
const TROUBLE = {
  failed: "We couldn’t check that you’re not a robot. Try again.",
  blocked: "The check didn’t load. Check your internet and try again.",
  /** The server's key or address cannot draw a page: nothing the person can fix but wait. */
  unusable: "We couldn’t show the check. Try again in a minute.",
};

/** Cloudflare's box is 65 points tall, whether it passes by itself or asks for a tap. */
const BOX_TALL = 72;

interface RobotCheckProps {
  /** The key the server sent with its refusal; null closes the box. */
  siteKey: string | null;
  apiUrl: string;
  /** The server's own sentence: why it asks, or that the last answer did not pass. */
  line: string;
  onToken: (token: string) => void;
  onClose: () => void;
}

/** The robot check, in a box from the bottom: the server asked for it before it sends a code. */
export function RobotCheck({ siteKey, apiUrl, line, onToken, onClose }: RobotCheckProps) {
  const [trouble, setTrouble] = useState<"failed" | "blocked" | null>(null);
  /** Each try draws a new box: an answer is spent once, and an expired one is no use. */
  const [round, setRound] = useState(0);
  const page = siteKey === null ? null : robotCheckPage(siteKey);
  const address = pageAddress(apiUrl);

  const again = () => {
    setTrouble(null);
    setRound((n) => n + 1);
  };

  const close = () => {
    setTrouble(null);
    onClose();
  };

  return (
    <Sheet open={siteKey !== null} title="Security check" onClose={close}>
      <Txt colour="textSoft">{line}</Txt>
      {page === null || address === null || trouble !== null ? null : (
        <View style={styles.box}>
          <WebView
            key={round}
            testID="robot-check-box"
            source={{ html: page, baseUrl: address }}
            originWhitelist={["*"]}
            style={styles.web}
            containerStyle={styles.web}
            scrollEnabled={false}
            allowFileAccess={false}
            mixedContentMode="never"
            onMessage={(event) => {
              // Only the page itself speaks for the box, never a frame inside it.
              if (!event.nativeEvent.url.startsWith(address)) return;
              let said: unknown;
              try {
                said = JSON.parse(event.nativeEvent.data);
              } catch {
                return;
              }
              const message = robotCheckMessageSchema.safeParse(said);
              if (!message.success) return;
              if (message.data.kind === "token") onToken(message.data.token);
              else if (message.data.kind === "expired") again();
              else setTrouble(message.data.kind);
            }}
            onError={() => {
              setTrouble("blocked");
            }}
            onShouldStartLoadWithRequest={(request) => {
              const where = whereTo(request.url, request.isTopFrame, address);
              if (where === "outside") void Linking.openURL(request.url);
              return where === "load";
            }}
            onOpenWindow={(event) => {
              if (whereTo(event.nativeEvent.targetUrl, true, address) === "outside") void Linking.openURL(event.nativeEvent.targetUrl);
            }}
          />
        </View>
      )}
      {siteKey === null ? null : page === null || address === null ? (
        <Txt colour="badText">{TROUBLE.unusable}</Txt>
      ) : trouble === null ? null : (
        <View style={styles.trouble}>
          <Txt colour="badText">{TROUBLE[trouble]}</Txt>
          <Button label="Try again" kind="link" onPress={again} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  box: { height: BOX_TALL },
  web: { flex: 1, backgroundColor: "transparent" },
  trouble: { gap: 8, alignItems: "flex-start" },
});
