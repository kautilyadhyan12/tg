// May the app send this lead's follow-up now? (Part 3 §16.3; ROADMAP 20c-v-a.) The one
// rule, pure, asked by the worker just before every send with facts read that moment.
// The worker took the email a moment ago under the lead's lock; anything that changed
// since — the switch off, the lead moved on, unticked or given a new address, the
// person unsubscribed — stops it here.
//
// Three ways not to send. `drop`: the email is not due any more (or the gym cannot send
// now); it never went, so it is forgotten and may be taken again if it comes due again.
// `skip`: the app will not send it to this address, and says why; staff may send it
// themselves. `retry`: the address's domain could not be asked; later.
import type { LeadEmailNotSent } from "@app/shared";
import type { MailCheck } from "../invites/decide.js";
import type { SuppressionReason } from "../invites/repo.js";

export interface LeadSendFacts {
  /** `named`: the gym's name can be shown in an email; `stopped`: its sending was
   *  stopped for bounces or a complaint (§9.12). */
  gym: {
    active: boolean;
    onPlan: boolean;
    switchedOn: boolean;
    stopped: boolean;
    hasPostalAddress: boolean;
    named: boolean;
  } | null;
  /** The lead now, or null when it was deleted. */
  lead: {
    isNew: boolean;
    /** Its "Happy to hear from us" tick is the one the email was taken under. */
    sameTick: boolean;
    /** Its address is the one the email is for. */
    sameAddress: boolean;
    /** It has had one fewer than this email's number. */
    nextStep: boolean;
    /** Its next one is due today or earlier, by the gym's clock. */
    due: boolean;
  } | null;
  suppression: SuppressionReason | null;
  /** A current record on the gym's member list holds this address. */
  onMemberList: boolean;
  /** The address passes sign-in's own email rule. */
  addressValid: boolean;
  /** A shared mailbox (info@, sales@ …). */
  shared: boolean;
  /** Whether the address's domain takes email; null until it has been asked. */
  mail: MailCheck | null;
}

export type LeadSendDropReason =
  | "gym_not_active"
  | "switched_off"
  | "sending_stopped"
  | "no_postal_address"
  | "gym_name"
  | "lead_gone"
  | "not_new"
  | "tick_changed"
  | "address_changed"
  | "already_sent"
  | "not_due";

export type LeadSendDecision =
  | { kind: "send" }
  | { kind: "drop"; reason: LeadSendDropReason; of: "gym" | "lead" }
  | { kind: "skip"; reason: LeadEmailNotSent }
  | { kind: "check_mail" }
  | { kind: "retry" };

export function decideLeadSend(facts: LeadSendFacts): LeadSendDecision {
  const gym = facts.gym;
  if (gym === null || !gym.active || !gym.onPlan) return { kind: "drop", reason: "gym_not_active", of: "gym" };
  if (!gym.switchedOn) return { kind: "drop", reason: "switched_off", of: "gym" };
  if (gym.stopped) return { kind: "drop", reason: "sending_stopped", of: "gym" };
  if (!gym.hasPostalAddress) return { kind: "drop", reason: "no_postal_address", of: "gym" };
  if (!gym.named) return { kind: "drop", reason: "gym_name", of: "gym" };
  const lead = facts.lead;
  if (lead === null) return { kind: "drop", reason: "lead_gone", of: "lead" };
  if (!lead.isNew) return { kind: "drop", reason: "not_new", of: "lead" };
  if (!lead.sameTick) return { kind: "drop", reason: "tick_changed", of: "lead" };
  if (!lead.sameAddress) return { kind: "drop", reason: "address_changed", of: "lead" };
  if (!lead.nextStep) return { kind: "drop", reason: "already_sent", of: "lead" };
  if (!lead.due) return { kind: "drop", reason: "not_due", of: "lead" };
  if (facts.suppression !== null) return { kind: "skip", reason: facts.suppression };
  if (facts.onMemberList) return { kind: "skip", reason: "on_member_list" };
  if (!facts.addressValid) return { kind: "skip", reason: "bad_address" };
  if (facts.shared) return { kind: "skip", reason: "shared_address" };
  switch (facts.mail) {
    case null:
      return { kind: "check_mail" };
    case "no_mail":
      return { kind: "skip", reason: "no_mail_domain" };
    case "unknown":
      return { kind: "retry" };
    case "accepts":
      return { kind: "send" };
  }
}
