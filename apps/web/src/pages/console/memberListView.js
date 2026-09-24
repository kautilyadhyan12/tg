// The member import's plain helpers (ROADMAP 5a; spec Part 3 §9.14, §11.2–§11.3):
// which column holds what, what the review shows, and its short words. No React
// here, so each rule is tested on its own.
import { MEMBER_LIST_FIELD_WORDS, memberListFieldSchema } from '@app/shared';

export const FIELDS = memberListFieldSchema.options;
const LIST_FIELDS = ['email', 'phone'];

/** Each field as the column dropdown names it. */
export const FIELD_LABELS = {
  fullName: 'Name',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  memberNumber: 'Member number',
  status: 'Status',
  membershipType: 'Membership',
  joinedOn: 'Join date',
  endsOn: 'End or renewal date',
  paymentStatus: 'Payment status',
  dateOfBirth: 'Date of birth',
};

// ── Columns ─────────────────────────────────────────────────────────────────

/** What a column is used for in a mapping: a field name, 'extra' (kept as the gym's
 *  own column) or 'dontKeep'. */
export function roleOfColumn(mapping, index) {
  for (const field of FIELDS) {
    const value = mapping[field];
    if (LIST_FIELDS.includes(field) ? value.includes(index) : value === index) return field;
  }
  return mapping.dontKeep.includes(index) ? 'dontKeep' : 'extra';
}

/** The mapping with one column moved to `role`. A single field that held another
 *  column gives it up, and that column becomes one of the gym's own. */
export function withColumnRole(mapping, index, role) {
  // The same answer again keeps the column's place among several email columns.
  if (roleOfColumn(mapping, index) === role) return mapping;
  const next = { ...mapping, dontKeep: mapping.dontKeep.filter((i) => i !== index) };
  for (const field of FIELDS) {
    if (LIST_FIELDS.includes(field)) {
      next[field] = mapping[field].filter((i) => i !== index);
    } else if (mapping[field] === index) {
      next[field] = null;
    }
  }
  if (role === 'dontKeep') next.dontKeep = [...next.dontKeep, index];
  else if (LIST_FIELDS.includes(role)) next[role] = [...next[role], index];
  else if (role !== 'extra') next[role] = index;
  return next;
}

/** The mapping with one date column read the other way round. */
export function withDateOrder(mapping, column, order) {
  return { ...mapping, dateOrder: [...mapping.dateOrder.filter((d) => d.column !== column), { column, order }] };
}

