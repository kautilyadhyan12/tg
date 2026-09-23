// The note to the app's operator when a gym's invitations are stopped (Part 3 §9.12;
// RULINGS 2026-09-08, the "have a look" list: an email to Kd until the admin panel).
// It goes through the sign-in codes' sender, never the invitations' sub-domain, and it
// never throws: the stop is already written, and `tools/invites-stopped.ts` lists it.
import type { EmailTransport } from "../../../email/resend.js";
import type { StoppedGym } from "./results.js";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The gym's name as the note prints it: one line, no control characters. */
const oneLine = (s: string): string => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, 120);

export function operatorNote(stopped: StoppedGym): { subject: string; text: string; html: string } {
  const name = oneLine(stopped.gymName) || "A gym";
  const why =
    stopped.reason === "complaint"
      ? "Somebody marked one of its first 100 invitations as spam."
      : `${String(stopped.bounced)} of its ${String(stopped.sent)} invitations bounced, more than 2 %.`;
  const resume = `corepack pnpm --filter api exec tsx tools/invites-stopped.ts resume ${stopped.gymId}`;
  const lines = [
    `${name}'s invitations were stopped. ${why}`,
    `Gym id: ${stopped.gymId}`,
    "Nothing more is sent for it. To start it again after a look:",
    resume,
  ];
  return {
    subject: `Invitations stopped: ${name}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
  };
}

export function operatorTeller(
  transport: EmailTransport | null,
  to: string | null,
  log: { error: (obj: object, msg: string) => void },
): (stopped: StoppedGym) => Promise<void> {
  return async (stopped) => {
    if (transport === null || to === null) return;
    try {
      await transport.send({ to, ...operatorNote(stopped) });
    } catch (err) {
      log.error(
        { event: "invite.operator_note_failed", gymId: stopped.gymId, errName: err instanceof Error ? err.name : typeof err },
        "the note that a gym's invitations stopped could not be emailed",
      );
    }
  };
}
