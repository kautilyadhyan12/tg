// CHANGE MEMBERSHIP, its words (spec Part 3 §14.8; ROADMAP 18x). Pure, so the tests read every
// case without a browser. What a change today takes off is the server's (`billing.change`,
// worked out by `changeFrom` in `@app/shared`); which way the chosen type can go is the same
// shared rule the server checks again (`changeTo`), so the box never offers what the server
// refuses. A cheaper move today would leave money over: it waits for the next payment date
// (Kd, 2026-10-22, "go B").
import { MEMBERSHIP_CHANGE_WORDS, addDays, changeTo, formatMinor } from '@app/shared';
import { dayWords } from './memberListView';
import { changeSummary } from './sellDiscountsView';
import { newRequestKey } from './heldMembershipsView';

/** The reasons the box opens only to say why, with what to do instead. */
const SAID_IN_BOX = ['unpaid', 'frozen'];

/** Whether a membership shows Change membership: in use, read by staff who record payments,
 *  and either it can be changed or the box says what to do first. */
export function showsChange(m) {
  const c = m?.billing?.change ?? null;
  if (c === null) return false;
  return c.ok || SAID_IN_BOX.includes(c.reason);
}

/** The types a membership can be changed to: a repeating or paid-once type that is not its own. */
export function changeTargets(types, m) {
  return types.filter((t) => (t.kind === 'recurring' || t.kind === 'one_time') && t.id !== m.typeId);
}

/** The box as it opens: nothing picked, today. */
export function changeForm(types, m) {
  const targets = changeTargets(types, m);
  return { requestKey: newRequestKey(), typeId: targets.length === 1 ? targets[0].id : '', when: 'today', paid: false, method: '' };
}

/** THE BOX, worked out as staff choose. `blocked`: the one sentence where it cannot be changed
 *  yet. Otherwise the two ways it can go, which is picked, the lines of the total and whether
 *  it is ready to send. `name` is the person; `today` the gym's own day. */
export function changeChoice(m, types, form, taxIncluded, today, name) {
  const c = m.billing?.change ?? null;
  if (c === null) return { blocked: MEMBERSHIP_CHANGE_WORDS.not_changeable };
  if (!c.ok) return { blocked: MEMBERSHIP_CHANGE_WORDS[c.reason] ?? MEMBERSHIP_CHANGE_WORDS.not_changeable, reason: c.reason };
  const targets = changeTargets(types, m);
  const type = targets.find((t) => t.id === form.typeId) ?? null;
  const base = { blocked: null, targets, type, options: [], when: null, summary: null, paidLabel: null, ready: false, methodNeeded: false };
  if (type === null) return base;

  const money = (minor) => formatMinor(minor, m.currency);
  const now = changeTo(c, m.typeId, type, 'today', today);
  const later = changeTo(c, m.typeId, type, 'next_payment', today);
  const days = c.daysLeft === 1 ? '1 day' : `${String(c.daysLeft)} days`;
  const todayDetail = now.ok
    ? now.creditMinor > 0
      ? `${m.typeName} ends today. The ${days} left of what ${name} paid for, ${money(now.creditMinor)}, come off the first payment.`
      : `${m.typeName} ends today and ${type.name} starts.`
    : MEMBERSHIP_CHANGE_WORDS[now.reason];
  const options = [{ value: 'today', label: `Today, ${dayWords(today)}`, ok: now.ok, detail: todayDetail }];
  if (c.nextOn !== null) {
    options.push({
      value: 'next_payment',
      label: `${m.kind === 'recurring' ? 'On the next payment date' : 'When it ends'}, ${dayWords(c.nextOn)}`,
      ok: later.ok,
      detail: later.ok ? `${m.typeName} runs to ${dayWords(addDays(c.nextOn, -1))}, then ${type.name} starts. Nothing is charged for ${type.name} before then.` : MEMBERSHIP_CHANGE_WORDS[later.reason],
    });
  }
  // The way staff picked, or the one that can go where the other cannot.
  const usable = options.filter((o) => o.ok).map((o) => o.value);
  const when = usable.includes(form.when) ? form.when : (usable[0] ?? null);
  const picked = when === 'today' ? now : when === 'next_payment' ? later : null;
  if (picked === null || !picked.ok) return { ...base, options, when };
  const summary = changeSummary(type, picked.creditMinor, m.typeName, taxIncluded);
  // Paid now only for what is charged today; a later start is paid on its day.
  const paidLabel = when === 'today' && summary !== null && summary.totalMinor > 0 ? `They have paid the ${summary.total}` : null;
  const methodNeeded = paidLabel !== null && form.paid === true && (form.method ?? '') === '';
  return { ...base, options, when, picked, summary, paidLabel, methodNeeded, ready: summary !== null && !methodNeeded };
}

/** What the server is sent: what the screen showed, worked out again there. */
export function changeBody(form, choice) {
  const paid = choice.paidLabel !== null && form.paid === true;
  return {
    requestKey: form.requestKey,
    typeId: choice.type.id,
    when: choice.when,
    priceMinor: choice.type.priceMinor,
    creditMinor: choice.picked.creditMinor,
    totalMinor: choice.summary.totalMinor,
    paid,
    ...(paid ? { method: form.method } : {}),
  };
}

/** Said when it is done, in one sentence. */
export function changeDoneWords(m, choice) {
  if (choice.when === 'today') return `${m.typeName} is changed to ${choice.type.name}.`;
  return `${choice.type.name} starts ${dayWords(choice.picked.startsOn)}, when ${m.typeName} ends.`;
}

/** The line on a membership that was changed, or was changed from another; null for neither.
 *  `today` is the gym's own day. */
export function changeLine(m, today) {
  if (m.changedTo !== null && m.changedTo !== undefined) {
    const on = dayWords(m.changedTo.startsOn);
    return m.changedTo.startsOn > today ? `Changes to ${m.changedTo.typeName} on ${on}` : `Changed to ${m.changedTo.typeName} on ${on}`;
  }
  if (m.changedFrom !== null && m.changedFrom !== undefined) return `Changed from ${m.changedFrom.typeName}`;
  return null;
}

/** The box that asks before a change ends classes the new membership does not cover. */
export function changeEndingWords(ending, m, name, typeName) {
  const n = ending?.booked ?? 0;
  const sessions = ending?.ptSessions?.count ?? 0;
  const bookings = n === 1 ? '1 booking' : `${n.toLocaleString('en')} bookings`;
  const pt = sessions === 1 ? '1 session' : `${sessions.toLocaleString('en')} sessions`;
  const what = sessions === 0 ? bookings : n === 0 ? pt : `${bookings} and ${pt}`;
  return {
    title: `${name} has ${what} that ${typeName} doesn't cover`,
    kept: `Everything ${typeName} covers moves to it and stays booked.`,
    button: `Change membership and end ${what}`,
  };
}

/** A bill's line for the unused days taken off it (18x); null where none were. */
export function changeCreditLine(bill, m) {
  if (!(bill.changeCreditMinor > 0)) return null;
  const from = m.changedFrom?.typeName ?? 'their earlier membership';
  return `${formatMinor(bill.changeCreditMinor, m.currency)} off for the unused days of ${from}`;
}
