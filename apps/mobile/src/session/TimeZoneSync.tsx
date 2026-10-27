import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { userProfileResponseSchema } from "@app/shared";
import { useSession } from "./SessionProvider";

/** The phone's own time zone, an IANA name ("Asia/Kolkata"); null when the phone does not say. */
export function phoneTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" ? zone : null;
  } catch {
    return null;
  }
}

/** The zone to save, or null to leave it, as the browser decides (`apps/web/src/api/userApi.js`):
 *  nothing when the phone does not say or already agrees; trimmed and within the server's 64. */
export function zoneToSave(stored: string | null, phone: string | null): string | null {
  if (phone === null) return null;
  const zone = phone.trim();
  if (zone === "" || zone.length > 64) return null;
  return zone === (stored ?? "").trim() ? null : zone;
}

const ZoneSaved = createContext(0);

/** How many times this person's zone was saved since the app opened: a page keyed by day reads again
 *  when it moves. */
export const useZoneSaved = () => useContext(ZoneSaved);

/** The server keys a person's days in their own time zone, and keeps UTC until told one: a workout at
 *  5 in the morning in India is the day before in UTC. Once signed in, the phone tells it its own, as
 *  the browser does. */
export function TimeZoneSync({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    // Left by a sign-out or another person while a reply was away: its answer is nobody's.
    const run = { live: true };
    const live = () => run.live;
    void (async () => {
      const profile = await session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema);
      if (!live() || profile.kind !== "ok") return;
      const zone = zoneToSave(profile.data.user.timezone, phoneTimeZone());
      if (zone === null) return;
      const changed = await session.signedIn({ method: "PATCH", path: "/v1/users/me", body: { timezone: zone } }, userProfileResponseSchema);
      if (live() && changed.kind === "ok") setSaved((n) => n + 1);
    })();
    return () => {
      run.live = false;
    };
  }, [session]);

  return <ZoneSaved.Provider value={saved}>{children}</ZoneSaved.Provider>;
}
