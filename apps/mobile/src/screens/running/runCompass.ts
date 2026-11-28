// The way the phone points, for the beam at the front of a run's map (ROADMAP Stage 5 item 37p), as Strava's and
// Google Maps' beam turns with the phone. Read from this app's Android code (modules/run-motion) only while the map
// is on screen and the app is in front; shown, never kept or sent. A phone with no compass, an iPhone (Stage 5 item
// 21) and a copy built before 37p have none, and the beam shows the way travelled as before.
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { phoneCompassSchema } from "@app/shared";
import { headingOf, turnedEnough, type Heading } from "./compassHeading";
import { runMotionNative } from "./runMotionNative";

/** The compass while `on` and the app is in front; null before its first reading and on a phone with none.
 *  `place`: where the person is, for true north there. */
export function useCompass(on: boolean, place: readonly [number, number] | null): Heading | null {
  const [heading, setHeading] = useState<Heading | null>(null);
  const [front, setFront] = useState(AppState.currentState !== "background");
  useEffect(() => {
    const heard = AppState.addEventListener("change", (next) => {
      setFront(next !== "background");
    });
    return () => {
      heard.remove();
    };
  }, []);
  const reading = on && front;
  useEffect(() => {
    const native = runMotionNative;
    if (!reading || native?.compassStart === undefined || native.addListener === undefined) return undefined;
    let heard: { remove: () => void } | null = null;
    try {
      heard = native.addListener("heading", (raw) => {
        const said = phoneCompassSchema.safeParse(raw);
        const now = said.success ? headingOf(said.data) : null;
        // Drawn again only when it has turned: Android reads about 20 times a second.
        if (now !== null) setHeading((was) => (turnedEnough(was, now) ? now : was));
      });
      if (!native.compassStart()) {
        heard.remove();
        heard = null;
      }
    } catch {
      // A compass that fails leaves the beam showing the way travelled.
      heard?.remove();
      heard = null;
    }
    return () => {
      heard?.remove();
      try {
        native.compassStop?.();
      } catch {
        // Already let go by Android.
      }
      setHeading(null);
    };
  }, [reading]);
  const lat = place?.[0];
  const lng = place?.[1];
  useEffect(() => {
    if (!reading || lat === undefined || lng === undefined) return;
    try {
      runMotionNative?.compassPlace?.(lat, lng);
    } catch {
      // The gap to true north stays as it was.
    }
  }, [reading, lat, lng]);
  return reading ? heading : null;
}
