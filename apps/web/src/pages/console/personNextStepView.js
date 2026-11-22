// The strip under a member's name (spec Part 3 §17.11, V2a): the next step, the first of
// these that applies. A payment due, with Record payment · no membership, with Add membership
// · an agreement or waiver not signed, with its button · not in the app, with Invite to app ·
// otherwise "Nothing due". Every fact is the one the page's own boxes read: the person's
// memberships answer (the one Memberships draws, and the Members list's Payment word) and
// their record. Pure: no clock, `today` is the business's own day from that answer.
import { MEMBER_FEE_WORDS, formatMinor } from '@app/shared';
import { billDays, feeForWords, feesOwed, NO_PAYMENTS_LINE, shortDay } from './memberBillsView';
import { agreementLineParts, UNSIGNED_STOPS_LINE } from './agreementView';
import { signedInApp } from './waiverView';

const IN_USE = new Set(['active', 'frozen', 'upcoming']);
const earlier = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** What a payment strip's Record payment opens: the bill the membership's own button pays,
 *  or the oldest fee owed where no bill is due. Null where neither can be paid here. */
function payTarget(m, today) {
  const pay = m.billing?.pay ?? null;
  if (pay !== null && pay.dueOn <= today) {
    return { feeBillId: null, amountMinor: pay.leftMinor, overdue: pay.state === 'overdue', dueOn: pay.dueOn, what: pay.covers === null ? m.typeName : `${m.typeName}, ${billDays(pay.covers)}` };
  }
  const fee = feesOwed(m)
    .filter((f) => f.dueOn <= today && f.stillOwed !== false)
    .sort((a, b) => earlier(a.dueOn, b.dueOn))[0];
  if (fee === undefined) return null;
  const name = MEMBER_FEE_WORDS[fee.fee] ?? 'Fee';
  return { feeBillId: fee.id, amountMinor: fee.amountMinor, overdue: fee.state === 'overdue', dueOn: fee.dueOn, what: `${name} · ${feeForWords(fee)}`, canPay: fee.can.pay };
}

function paymentStep(held, canBill, readOnly) {
  const due = held.memberships
    .filter((m) => m.view.payment?.state === 'due')
    .sort((a, b) => earlier(a.view.payment.since ?? '9999-12-31', b.view.payment.since ?? '9999-12-31'));
  const m = due[0];
  if (m === undefined) return null;
  const more = due.length - 1;
  const moreLine = more === 0 ? null : more === 1 ? '1 more membership has a payment due.' : `${String(more)} more memberships have a payment due.`;
  const since = m.view.payment.since;
  const target = m.billing === null ? null : payTarget(m, held.today);
  if (target === null) {
    // A reader without the payments tick is told what is due and who can record it; the
    // Memberships box below says the same.
    return {
      kind: 'payment',
      membershipId: m.id,
      tone: 'warn',
      title: 'Payment due',
      detail: since === null ? m.typeName : `Since ${shortDay(since)} · ${m.typeName}`,
      note: [moreLine, canBill ? null : NO_PAYMENTS_LINE].filter((x) => x !== null).join(' ') || null,
      button: null,
    };
  }
  const amount = formatMinor(target.amountMinor, m.currency);
  const canPress = !readOnly && canBill && target.canPay !== false;
  return {
    kind: 'payment',
    membershipId: m.id,
    tone: target.overdue ? 'bad' : 'warn',
    title: target.overdue ? `${amount} overdue` : `${amount} due`,
    detail: `${target.overdue ? 'Overdue since' : 'Due'} ${shortDay(target.dueOn)} · ${target.what}`,
    note: moreLine,
    button: canPress ? { label: 'Record payment', ask: { what: 'pay', membershipId: m.id, feeBillId: target.feeBillId } } : null,
  };
}

function membershipStep(held, readOnly, managesTypes) {
  if (held.memberships.some((m) => IN_USE.has(m.view.status))) return null;
  const listed = held.listed ?? null;
  const detail = listed === null ? null : `Your member list says ${listed.word}.`;
  if (held.types.length === 0) {
    return { kind: 'membership', tone: 'warn', title: 'No membership', detail, note: managesTypes ? 'No memberships set up yet.' : 'No memberships set up yet. Ask the owner to set them up.', button: null, setUp: managesTypes && !readOnly };
  }
  return { kind: 'membership', tone: 'warn', title: 'No membership', detail, note: null, button: readOnly ? null : { label: 'Add membership', ask: { what: 'add' } } };
}

function agreementStep(held, readOnly) {
  const signable = (m) => !held.past && (m.view.status === 'active' || m.view.status === 'upcoming');
  const m = held.memberships.find((x) => agreementLineParts(x, x.agreementAsked === true, signable(x), () => '')?.signed === false);
  if (m === undefined) return null;
  return {
    kind: 'agreement',
    membershipId: m.id,
    tone: 'warn',
    title: 'Agreement not signed',
    detail: m.agreementLink != null ? `${m.typeName} · Link to sign emailed` : m.typeName,
    note: held.unsignedStopsBookings === true ? UNSIGNED_STOPS_LINE : null,
    button: readOnly ? null : { label: 'Sign agreement', ask: { what: 'agreement', membershipId: m.id } },
  };
}

function waiverStep(person, readOnly) {
  if (person.waiverInUse !== true || signedInApp(person) || person.waiverDesk != null) return null;
  return { kind: 'waiver', tone: 'warn', title: 'Waiver not signed', detail: null, note: null, button: readOnly ? null : { label: 'Sign waiver', ask: { what: 'waiver' } } };
}

const APP_BUTTONS = { invite: 'Invite to app', again: 'Send again', invite_again: 'Invite again' };

function appStep(action, readOnly) {
  const label = APP_BUTTONS[action];
  if (label === undefined) return null;
  return {
    kind: 'app',
    tone: 'plain',
    title: 'Not in the app',
    detail: action === 'invite' ? 'Not invited yet.' : 'Invited, not joined yet.',
    note: null,
    button: readOnly ? null : { label, ask: { what: 'app' } },
  };
}

/** The strip for the person whose page is open, or null while their memberships are not read
 *  (or were read for somebody else): it never says "Nothing due" before it knows.
 *  `inviteAction` is the page's own (`personInviteAction`), so the strip's button is the one
 *  beside the name. */
export function personNextStep({ held, person, inviteAction, canBill, readOnly, managesTypes }) {
  if (held === null || held === undefined || person === null || person === undefined) return null;
  if (held.entryId !== person.entryId) return null;
  const past = person.formerAt !== null || held.past;
  const steps = past
    ? [paymentStep(held, canBill, readOnly)]
    : [paymentStep(held, canBill, readOnly), membershipStep(held, readOnly, managesTypes), agreementStep(held, readOnly), waiverStep(person, readOnly), appStep(inviteAction, readOnly)];
  const step = steps.find((s) => s !== null);
  return step ?? { kind: 'none', tone: 'good', title: 'Nothing due', detail: null, note: null, button: null };
}
