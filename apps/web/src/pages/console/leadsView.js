// The Leads screen's small rules (ROADMAP 20c-i), apart from the components so they
// are tested on their own. Every count is the server's.
import {
  LEAD_EMAIL_NOT_SENT_WORDS,
  LEAD_FOLLOW_UPS,
  LEAD_SOURCES,
  LEAD_SOURCE_WORDS,
  LEAD_STATUSES,
  LEAD_STATUS_WORDS,
  leadFirstName,
  leadFollowUpLetter,
  leadGreeting,
} from '@app/shared';

/** The chips over the list: All, then each status, with the server's counts. */
export function statusChips(counts) {
  const all = { key: 'all', label: 'All', count: counts?.all ?? 0 };
  return [all, ...LEAD_STATUSES.map((status) => ({ key: status, label: LEAD_STATUS_WORDS[status], count: counts?.[status] ?? 0 }))];
}

/** The page's query: a status of 'all' is no status; `due` keeps only leads due a
 *  follow-up email. */
export function leadsQueryString({ status, query, due = false }, cursor = null) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (due) params.set('followUp', 'due');
  const q = query.trim();
  if (q !== '') params.set('q', q);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

export const SOURCE_CHOICES = LEAD_SOURCES.map((source) => ({ key: source, label: LEAD_SOURCE_WORDS[source] }));

/** The statuses Save sets; Joined runs the Joined button's own step. */
export const STATUS_CHOICES = ['new', 'contacted', 'on_trial', 'lost'].map((status) => ({
  key: status,
  label: LEAD_STATUS_WORDS[status],
}));

export const statusWord = (status) => LEAD_STATUS_WORDS[status] ?? status;
export const sourceWord = (source) => LEAD_SOURCE_WORDS[source] ?? source;

/** The day a lead was added, in the viewer's own calendar: "Today", "Yesterday",
 *  "3 Sept" (this year) or "3 Sept 2025". */
