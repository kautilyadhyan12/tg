// The member list upload's plain helpers (ROADMAP 5a; spec Part 3 §9.14, §11.3):
// which column holds what, the counts in words, and the line after Confirm. No
// React here, so each rule is tested on its own.
import { MEMBER_LIST_FIELD_WORDS, memberListFieldSchema } from '@app/shared';

export const FIELDS = memberListFieldSchema.options;
const LIST_FIELDS = ['email', 'phone'];

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

export function fieldWord(field) {
  const word = MEMBER_LIST_FIELD_WORDS[field];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-04-03" → "3 April 2026". */
export function dayWords(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${String(d)} ${MONTHS[m - 1]} ${String(y)}`;
}

const plural = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** The counts in words, each a group whose names can be opened. Groups of nobody are
 *  left out, except "new" so an empty file still says so. */
export function countLines(preview, words) {
  const { list, members, mode } = preview;
  const lines = [];
  const newDetail = [];
  if (list.alreadyInApp > 0) newDetail.push(`${list.alreadyInApp.toLocaleString('en')} already in the app`);
  if (list.canBeInvited > 0) newDetail.push(`${list.canBeInvited.toLocaleString('en')} could be invited`);
  if (list.noEmail > 0) newDetail.push(`${list.noEmail.toLocaleString('en')} with no email address`);
  if (list.returning > 0) newDetail.push(`${list.returning.toLocaleString('en')} were on your list before`);
  lines.push({ group: 'new', count: list.new, text: `${list.new.toLocaleString('en')} new`, detail: newDetail.join(' · ') });
  if (list.changed > 0) {
    const fields = [
      ...preview.fieldChanges.map((c) => `${MEMBER_LIST_FIELD_WORDS[c.field]} ${c.count.toLocaleString('en')}`),
      ...preview.extraChanges.map((c) => `${c.label} ${c.count.toLocaleString('en')}`),
    ];
    lines.push({ group: 'changed', count: list.changed, text: `${list.changed.toLocaleString('en')} changed`, detail: fields.join(' · ') });
  }
  if (list.unchanged > 0) {
    lines.push({ group: 'unchanged', count: list.unchanged, text: `${list.unchanged.toLocaleString('en')} unchanged`, detail: '' });
  }
  if (mode === 'whole_list' && list.gone > 0) {
    lines.push({
      group: 'gone',
      count: list.gone,
      text: `${list.gone.toLocaleString('en')} no longer on your list`,
      detail: 'Kept as former records, not deleted.',
    });
  }
  if (members.leaving > 0) {
    lines.push({
      group: 'members_leaving',
      count: members.leaving,
      text: `${members.leaving.toLocaleString('en')} of your ${words.people} in the app would read “no longer on your list”`,
      detail: 'They keep the app. Nobody is removed until you choose to.',
    });
  }
  return lines;
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

/** The line after Confirm: "12 new · 3 no longer on your list". */
export function resultLine(confirmed, mode) {
  const { applied, members } = confirmed;
  const parts = [`${applied.new.toLocaleString('en')} new`];
  if (applied.changed > 0) parts.push(`${applied.changed.toLocaleString('en')} changed`);
  if (mode === 'whole_list' && applied.gone > 0) parts.push(`${applied.gone.toLocaleString('en')} no longer on your list`);
  if (members.leaving > 0) parts.push(`${plural(members.leaving, 'app member', 'app members')} no longer on your list`);
  return parts.join(' · ');
}

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
