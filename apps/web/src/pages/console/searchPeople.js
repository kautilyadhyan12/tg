import { CONSOLE_SEARCH_MIN_CHARS, orgWords } from '@app/shared';
import { canOpenPlace, placeTo } from './consolePlaces';
import { pastSince, rowCells, shortWhen } from './memberListPeople';
import { STATUS_TAG, statusWord } from './leadsView';
import { staffRoleText } from './consoleView';

// PEOPLE IN SEARCH (spec Part 3 §17.11, V1-e-ii): the People group's lines, from what the server
// found. A member's line says what their row on Members says; a lead's and a staff member's what
// Leads and the Staff tab say. Each opens that person's own page.

const has = (privileges, privilege) => Array.isArray(privileges) && privileges.includes(privilege);

/** Search looks for people only for whoever may open Members or the Staff tab. */
export function searchFindsPeople(privileges) {
  return has(privileges, 'members.confirm') || has(privileges, 'staff.manage');
}

/** What has been typed is enough to look for people. */
export function asksForPeople(typed) {
  return String(typed ?? '').trim().length >= CONSOLE_SEARCH_MIN_CHARS;
}

/** The words in the search box: "Search members, pages or actions", "clients" in a studio. */
export function searchPlaceholder(orgType, findsPeople = false) {
  return findsPeople ? `Search ${orgWords(orgType).people}, pages or actions` : 'Search pages or actions';
}

/** "SR" from "Sam Rivera"; the first letter alone from one word; "?" from none. */
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

function withQuery(to, params) {
  if (to === null) return null;
  return `${to}${to.includes('?') ? '&' : '?'}${new URLSearchParams(params).toString()}`;
}

/** A member's line: "Member 195 · Gold Monthly", their email or phone where there is no
 *  number; on the right Past member, Payment due or Overdue, or their status. */
export function memberLine(person, orgSlug, orgType, today = null) {
  const w = orgWords(orgType);
  // The search sends no end day: the line says none.
  const cells = rowCells({ ...person, endsOn: null, endsOnKind: null }, today);
  const past = person.formerAt !== null;
  const who = person.memberNumber ? `${w.personCap} ${person.memberNumber}` : (person.email ?? person.phone ?? w.personCap);
  const about = past ? (pastSince(person) === null ? null : `Left ${pastSince(person)}`) : cells.membership;
  let tag = null;
  if (past) tag = { text: `Past ${w.person}`, tone: 'c-tag-plain' };
  else if (cells.owes) tag = { text: cells.payment, tone: cells.overdue ? 'c-tag-bad' : 'c-tag-warn' };
  else if (cells.status !== null) tag = { text: cells.status, tone: 'c-tag-soft' };
  return {
    key: `person:member:${person.entryId}`,
    kind: 'person',
    title: person.fullName,
    where: [who, about].filter(Boolean).join(' · '),
    initials: initials(person.fullName),
    tag,
    to: withQuery(placeTo(orgSlug, 'members'), { person: person.entryId }),
  };
}

/** A lead's line: "Lead · added 12 Nov" and their status. */
export function leadLine(lead, orgSlug, today = null) {
  const added = shortWhen(lead.createdAt, today);
  return {
    key: `person:lead:${lead.id}`,
    kind: 'person',
    title: lead.fullName,
    where: added === '' ? 'Lead' : `Lead · added ${added}`,
    initials: initials(lead.fullName),
    tag: { text: statusWord(lead.status), tone: STATUS_TAG[lead.status] ?? 'c-tag-plain' },
    to: withQuery(placeTo(orgSlug, 'leads'), { lead: lead.id }),
  };
}

/** A staff member's line: "Staff · Front desk". */
export function staffLine(person, orgSlug, orgType) {
  const w = orgWords(orgType);
  return {
    key: `person:staff:${person.userId}`,
    kind: 'person',
    title: person.displayName,
    where: `Staff · ${staffRoleText(person.role, person.roleName ?? null, w, person.coOwner === true)}`,
    initials: initials(person.displayName),
    tag: null,
    to: withQuery(placeTo(orgSlug, 'staff'), { staff: person.userId }),
  };
}

/** "See all in Members" where there are more than were shown: the list opens with the same
 *  words in its search box. */
function moreLine(kind, title, to, typed) {
  return { key: `person:more:${kind}`, kind: 'person', title, where: `Opens the list with “${typed}” in its search`, initials: null, tag: null, to: withQuery(to, { search: typed }) };
}

/** The People group for what the server found, or null where it found nobody. Members, then
 *  leads, then staff, each with its "See all" line where there are more. */
export function peopleGroup(found, { orgSlug, orgType, privileges, typed, membersName, today = null }) {
  if (found === null || found === undefined) return null;
  const asked = String(typed ?? '').trim();
  const lines = [];
  const kinds = [
    { list: found.members, line: (p) => memberLine(p, orgSlug, orgType, today), more: () => moreLine('members', `See all in ${membersName}`, placeTo(orgSlug, 'members'), asked) },
    { list: found.leads, line: (p) => leadLine(p, orgSlug, today), more: () => moreLine('leads', 'See all in Leads', placeTo(orgSlug, 'leads'), asked) },
    { list: found.staff, line: (p) => staffLine(p, orgSlug, orgType), more: null },
  ];
  for (const kind of kinds) {
    if (kind.list === null || kind.list === undefined) continue;
    for (const person of kind.list.people) {
      const line = kind.line(person);
      if (line.to !== null) lines.push(line);
    }
    if (kind.list.more && kind.more !== null) {
      const more = kind.more();
      if (more.to !== null) lines.push(more);
    }
  }
  // Staff are shown only to whoever may open the Staff tab, whatever came back.
  const shown = lines.filter((line) => !line.key.startsWith('person:staff:') || canOpenPlace(privileges, 'staff'));
  return shown.length === 0 ? null : { key: 'people', label: 'People', lines: shown };
}