export function sameMapping(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function columnName(column) {
  return column.header ?? `Column ${String(column.index + 1)}`;
}

/** A column whose heading named a field its cells did not bear out: staff should look. */
export function disbelieved(column) {
  return column.neverKept === null && column.headerSays !== null && column.guess === null;
}

/** Columns that will be imported, under a field or as the gym's own. */
export function importedColumnCount(columns, mapping) {
  return columns.filter((c) => c.neverKept === null && roleOfColumn(mapping, c.index) !== 'dontKeep').length;
}

const NEVER_KEPT_TITLES = {
  payment_card: 'Card numbers not imported',
  bank_details: 'Bank details not imported',
  government_id: 'ID numbers not imported',
  password_or_pin: 'Passwords and PINs not imported',
  medical: 'Health notes not imported',
};

/** Columns we never keep, one line per reason, each naming its columns. */
export function neverKeptLines(columns) {
  const byReason = new Map();
  for (const c of columns) {
    if (c.neverKept === null) continue;
    byReason.set(c.neverKept, [...(byReason.get(c.neverKept) ?? []), columnName(c)]);
  }
  return [...byReason].map(([reason, names]) => ({ reason, title: NEVER_KEPT_TITLES[reason], columns: names.join(', ') }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-04-03" → "3 April 2026". */
export function dayWords(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${String(d)} ${MONTHS[m - 1]} ${String(y)}`;
}

/** Date columns whose day-or-month order nothing in the file settled (the gym's
 *  country decided, or staff swapped it), so the review shows one example to check. */
export function datesToCheck(preview) {
  return preview.dateColumns
    .filter((d) => d.example !== null && (d.from === 'country' || d.from === 'chosen'))
    .map((d) => ({
      column: d.column,
      order: d.order,
      example: `${d.example.raw} = ${dayWords(d.example.read)}`,
      columnName: columnName(preview.columns.find((c) => c.index === d.column) ?? { header: null, index: d.column }),
    }));
}

// ── What the review shows ───────────────────────────────────────────────────

const count = (n) => n.toLocaleString('en');
const of = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`;

export function peopleWord(n, words) {
  return n === 1 ? words.person : words.people;
}

/** The numbers worth showing: one big number for a list of only new people, tiles for
 *  new and updated together, and nothing for a group of nobody. People missing from
 *  the file are never a tile: the question about them names them (`missingOf`). */
export function summaryOf(preview) {
  const { list } = preview;
  const tiles = [];
  if (list.new > 0) tiles.push({ group: 'new', n: list.new, label: 'New' });
  if (list.changed > 0) tiles.push({ group: 'changed', n: list.changed, label: 'Updated' });
  const onlyNew = tiles.length === 1 && tiles[0].group === 'new';
  return { tiles, hero: onlyNew ? list.new : null, nothing: tiles.length === 0, unchanged: list.unchanged };
}

/** People on the gym's list that a whole-list file leaves out — the one question the
 *  review asks, and only when it arises. Null when nobody would come off. */
export function missingOf(preview) {
  if (preview.mode !== 'whole_list') return null;
  const { list, members, guard } = preview;
  const n = list.gone > 0 ? list.gone : members.leaving > 0 ? members.leaving : guard.needsTick ? guardNumber(guard) : 0;
  if (n === 0) return null;
  // Kept with the answer: after "They're still members" the file is read again as
  // people to add, and that preview no longer knows who was missing or how many.
  const statuses = preview.statuses.filter((s) => s.gone > 0).map((s) => ({ label: s.label, n: s.gone }));
  // WHOSE NAMES the question shows: the list's own people coming off, or — where none
  // are — the app members who would no longer be on the list, who are a different group
  // and are not moved to past members by anything.
  const group = list.gone > 0 ? 'gone' : 'members_leaving';
  return { n, listSize: guard.listSize, needsTick: guard.needsTick, statuses, group };
}

/** The gym's own status words of the people missing from the file: "Frozen 5 · Active 1".
 *  An export of only the Active members leaves out every Frozen one, and this is where
 *  staff see it before answering. */
export function missingStatusLine(missing) {
  return missing.statuses.map((s) => `${s.label} ${count(s.n)}`).join(' · ');
}

/** The question's heading: "5 members aren't in this file", or, where the wrong-file
 *  check is asking, "25 of your 30 members aren't in this file". */
export function missingTitle(missing, needsTick, words) {
  const verb = missing.n === 1 ? "isn't" : "aren't";
  if (missing.group === 'members_leaving') {
    return `${count(missing.n)} ${missing.n === 1 ? `${words.person} who uses` : `${words.people} who use`} the app ${verb} in this file`;
  }
  if (needsTick && missing.listSize > missing.n) {
    return `${count(missing.n)} of your ${count(missing.listSize)} ${words.people} ${verb} in this file`;
  }
  return `${of(missing.n, words.person, words.people)} ${verb} in this file`;
}

/** "Ben Cole, Amy Shaw, Raj Patel and 2 more". */
export function someNames(names, total) {
  if (names.length === 0) return '';
  const more = total - names.length;
  return more > 0 ? `${names.join(', ')} and ${count(more)} more` : names.join(', ');
}

/** The number staff type to let a large change through: the people coming off the
 *  list, or, where none are, the app members who would read "no longer on your list". */
export function guardNumber(guard) {
  return guard.entriesGoing > 0 ? guard.entriesGoing : guard.membersLeaving;
}

/** True only when what was typed is that number, written with or without commas. */
export function typedMatches(typed, guard) {
  const digits = typed.replace(/[,\s]/g, '');
  return /^\d+$/.test(digits) && Number(digits) === guardNumber(guard);
}

/** The one line above a group's names. */
export function groupNote(preview, group, words) {
  const { list } = preview;
  if (group === 'new') {
    return [
      list.alreadyInApp > 0 ? `${count(list.alreadyInApp)} already use the app` : null,
      list.noEmail > 0 ? `${count(list.noEmail)} have no email` : null,
      list.returning > 0 ? `${count(list.returning)} were ${words.people} before` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (group === 'changed') {
    return [
      ...preview.fieldChanges.map((c) => `${MEMBER_LIST_FIELD_WORDS[c.field]} ${count(c.count)}`),
      ...preview.extraChanges.map((c) => `${c.label} ${count(c.count)}`),
    ].join(' · ');
  }
  return '';
}

/** Each warning as one short line; the server's full sentence sits behind "Why?". */
export function warningTitle(w) {
  switch (w.code) {
    case 'hidden_rows_or_columns':
      return 'Hidden rows or columns were included';
    case 'encoding_guessed':
      return 'Check the names look right';
    case 'no_header_row':
      return 'No row of headings found';
    case 'question_marks_in_names':
    case 'garbled_names':
      return `${of(w.rows, 'name has', 'names have')} broken letters`;
    case 'shortened_by_excel':
      return `${of(w.rows, 'number was', 'numbers were')} cut short by Excel`;
    case 'phones_need_country':
      return `${of(w.rows, 'phone number', 'phone numbers')} left out`;
    case 'phones_unusual':
      return `${of(w.rows, 'phone number looks', 'phone numbers look')} unusual`;
    case 'shared_emails':
      return `${of(w.rows, 'person shares', 'people share')} an email`;
    case 'placeholders':
      return `Front-desk details left out of ${of(w.rows, 'row', 'rows')}`;
    case 'other_sheets_ignored':
      return 'Only one sheet was read';
    case 'cells_cut':
      return `${of(w.rows, 'long cell was', 'long cells were')} shortened`;
    case 'dates_not_read':
      return `${of(w.rows, "date couldn't", "dates couldn't")} be read`;
    case 'card_cells_dropped':
      return `${of(w.rows, 'card number', 'card numbers')} removed`;
    case 'extra_columns_left_out':
      return `${of(w.columns, 'column', 'columns')} on the right left out`;
    case 'gym_fields_full':
      return `${of(w.columns, 'column', 'columns')} not kept`;
    default:
      return 'Worth a look';
  }
}

const SKIP_WORDS = { no_contact: 'no email or phone', duplicate: 'same person as an earlier row' };
export function skipWords(reason) {
  return SKIP_WORDS[reason];
}

/** The finished screen's heading and line. */
export function doneWords(confirmed, words) {
  const { applied } = confirmed;
  if (confirmed.alreadyConfirmed) return { title: 'Already imported', detail: 'Nothing changed this time.' };
  const parts = [
    applied.new > 0 ? `${count(applied.new)} new` : null,
    applied.changed > 0 ? `${count(applied.changed)} updated` : null,
    applied.gone > 0 ? `${count(applied.gone)} marked as past ${words.people}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return { title: 'Nothing to change', detail: 'Your list already matches this file.' };
  if (applied.changed === 0 && applied.gone === 0) {
    return { title: `${of(applied.new, words.person, words.people)} imported`, detail: '' };
  }
  return { title: 'Your list is updated', detail: parts.join(' · ') };
}

// ── Bytes ───────────────────────────────────────────────────────────────────

/** Bytes as base64, in chunks so a 5 MB file does not overflow the call stack. */
export function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Pasted rows as a file's bytes: UTF-8 with its byte-order mark, so the reader
 *  knows how the letters were saved instead of guessing. */
export function pastedBytes(text) {
  const body = new TextEncoder().encode(text);
  const bytes = new Uint8Array(body.length + 3);
  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(body, 3);
  return bytes;
}
