// The Leads screen's small rules (ROADMAP 20c-i), apart from the components so they
// are tested on their own. Every count is the server's.
import { LEAD_SOURCES, LEAD_SOURCE_WORDS, LEAD_STATUSES, LEAD_STATUS_WORDS } from '@app/shared';

/** The chips over the list: All, then each status, with the server's counts. */
export function statusChips(counts) {
  const all = { key: 'all', label: 'All', count: counts?.all ?? 0 };
  return [all, ...LEAD_STATUSES.map((status) => ({ key: status, label: LEAD_STATUS_WORDS[status], count: counts?.[status] ?? 0 }))];
}

/** The page's query: a status of 'all' is no status. */
export function leadsQueryString({ status, query }, cursor = null) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  const q = query.trim();
  if (q !== '') params.set('q', q);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

export const SOURCE_CHOICES = LEAD_SOURCES.map((source) => ({ key: source, label: LEAD_SOURCE_WORDS[source] }));

/** The statuses staff tap; Joined has its own button. */
export const STATUS_CHOICES = ['new', 'contacted', 'on_trial', 'lost'].map((status) => ({
  key: status,
  label: LEAD_STATUS_WORDS[status],
}));

export const statusWord = (status) => LEAD_STATUS_WORDS[status] ?? status;
export const sourceWord = (source) => LEAD_SOURCE_WORDS[source] ?? source;

/** A lead's row line: how to reach them, then where they heard of the gym. */
export function leadLine(lead) {
  const contact = [lead.email, lead.phone].filter((part) => part !== null && part !== '').join(' · ');
  return [contact, sourceWord(lead.source)].filter((part) => part !== '').join(' · ');
}

/** "Added 3 Sep" (this year) or "Added 3 Sep 2025", in the viewer's own calendar. */
export function addedWords(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const sameYear = at.getFullYear() === now.getFullYear();
  const day = at.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `Added ${day}`;
}

export const emptyLeadDraft = () => ({ fullName: '', email: '', phone: '', source: '', notes: '', mayEmail: false });

export const leadDraft = (lead) => ({
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

/** The words beside the "Happy to hear from us" tick. */
export const MAY_EMAIL_LABEL = 'Happy to hear from us by email';
export const MAY_EMAIL_HINT = 'Tick only if they said yes. The follow-up emails go only to people who did.';

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
