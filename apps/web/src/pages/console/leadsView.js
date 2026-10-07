// The Leads screen's small rules (ROADMAP 20c-i), apart from the components so they
// are tested on their own. Every count is the server's.
import {
  LEAD_EMAIL_NOT_SENT_WORDS,
  LEAD_FOLLOW_UPS,
  LEAD_SOURCES,
  LEAD_SOURCE_WORDS,
  LEAD_STATUSES,
  LEAD_STATUS_WORDS,
  LEADS_TICKED_MAX,
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
export function leadsQueryString({ status, query, due = false, problem = false }, cursor = null) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (due) params.set('followUp', 'due');
  else if (problem) params.set('followUp', 'problem');
  const q = query.trim();
  if (q !== '') params.set('q', q);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

// ── The leads selected (20c-vii) ──

/** What "Select all" means: the list's status, chip and search, without the page's place. */
export function leadsSelectionFilter({ status, query, due = false, problem = false }) {
  const out = {};
  if (status !== 'all') out.status = status;
  if (due) out.followUp = 'due';
  else if (problem) out.followUp = 'problem';
  const q = query.trim();
  if (q !== '') out.q = q;
  return out;
}

/** The selection a press sends: the rows ticked, or everyone "Select all" chose with the
 *  count and digest the server gave. Null when nobody is selected. */
export function leadSelectionOf(ticked, all) {
  if (all !== null) return { kind: 'all', filter: all.filter, count: all.count, digest: all.digest };
  if (ticked.size === 0) return null;
  return { kind: 'ticked', leadIds: [...ticked] };
}

/** The rows the heading's box ticks (every row loaded, up to the most that can be ticked one
 *  by one), and whether they are all ticked (or everyone, after Select all). */
export function leadsPageTickState(loadedIds, ticked, all) {
  const pageIds = loadedIds.slice(0, LEADS_TICKED_MAX);
  const pageTicked = all !== null || (pageIds.length > 0 && pageIds.every((id) => ticked.has(id)));
  return { pageIds, pageTicked };
}

const leadsWord = (k) => `${k.toLocaleString('en')} ${k === 1 ? 'lead' : 'leads'}`;

/** The Delete box's title: "Delete 37 leads?". */
export function deleteTitle(preview) {
  return preview === null || preview.leads.length === 0 ? 'Delete leads' : `Delete ${leadsWord(preview.leads.length)}?`;
}

/** What goes with them, and what doesn't. */
export function deleteLine(words) {
  return `Their names, contact details, notes and the messages they sent you are deleted. This can't be undone. Your list of ${words.people} doesn't change.`;
}

/** Selected, but deleted already (by a colleague, say): nothing to do for them. */
export function deleteGoneLine(gone) {
  if (gone === 0) return null;
  return gone === 1 ? '1 lead you selected was already deleted.' : `${gone.toLocaleString('en')} leads you selected were already deleted.`;
}

/** After the press. */
export function deletedLine(done) {
  if (done.alreadyDeleted) return `${leadsWord(done.deleted)} ${done.deleted === 1 ? 'was' : 'were'} already deleted.`;
  return `${leadsWord(done.deleted)} deleted.`;
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
export const MAY_EMAIL_HINT = "Tick only if they said yes. They're due 3 follow-up emails over a week.";

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

/** Under a follow-up the app will send: when, and where replies go. The screen puts a
 *  button to that box in Settings under it (`notePlace`), for whoever may open it. */
export const SENT_FOR_YOU_NOTE = 'Sent for you from 8 in the morning, by your clock. Replies go to your reply address.';

/** Under one the app is waiting to send. */
export const WAITING_FOR_YOU_NOTE = "We'll keep trying. If it can't go within a week, it comes back to you here.";

/** An address nobody can email, said as it is whoever sends the next one: a gym whose
 *  emails through the app are stopped or off still learns the address is dead. */
export const ADDRESS_NOTES = {
  bounced: 'Emails to this address bounce. Check the address with them.',
  refused: "Our email service won't send to this address. Check the address with them.",
};

/** What the lead's follow-up box says, or null when there is nothing to say: a lead
 *  who never said yes and has had none. `next` is the step staff may send now, or null;
 *  `note` a line under it: the app sends it, or why the app did not. Whenever the lead's
 *  address cannot be emailed, that is the note, and the box shows even with nothing
 *  else to say: the list tags such a lead, so opening it always explains the tag (20c-v-b). */
export function followUpState(lead, now = new Date()) {
  const story = followUpStory(lead, now);
  const addressNote = ADDRESS_NOTES[lead.emailProblem] ?? null;
  if (addressNote === null) return story;
  if (story === null) return { next: null, headline: addressNote, due: false, sentLine: null, note: null };
  return { ...story, note: addressNote };
}

function followUpStory(lead, now) {
  const f = lead.followUp;
  if (f === undefined || f === null) return null;
  const sentLine = f.sent === 0 ? null : `${f.sent} of ${LEAD_FOLLOW_UPS} sent${lastSentWords(f.lastSentAt, now)}.`;
  // The server says when one is due; only a New lead with the tick is ever offered one.
  if (f.dueOn !== null && lead.status === 'new' && lead.mayEmail) {
    const step = f.sent + 1;
    const of = `Email ${step} of ${LEAD_FOLLOW_UPS}`;
    // The app sends it: nothing for staff to press. The server says when.
    if (f.by === 'app') {
      if (f.appWhen === 'waiting') {
        const due = f.overdue ? dueDayWords(f.dueOn) : 'today';
        return { next: null, headline: `${of} is waiting to be sent for you (due ${due})`, due: false, sentLine, note: WAITING_FOR_YOU_NOTE };
      }
      const headline = !f.dueNow
        ? `${of} will be sent for you on ${dueDayWords(f.dueOn)}`
        : f.appWhen === 'tomorrow'
          ? `${of} will be sent for you tomorrow morning`
          : `${of} will be sent for you today`;
      return { next: null, headline, due: false, sentLine, note: SENT_FOR_YOU_NOTE, notePlace: 'leadEmails' };
    }
    const headline = f.overdue ? `${of} was due ${dueDayWords(f.dueOn)}` : f.dueNow ? `${of} is due today` : `${of} is due ${dueDayWords(f.dueOn)}`;
    const note = f.notSent
      ? (ADDRESS_NOTES[f.notSent] ?? `Not sent for you: ${LEAD_EMAIL_NOT_SENT_WORDS[f.notSent] ?? LEAD_EMAIL_NOT_SENT_WORDS.could_not_send}.`)
      : null;
    // Before its day it is only announced: nothing to send yet.
    return { next: f.dueNow ? step : null, headline, due: f.dueNow, sentLine, note };
  }
  if (f.sent >= LEAD_FOLLOW_UPS) return { next: null, headline: `All ${LEAD_FOLLOW_UPS} follow-up emails sent`, due: false, sentLine, note: null };
  const optedOut = !lead.mayEmail && Boolean(f.optedOutAt);
  if (f.sent === 0 && !lead.mayEmail && !optedOut) return null;
  if (f.sent === 0 && lead.status === 'new' && lead.mayEmail) return null;
  const why = optedOut
    ? LEAD_EMAIL_NOT_SENT_WORDS[f.optedOutHow === 'complained' ? 'complained' : 'unsubscribed']
    : !lead.mayEmail
      ? 'the "Happy to hear from us" tick is off'
      : `they're marked ${statusWord(lead.status)}`;
  return { next: null, headline: `Follow-up emails stopped: ${why}`, due: false, sentLine, note: null };
}

/** The row's "Email due" tag: due now, and staff's to send. */
export const showsEmailDue = (lead) => Boolean(lead.followUp?.dueNow) && lead.followUp?.by !== 'app';

/** The toggle beside the status chips. */
export const DUE_CHIP_LABEL = 'Email due';

/** The chip for New leads whose address emails can't reach or who marked an email as
 *  spam (20c-v-b), and each such row's tag: found on the list, not lead by lead. */
export const PROBLEM_CHIP_LABEL = 'Email problems';
export const EMAIL_PROBLEM_TAG = { bounced: 'Email bounces', refused: "Can't be emailed", complained: 'Marked as spam' };

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
