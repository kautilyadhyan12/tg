// Tags on the Members list (ROADMAP 5d-ii): what the tag filter sends, and the words of
// the box that names who changes.
import { describe, expect, it } from 'vitest';
import { memberListEntriesQuerySchema, memberListFilterSchema } from '@app/shared';
import {
  EMPTY_FILTERS,
  activeFilters,
  entriesQueryString,
  filtersAreEmpty,
  filtersWithTags,
  selectionFilter,
  tagBoxWords,
  tagChips,
  tagDoneLine,
  tagHolders,
  toggleTag,
} from './memberListPeople';

const WORDS = { people: 'members', person: 'member' };
const VIP = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'VIP', people: 2, pastPeople: 1 };
const KNEE = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', name: 'Knee rehab', people: 0, pastPeople: 3 };
const NONE = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003', name: 'Unused', people: 0, pastPeople: 0 };
const withVip = toggleTag(EMPTY_FILTERS, VIP);
const person = (name) => ({ entryId: `aaaaaaaa-aaaa-4aaa-8aaa-${name.padStart(12, '0')}`, name });

describe('a tag as a filter', () => {
  it('is one tag at a time, and a second press takes it off', () => {
    expect(withVip.tag).toEqual({ id: VIP.id, name: 'VIP' });
    expect(toggleTag(withVip, KNEE).tag).toEqual({ id: KNEE.id, name: 'Knee rehab' });
    expect(toggleTag(withVip, VIP).tag).toBeNull();
  });

  it('is sent to the list and to Select all as the same key, and the server accepts both', () => {
    const query = Object.fromEntries(new URLSearchParams(entriesQueryString({ ...withVip, query: ' ada ' })));
    expect(query).toEqual({ tag: VIP.id, query: 'ada' });
    expect(memberListEntriesQuerySchema.safeParse(query).success).toBe(true);
    const filter = selectionFilter({ ...withVip, query: ' ada ' });
    expect(filter).toEqual({ tag: VIP.id, query: 'ada' });
    expect(memberListFilterSchema.safeParse(filter).success).toBe(true);
    // Past members by a tag: both keys, where the gym's own words are left out.
    const past = { ...withVip, records: 'former', status: ['Active'] };
    expect(entriesQueryString(past)).toBe(`records=former&tag=${VIP.id}`);
    expect(selectionFilter(past)).toEqual({ records: 'former', tag: VIP.id });
    // No tag: no key.
    expect(entriesQueryString(EMPTY_FILTERS)).toBe('');
    expect(selectionFilter(EMPTY_FILTERS)).toEqual({});
  });

  it('counts as a filter, and has a pill that takes only the tag off', () => {
    expect(filtersAreEmpty(EMPTY_FILTERS)).toBe(true);
    expect(filtersAreEmpty(withVip)).toBe(false);
    const both = { ...withVip, status: ['Active'] };
    const pills = activeFilters(both, WORDS);
    expect(pills.map((pill) => pill.text)).toEqual(['Active', 'Tag: VIP']);
    expect(pills[1].without).toEqual({ ...both, tag: null });
    expect(activeFilters({ ...withVip, records: 'former' }, WORDS).map((pill) => pill.text)).toEqual(['Past members', 'Tag: VIP']);
  });

  it("offers the tags somebody in this view has, with this view's count, and the one ticked", () => {
    const all = [KNEE, NONE, VIP];
    expect(tagChips(all, EMPTY_FILTERS)).toEqual([{ id: VIP.id, name: 'VIP', count: 2 }]);
    expect(tagChips(all, { ...EMPTY_FILTERS, records: 'former' })).toEqual([
      { id: KNEE.id, name: 'Knee rehab', count: 3 },
      { id: VIP.id, name: 'VIP', count: 1 },
    ]);
    expect(tagChips(all, toggleTag(EMPTY_FILTERS, NONE))).toEqual([
      { id: NONE.id, name: 'Unused', count: 0 },
      { id: VIP.id, name: 'VIP', count: 2 },
    ]);
  });

  it('follows the gym’s tags: a renamed tag keeps filtering under its new name, a deleted one stops', () => {
    expect(filtersWithTags(withVip, [VIP, KNEE])).toBe(withVip);
    expect(filtersWithTags(EMPTY_FILTERS, [])).toBe(EMPTY_FILTERS);
    expect(filtersWithTags(withVip, [{ ...VIP, name: 'Founders' }]).tag).toEqual({ id: VIP.id, name: 'Founders' });
    expect(filtersWithTags(withVip, [KNEE]).tag).toBeNull();
  });
});

describe('the words of the Tags box', () => {
  it('says who holds a tag', () => {
    expect(tagHolders(VIP, WORDS)).toBe('2 members and 1 past member');
    expect(tagHolders(KNEE, WORDS)).toBe('3 past members');
    expect(tagHolders({ ...VIP, people: 1, pastPeople: 0 }, WORDS)).toBe('1 member');
    expect(tagHolders(NONE, WORDS)).toBe('nobody');
  });

  it('names who changes and who does not, with a reason each', () => {
    const add = tagBoxWords({
      action: 'add',
      tag: { id: null, name: 'VIP' },
      selected: 6,
      changeCount: 2,
      change: [person('1'), person('2')],
      kept: [
        { reason: 'has_it', count: 1, people: [person('3')] },
        { reason: 'full', count: 1, people: [person('4')] },
        { reason: 'gone', count: 2, people: [] },
      ],
    });
    expect(add.heading).toBe('2 people will get the tag “VIP”');
    expect(add.button).toBe('Add tag to 2 people');
    expect(add.newTag).toBe('“VIP” is a new tag for your gym.');
    expect(add.keptHeading).toBe("4 won't change");
    expect(add.kept.map((group) => [group.count, group.line])).toEqual([
      [1, 'Already have this tag.'],
      [1, 'Already have 20 tags or more, the most one person can have. Take a tag off them first.'],
      [2, 'No longer on your list.'],
    ]);

    const off = tagBoxWords({ action: 'remove', tag: { id: VIP.id, name: 'VIP' }, selected: 1, changeCount: 1, change: [person('1')], kept: [] });
    expect(off.heading).toBe('1 person will lose the tag “VIP”');
    expect(off.button).toBe('Take tag off 1 person');
    expect(off.keptHeading).toBeNull();
    expect(off.newTag).toBeNull();

    const nobody = tagBoxWords({ action: 'add', tag: { id: VIP.id, name: 'VIP' }, selected: 1, changeCount: 0, change: [], kept: [{ reason: 'has_it', count: 1, people: [person('1')] }] });
    expect(nobody.heading).toBeNull();
    expect(nobody.button).toBeNull();
    expect(nobody.nobody).toBe('Nobody you selected can get the tag “VIP”.');
  });

  it('counts the people beyond the names it was sent', () => {
    const big = tagBoxWords({ action: 'add', tag: { id: VIP.id, name: 'VIP' }, selected: 10000, changeCount: 9900, change: [person('1')], kept: [{ reason: 'has_it', count: 100, people: [person('2')] }] });
    expect(big.heading).toBe('9,900 people will get the tag “VIP”');
    expect(big.button).toBe('Add tag to 9,900 people');
  });

  it('says what a press did', () => {
    expect(tagDoneLine({ action: 'add', tag: VIP, changed: 12, kept: [] })).toBe('“VIP” added to 12 people.');
    expect(tagDoneLine({ action: 'remove', tag: VIP, changed: 1, kept: [{ reason: 'not_on_them', count: 2 }, { reason: 'gone', count: 1 }] })).toBe(
      "“VIP” taken off 1 person. 3 didn't change.",
    );
  });
});
