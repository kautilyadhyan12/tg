// May this invitation email go now? (Part 3 §9.12.) The one rule, pure, asked by the
// worker just before every send with facts read that moment. A press queued the email
// minutes or hours ago; anything that changed since (the person taken off the list,
// joined, unsubscribed; the gym lapsed) stops it here.
import type { MemberInviteEmailReason, MemberInviteState } from "@app/shared";
import type { SuppressionReason } from "./repo.js";

export type MailCheck = "accepts" | "no_mail" | "unknown";

export interface SendFacts {
  /** The invitation this email belongs to, or null if it is gone. */
  inviteState: MemberInviteState | null;
  /** The address the email is for matches the invitation's HMAC. */
  addressMatchesInvite: boolean;
  /** `named`: the gym's name can be shown in an email (`gymNameForEmail`); `stopped`:
   *  its sending was stopped for bounces or a complaint. */
  gym: { active: boolean; onPlan: boolean; stopped: boolean; hasPostalAddress: boolean; named: boolean } | null;
  /** A current entry of the gym holds exactly this address. */
  onList: boolean;
  /** Every current entry holding it is somebody the list says is under 18 today. */
  onlyUnderAge: boolean;
  /** A member of the gym is matched to one of those entries (§9.7). */
  inApp: boolean;
  suppression: SuppressionReason | null;
  /** The address passes sign-in's own email rule. */
  addressValid: boolean;
  shared: boolean;
  /** Whether the address's domain takes email; null until it has been asked. */
  mail: MailCheck | null;
}

export type SendDecision =
  | { kind: "send" }
  | { kind: "skip"; reason: MemberInviteEmailReason }
  /** Everything else allows it: ask the domain, then decide again. */
  | { kind: "check_mail" }
  /** The domain could not be asked; try again later. */
  | { kind: "retry"; reason: MemberInviteEmailReason };

export function decideSend(facts: SendFacts): SendDecision {
  if (facts.gym === null || !facts.gym.active || !facts.gym.onPlan) return { kind: "skip", reason: "gym_not_active" };
  if (facts.gym.stopped) return { kind: "skip", reason: "sending_stopped" };
  if (!facts.gym.hasPostalAddress) return { kind: "skip", reason: "no_postal_address" };
  if (!facts.gym.named) return { kind: "skip", reason: "gym_name" };
  // Staff took the person off or removed them: said as that, not as an answer they gave.
  if (facts.inviteState === "withdrawn") return { kind: "skip", reason: "invitation_withdrawn" };
  if (facts.inviteState === null || facts.inviteState !== "pending") return { kind: "skip", reason: "invitation_closed" };
  if (!facts.addressMatchesInvite || !facts.onList) return { kind: "skip", reason: "not_on_list" };
  if (facts.onlyUnderAge) return { kind: "skip", reason: "under_age" };
  if (facts.inApp) return { kind: "skip", reason: "in_app" };
  if (facts.suppression !== null) return { kind: "skip", reason: facts.suppression };
  if (!facts.addressValid) return { kind: "skip", reason: "bad_address" };
  if (facts.shared) return { kind: "skip", reason: "shared_address" };
  switch (facts.mail) {
    case null:
      return { kind: "check_mail" };
    case "no_mail":
      return { kind: "skip", reason: "no_mail_domain" };
    case "unknown":
      return { kind: "retry", reason: "dns_unavailable" };
    case "accepts":
      return { kind: "send" };
  }
}
