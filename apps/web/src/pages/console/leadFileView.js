// Leads from a file (ROADMAP 20c-iii): the words and choices of the Import leads panel,
// worked out from the server's check. Pure, so each one is tested on its own.
import { LEAD_FILE_FIELD_WORDS, LEAD_FILE_WORDS, LEAD_SOURCE_WORDS, leadFileWarningWords } from '@app/shared';

const count = (n) => n.toLocaleString('en');

/** What a column can be, in the picker's order; '' is "Not used". */
export const COLUMN_ROLES = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'source', 'notes'];
export const roleWord = (role) => (role === '' ? 'Not used' : LEAD_FILE_FIELD_WORDS[role]);

/** A column as staff know it: its own heading, or its place. */
export const columnName = (column) => (column.header && column.header.trim() !== '' ? column.header : `Column ${column.index + 1}`);

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

/** "Ann Bell, Bo Cox, Cy Dent and 12 more". */
export function someNames(people, shown = 3) {
  const names = people.slice(0, shown).map((p) => p.fullName);
  const rest = people.length - names.length;
  if (rest <= 0) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.join(', ')} and ${count(rest)} more`;
}

/** How to reach a person, as a row shows it. */
export const contactLine = (person) => [person.email, person.phone].filter(Boolean).join(' · ');

/** The groups of the check, in order, with their reason; empty groups left out. */
export function groupsOf(preview) {
  return [
    { key: 'add', title: 'New leads', people: preview.add, reason: LEAD_FILE_WORDS.add_reason, tone: 'good' },
    { key: 'alreadyLead', title: 'Already in your leads', people: preview.alreadyLead, reason: LEAD_FILE_WORDS.already_lead_reason, tone: 'plain' },
    { key: 'alreadyMember', title: 'Already members', people: preview.alreadyMember, reason: LEAD_FILE_WORDS.already_member_reason, tone: 'plain' },
    { key: 'twiceInFile', title: 'Repeated in the file', people: preview.twiceInFile, reason: LEAD_FILE_WORDS.twice_in_file_reason, tone: 'plain' },
  ].filter((group) => group.people.length > 0);
}

/** Rows that were not read as anybody, each a sentence. The same person twice is said
 *  here too; two people on one address are the "Repeated in the file" group. */
export function skippedLines(preview) {
  const lines = [];
  if (preview.counts.noContact > 0) lines.push(LEAD_FILE_WORDS.no_contact(preview.counts.noContact));
  if (preview.counts.noName > 0) lines.push(LEAD_FILE_WORDS.no_name(preview.counts.noName));
  const sameRow = preview.counts.twiceInFile - preview.twiceInFile.length;
  if (sameRow > 0) lines.push(LEAD_FILE_WORDS.twice_in_file(sameRow));
  return lines;
}

/** "Instagram → Social media · 12". */
export const sortedWordLine = (entry) => `${entry.word} → ${LEAD_SOURCE_WORDS[entry.source]}`;

export const warningLines = (preview) => preview.warnings.map((w) => leadFileWarningWords(w));

/** Why a column is never kept, as the member list says it. */
export const NEVER_KEPT_WORDS = {
  payment_card: 'Not kept: card numbers',
  bank_details: 'Not kept: bank details',
  government_id: 'Not kept: ID numbers',
  password_or_pin: 'Not kept: passwords or codes',
  medical: 'Not kept: health notes',
};

/** The Add button's words, and whether it can be pressed, with the reason when not. */
export function addButton({ preview, mapping, ticked, readOnly }) {
  const n = preview.counts.add;
  const label = n === 1 ? 'Add 1 lead' : `Add ${count(n)} leads`;
  if (readOnly) return { label, enabled: false, why: null };
  if (!sameMapping(mapping, preview.mapping)) return { label, enabled: false, why: 'You changed the columns. Check the file again first.' };
  const problem = mappingProblem(preview.mapping);
  if (problem !== null) return { label, enabled: false, why: problem };
  if (n === 0) return { label, enabled: false, why: LEAD_FILE_WORDS.nothing_to_add };
  if (n > preview.room) return { label, enabled: false, why: LEAD_FILE_WORDS.full(preview.room, n) };
  if (!ticked) return { label, enabled: false, why: 'Tick the box above first.' };
  return { label, enabled: true, why: null };
}
