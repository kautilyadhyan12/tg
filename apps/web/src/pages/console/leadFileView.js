// Leads from a file (ROADMAP 20c-iii): the words and choices of the Import leads panel,
// worked out from the server's check. Pure, so each one is tested on its own.
import { LEAD_FILE_FIELD_WORDS, LEAD_FILE_WORDS, LEAD_SOURCE_WORDS, leadFileNotAddedWords, leadFileWarningWords } from '@app/shared';

const count = (n) => n.toLocaleString('en');

/** What a column can be, in the picker's order; '' is "Not used". */
export const COLUMN_ROLES = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'source', 'notes'];
export const roleWord = (role) => (role === '' ? 'Not used' : LEAD_FILE_FIELD_WORDS[role]);

/** A column as staff know it: its own heading, or its place. */
export const columnName = (column) => (column.header && column.header.trim() !== '' ? column.header : `Column ${column.index + 1}`);

/** A few of a column's own cells, said as examples so nobody reads them as the
 *  people the choice applies to: "e.g. Asha, Ben, Cara". */
export const exampleLine = (column) => (column.samples.length === 0 ? 'Empty' : `e.g. ${column.samples.join(', ')}`);

/** Which role a column has in a mapping, or ''. */
export function roleOf(mapping, index) {
  if (mapping.email.includes(index)) return 'email';
  if (mapping.phone.includes(index)) return 'phone';
  for (const role of ['fullName', 'firstName', 'lastName', 'source', 'notes']) if (mapping[role] === index) return role;
  return '';
}

/** The mapping with one column given a new role. A single role taken from another
 *  column leaves that one "Not used"; a column named as a full name clears the first
 *  and last name, and the other way round, so a name is read one way only. */
export function withRole(mapping, index, role) {
  const next = {
    ...mapping,
    email: mapping.email.filter((i) => i !== index),
    phone: mapping.phone.filter((i) => i !== index),
  };
  for (const single of ['fullName', 'firstName', 'lastName', 'source', 'notes']) if (next[single] === index) next[single] = null;
  if (role === 'email' || role === 'phone') {
    next[role] = [...next[role], index].slice(0, 5);
  } else if (role !== '') {
    next[role] = index;
    if (role === 'fullName') {
      next.firstName = null;
      next.lastName = null;
    } else if (role === 'firstName' || role === 'lastName') {
      next.fullName = null;
    }
  }
  return next;
}

export function sameMapping(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What stops Add while the columns are as they are, in words, or null. */
export function mappingProblem(mapping) {
  if (mapping.email.length === 0 && mapping.phone.length === 0) return LEAD_FILE_WORDS.needs_contact;
  if (mapping.fullName === null && mapping.firstName === null && mapping.lastName === null) return LEAD_FILE_WORDS.needs_name;
  return null;
}

/** How to reach a person, as a row shows it. */
export const contactLine = (person) => [person.email, person.phone].filter(Boolean).join(' · ');

/** Where they heard of the gym as it will be saved, with the file's own word:
 *  "Social media · Instagram". */
export const heardLine = (person) => [LEAD_SOURCE_WORDS[person.source], person.sourceWord].filter(Boolean).join(' · ');

/** The headline over the people added. */
export const addedTitle = (preview) => (preview.counts.add === 0 ? LEAD_FILE_WORDS.none_added_title : LEAD_FILE_WORDS.added_title(preview.counts.add));

/** Somebody not added, as a row shows them: their name (or the row, with none) and why. */
export function notAddedRow(entry) {
  return { name: entry.fullName === '' ? `Row ${count(entry.row)}` : entry.fullName, why: leadFileNotAddedWords(entry) };
}

/** Rows not added that the file does not name one by one (past the listed ones). */
export const unlistedNotAdded = (preview) => Math.max(0, preview.counts.notAdded - preview.notAdded.length);

/** Each warning's sentence, and the place it needs something done in, if any (`sentencePlace`). */
export const warningLines = (preview) =>
  preview.warnings.map((w) => ({ text: leadFileWarningWords(w), place: w.code === 'phones_need_country' ? 'country' : null }));

/** Why a column is never kept. */
export const NEVER_KEPT_WORDS = {
  payment_card: 'we never keep card numbers',
  bank_details: 'we never keep bank details',
  government_id: 'we never keep ID numbers',
  password_or_pin: 'we never keep passwords or codes',
  medical: 'we never keep health notes',
};

/** The file's columns in three plain lines: what is read, what is not used, and what is
 *  left out and why. An empty line is left out. */
export function columnLines(preview) {
  const read = [];
  const unused = [];
  const leftOut = [];
  for (const column of preview.columns) {
    if (column.neverKept !== null) leftOut.push(`${columnName(column)} (${NEVER_KEPT_WORDS[column.neverKept]})`);
    else if (roleOf(preview.mapping, column.index) !== '') read.push(columnName(column));
    else unused.push(columnName(column));
  }
  const lines = [];
  if (read.length > 0) lines.push({ key: 'read', label: 'Read', text: read.join(', ') });
  if (unused.length > 0) lines.push({ key: 'unused', label: 'Not used', text: unused.join(', ') });
  if (leftOut.length > 0) lines.push({ key: 'leftOut', label: 'Left out', text: leftOut.join(', ') });
  return lines;
}

/** The Add button's words, and whether it can be pressed, with the reason when not. */
export function addButton({ preview, mapping, ticked, readOnly }) {
  const n = preview.counts.add;
  const label = n === 1 ? 'Add 1 lead' : `Add ${count(n)} leads`;
  if (readOnly) return { label, enabled: false, why: null };
  if (!sameMapping(mapping, preview.mapping)) return { label, enabled: false, why: 'You changed the columns. Check the file again to see who will be added.' };
  const problem = mappingProblem(preview.mapping);
  if (problem !== null) return { label, enabled: false, why: problem };
  if (n === 0) return { label, enabled: false, why: null };
  if (n > preview.room) return { label, enabled: false, why: LEAD_FILE_WORDS.full(preview.room, n) };
  if (!ticked) return { label, enabled: false, why: 'Tick the box above to add them.' };
  return { label, enabled: true, why: null };
}
