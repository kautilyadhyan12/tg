import { HELD_PAYMENT_WORDS, MEMBER_APP_FILTER_WORDS } from '@app/shared';
import { EMPTY_FILTERS, entriesQueryString } from './memberListPeople';

// Quick filters over Your list (spec Part 3 §17.11, board `Members`): one press shows only
// one kind of person, a second press shows everyone again. Each is a choice the Filter
// already has, with the server's own count; one with nobody in it is not drawn.

const fold = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const sameFilters = (a, b) => entriesQueryString(a, null) === entriesQueryString(b, null);

/** The quick filters for `filters` over the list's answer `list`: `[{ key, text, count, on,
 *  next, warn }]`, `next` the filters one press gives. Empty for past members, or before the
 *  list has answered. */
export function quickFilters(list, filters) {
  if (list === null || filters.records !== 'current') return [];
  const everyone = { ...EMPTY_FILTERS, query: filters.query };
  const countOf = (chips, label) => chips.find((c) => fold(c.label) === fold(label))?.count ?? 0;
  const appCount = (word) => list.appWords.find((w) => w.word === word)?.count ?? 0;
  const kinds = [
    { key: 'payment-due', text: HELD_PAYMENT_WORDS.due, count: countOf(list.paymentStatuses, HELD_PAYMENT_WORDS.due), only: { paymentStatus: [HELD_PAYMENT_WORDS.due] }, warn: true },
    { key: 'not-in-app', text: MEMBER_APP_FILTER_WORDS.not_in_app, count: appCount('not_in_app'), only: { app: ['not_in_app'] } },
    { key: 'not-invited', text: MEMBER_APP_FILTER_WORDS.not_invited, count: appCount('not_invited'), only: { app: ['not_invited'] } },
    { key: 'no-membership', text: 'No membership', count: countOf(list.membershipTypes, ''), only: { membershipType: [''] } },
  ];
  const everyoneOn = sameFilters(filters, everyone);
  const out = [{ key: 'everyone', text: 'Everyone', count: list.counts.entries, on: everyoneOn, next: everyone, warn: false }];
  for (const k of kinds) {
    const only = { ...everyone, ...k.only };
    const on = sameFilters(filters, only);
    if (k.count === 0 && !on) continue;
    out.push({ key: k.key, text: k.text, count: k.count, on, next: on ? everyone : only, warn: k.warn === true });
  }
  return out;
}
