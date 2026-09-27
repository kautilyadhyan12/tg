// The Leads screen's small rules (ROADMAP 20c-i), apart from the components so they
// are tested on their own. Every count is the server's.
import { LEAD_FOLLOW_UPS, LEAD_SOURCES, LEAD_SOURCE_WORDS, LEAD_STATUSES, LEAD_STATUS_WORDS } from '@app/shared';

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
export const MAY_EMAIL_HINT = "Tick only if they said yes. We'll remind you to email them 3 times over a week.";

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

// ── FOLLOW-UP EMAILS (20c-ii; RULINGS 2026-09-27) ─────────────────────────────
// The gym sends each from its own mailbox: "Email Priya" opens the gym's email
// program with the words written, and staff press Send there. Nothing goes through us.

/** "Tue 30 Sept", for a YYYY-MM-DD day of the gym's. */
export function dueDayWords(day) {
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const firstName = (fullName) => fullName.trim().split(/\s+/)[0] ?? '';

/** Where the gym is, for the end of each email: its postal address, else its city. */
function gymSignature(gym) {
  const where = (gym.postalAddress ?? '').trim() || (gym.city ?? '').trim();
  return where === '' ? gym.name : `${gym.name}\n${where}`;
}

/** Follow-up email `step` (1, 2 or 3) to this lead, from this gym. */
export function followUpEmail(step, lead, gym) {
  const hi = firstName(lead.fullName) === '' ? 'Hi,' : `Hi ${firstName(lead.fullName)},`;
  const end = gymSignature(gym);
  const letters = {
    1: {
      subject: `Thanks for asking about ${gym.name}`,
      lines: [
        `Thanks for asking about ${gym.name}. We'd love to show you around.`,
        'Come in any time we are open, or reply to this email with any questions.',
      ],
    },
    2: {
      subject: `Come and see us at ${gym.name}`,
      lines: [
        'Just checking in. Would you like to come in for a look around, or try a session?',
        "Reply with a day that suits you and we'll have it ready.",
      ],
    },
    3: {
      subject: `Still thinking about ${gym.name}?`,
      lines: [
        "This is our last note, so we won't fill your inbox.",
        "If you'd like to join or have a question, just reply. We'd be glad to see you.",
      ],
    },
  };
  const letter = letters[step];
  if (letter === undefined) return null;
  const body = [hi, ...letter.lines, end].join('\n\n');
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

/** What the lead's follow-up box says, or null when there is nothing to say: a lead
 *  who never said yes and has had none. `next` is the step due, or null. */
export function followUpState(lead, now = new Date()) {
  const f = lead.followUp;
  if (f === undefined || f === null) return null;
  const sentLine = f.sent === 0 ? null : `${f.sent} of ${LEAD_FOLLOW_UPS} sent${lastSentWords(f.lastSentAt, now)}.`;
  if (f.dueOn !== null) {
    const step = f.sent + 1;
    return {
      next: step,
      headline: f.dueNow ? `Email ${step} of ${LEAD_FOLLOW_UPS} is due today` : `Email ${step} of ${LEAD_FOLLOW_UPS} is due ${dueDayWords(f.dueOn)}`,
      due: f.dueNow,
      sentLine,
    };
  }
  if (f.sent >= LEAD_FOLLOW_UPS) return { next: null, headline: `All ${LEAD_FOLLOW_UPS} follow-up emails sent`, due: false, sentLine };
  if (f.sent === 0 && !lead.mayEmail) return null;
  if (f.sent === 0 && lead.status === 'new') return null;
  const why = !lead.mayEmail
    ? lead.email === null
      ? 'they have no email address'
      : "they haven't said yes to email at this address"
    : `they're marked ${statusWord(lead.status)}`;
  return { next: null, headline: `Follow-up emails stopped: ${why}`, due: false, sentLine };
}

/** The toggle beside the status chips. */
export const DUE_CHIP_LABEL = 'Email due';