export function addedDay(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((day(now) - day(at)) / 86_400_000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  const sameYear = at.getFullYear() === now.getFullYear();
  return at.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Added today", "Added yesterday", "Added 3 Sept". */
export function addedWords(iso, now = new Date()) {
  const day = addedDay(iso, now);
  if (day === '') return '';
  return `Added ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
}

/** Each status's tag, as the drawing colours it. */
export const STATUS_TAG = { new: 'c-tag-soft', contacted: 'c-tag-plain', on_trial: 'c-tag-warn', joined: 'c-tag-good', lost: 'c-tag-plain' };

export const emptyLeadDraft = () => ({ fullName: '', email: '', phone: '', source: '', notes: '', mayEmail: false });

/** Whether anything has been typed or picked on Add lead. */
export const draftStarted = (draft) =>
  [draft.fullName, draft.email, draft.phone, draft.notes].some((v) => v.trim() !== '') || draft.source !== '' || draft.mayEmail;

export const leadDraft = (lead) => ({
  status: lead.status,
  fullName: lead.fullName,
  email: lead.email ?? '',
  phone: lead.phone ?? '',
  source: lead.source,
  notes: lead.notes,
  mayEmail: lead.mayEmail,
});

/** What stops a save before it is sent, in the screen's words; null when it can go.
 *  The server checks everything again and its sentence wins. */
export function leadProblem(draft) {
  if (draft.fullName.trim() === '') return "Add the person's name.";
  if (draft.email.trim() === '' && draft.phone.trim() === '') return 'Add an email address or a phone number, so you can reach them.';
  if (draft.source === '') return 'Choose where they heard of you.';
  return null;
}

/** A new lead's body: empty boxes are left out. */
export function createLeadRequest(draft) {
  const body = { fullName: draft.fullName.trim(), source: draft.source };
  if (draft.email.trim() !== '') body.email = draft.email.trim();
  if (draft.phone.trim() !== '') body.phone = draft.phone.trim();
  if (draft.notes.trim() !== '') body.notes = draft.notes.trim();
  if (draft.mayEmail && body.email !== undefined) body.mayEmail = true;
  return body;
}

/** A change's body: only what moved; an emptied email or phone is null. */
export function updateLeadRequest(lead, draft) {
  const body = {};
  if (draft.fullName.trim() !== lead.fullName) body.fullName = draft.fullName.trim();
  const email = draft.email.trim() === '' ? null : draft.email.trim();
  if (email !== lead.email) body.email = email;
  const phone = draft.phone.trim() === '' ? null : draft.phone.trim();
  if (phone !== lead.phone) body.phone = phone;
  if (draft.source !== lead.source) body.source = draft.source;
  if (draft.notes.trim() !== lead.notes) body.notes = draft.notes.trim();
  return body;
}

/** What Save sends for an open lead: the status, details and email tick that moved,
 *  without the notes, which save on their own. A tick needs an address, so an emptied
 *  email sends no tick. */
export function detailsRequest(lead, draft) {
  const body = updateLeadRequest(lead, draft);
  delete body.notes;
  if (draft.status !== lead.status) body.status = draft.status;
  const mayEmail = draft.mayEmail && draft.email.trim() !== '';
  if (mayEmail !== lead.mayEmail) body.mayEmail = mayEmail;
  return body;
}

/** The words beside the "Happy to hear from us" tick. */
export const MAY_EMAIL_LABEL = 'Happy to hear from us by email';
export const MAY_EMAIL_HINT = "Tick only if they said yes. They'll get 3 follow-up emails over a week.";

/** What Joined did, in one sentence. */
export function joinedWords(outcome, name, words) {
  if (outcome === 'added') return `${name} is on your list of ${words.people} now.`;
  if (outcome === 'restored') return `${name}'s record is back on your list of ${words.people}.`;
  if (outcome === 'already_joined') return `${name} was already on your list.`;
  return `${name} is on your list of ${words.people}, as the record that was already there.`;
}

/** One record to choose from: its name (or "No name") and how to reach it. */
export function candidateLine(candidate) {
  return [candidate.email, candidate.phone].filter((part) => part !== null && part !== '').join(' · ');
}

// ── FOLLOW-UP EMAILS (20c-ii, 20c-v; RULINGS 2026-09-27) ──────────────────────
// The gym sends each from its own mailbox: "Email Priya" opens the gym's email
// program with the words written, and staff press Send there. With "Send them for me"
// on in Settings, the app sends them instead, for up to 100 new leads a month; the
// server says which lead's next one is whose (`followUp.by`).

/** "Tue 30 Sept", for a YYYY-MM-DD day of the gym's. */
export function dueDayWords(day) {
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Where the gym is, for the end of each email: its postal address, else its city. */
function gymSignature(gym) {
  const where = (gym.postalAddress ?? '').trim() || (gym.city ?? '').trim();
  return where === '' ? gym.name : `${gym.name}\n${where}`;
}

/** Follow-up email `step` (1, 2 or 3) to this lead, from this gym: the same letter the
 *  app sends when it sends them (`leadFollowUpLetter`). */
export function followUpEmail(step, lead, gym) {
  const letter = leadFollowUpLetter(step, gym.name);
  if (letter === null) return null;
  const body = [leadGreeting(leadFirstName(lead.fullName)), ...letter.lines, gymSignature(gym)].join('\n\n');
  const href = `mailto:${encodeURIComponent(lead.email ?? '')}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(body)}`;
  return { subject: letter.subject, body, href };
}

/** ", the last today", ", the last yesterday", ", the last on 3 Sept". */
function lastSentWords(iso, now) {
  if (iso === null) return '';
  const day = addedDay(iso, now);
  if (day === '') return '';
  return `, the last ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`}`;
}

/** Under a follow-up the app will send: when, and where replies go. */
export const SENT_FOR_YOU_NOTE = 'Sent for you from 8 in the morning, by your clock. Replies go to the address in Settings.';

/** What the lead's follow-up box says, or null when there is nothing to say: a lead
 *  who never said yes and has had none. `next` is the step staff may send now, or null;
 *  `note` a line under it: the app sends it, or why the app did not. */
export function followUpState(lead, now = new Date()) {
  const f = lead.followUp;
  if (f === undefined || f === null) return null;
  const sentLine = f.sent === 0 ? null : `${f.sent} of ${LEAD_FOLLOW_UPS} sent${lastSentWords(f.lastSentAt, now)}.`;
  // The server says when one is due; only a New lead with the tick is ever offered one.
  if (f.dueOn !== null && lead.status === 'new' && lead.mayEmail) {
    const step = f.sent + 1;
    const of = `Email ${step} of ${LEAD_FOLLOW_UPS}`;
    // The app sends it: nothing for staff to press.
    if (f.by === 'app') {
      const headline = f.dueNow ? `${of} will be sent for you today` : `${of} will be sent for you on ${dueDayWords(f.dueOn)}`;
      return { next: null, headline, due: false, sentLine, note: SENT_FOR_YOU_NOTE };
    }
    const headline = f.overdue ? `${of} was due ${dueDayWords(f.dueOn)}` : f.dueNow ? `${of} is due today` : `${of} is due ${dueDayWords(f.dueOn)}`;
    const note = f.notSent ? `Not sent for you: ${LEAD_EMAIL_NOT_SENT_WORDS[f.notSent] ?? LEAD_EMAIL_NOT_SENT_WORDS.could_not_send}.` : null;
    // Before its day it is only announced: nothing to send yet.
    return { next: f.dueNow ? step : null, headline, due: f.dueNow, sentLine, note };
  }
  if (f.sent >= LEAD_FOLLOW_UPS) return { next: null, headline: `All ${LEAD_FOLLOW_UPS} follow-up emails sent`, due: false, sentLine, note: null };
  const optedOut = !lead.mayEmail && Boolean(f.optedOutAt);
  if (f.sent === 0 && !lead.mayEmail && !optedOut) return null;
  if (f.sent === 0 && lead.status === 'new' && lead.mayEmail) return null;
  const why = optedOut
    ? LEAD_EMAIL_NOT_SENT_WORDS.unsubscribed
    : !lead.mayEmail
      ? 'the "Happy to hear from us" tick is off'
      : `they're marked ${statusWord(lead.status)}`;
  return { next: null, headline: `Follow-up emails stopped: ${why}`, due: false, sentLine, note: null };
}

/** The row's "Email due" tag: due now, and staff's to send. */
export const showsEmailDue = (lead) => Boolean(lead.followUp?.dueNow) && lead.followUp?.by !== 'app';

/** The toggle beside the status chips. */
export const DUE_CHIP_LABEL = 'Email due';

/** The tag on a lead who sent the form on the gym's own page (20c-iv-a). */
export const FROM_PAGE_TAG = 'From your page';

/** One message from the gym page's form, as the lead's panel lists it: when, then what
 *  the person typed that time, which may differ from the lead's own details. */
export function enquiryLines(enquiry) {
  const contact = [enquiry.email, enquiry.phone].filter(Boolean).join(' · ');
  const said = [];
  if (enquiry.source) said.push(`Heard of you from: ${sourceWord(enquiry.source)}`);
  if (enquiry.mayEmail) said.push('Happy to hear from you by email');
  return {
    when: addedDay(enquiry.createdAt),
    who: contact === '' ? enquiry.fullName : `${enquiry.fullName} · ${contact}`,
    said,
    message: enquiry.message,
  };
}
