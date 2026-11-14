// Ask to add card (ROADMAP 18d-vii): the Filter's No card on file as the server reads it, and the
// Card on file lines on a person's page.
import { describe, expect, it } from 'vitest';
import { cardAgreementWords, memberListEntriesQuerySchema, memberListFilterSchema } from '@app/shared';
import { EMPTY_FILTERS, activeFilters, entriesQueryString, filtersAreEmpty, selectionFilter } from './memberListPeople';
import { cardAskOneKeptLine, cardBoxView } from './memberCardView';
import { askCardsTo } from './paymentsView';

const WORDS = { people: 'members', person: 'member' };

describe('the Filter’s No card on file', () => {
  it('asks the server for card=none, and Select all means the same people', () => {
    const filters = { ...EMPTY_FILTERS, noCard: true };
    const query = entriesQueryString(filters, null);
    expect(query).toBe('card=none');
    expect(memberListEntriesQuerySchema.parse(Object.fromEntries(new URLSearchParams(query)))).toMatchObject({ card: 'none' });
    expect(memberListFilterSchema.parse(selectionFilter(filters))).toMatchObject({ card: 'none' });
    expect(filtersAreEmpty(filters)).toBe(false);
    const [pill] = activeFilters(filters, WORDS);
    expect(pill.text).toBe('No card on file');
    expect(filtersAreEmpty(pill.without)).toBe(true);
  });

  it('is a current member’s word: a page of past members does not send it', () => {
    expect(entriesQueryString({ ...EMPTY_FILTERS, records: 'former', noCard: true }, null)).toBe('records=former');
  });
});

describe('Card on file on a person’s page', () => {
  const view = (over = {}) => ({ state: 'ready', card: null, earlierCard: null, paidBy: null, inApp: true, canChange: true, isOwner: false, gymName: 'Iron House', agreement: cardAgreementWords('Iron House'), form: null, ...over });

  it('offers Ask for them alone only when the server says they would be asked, and says when they were', () => {
    expect(cardBoxView(view({ canAsk: true }), 'Maya Fernandes').ask).toBe('Ask Maya to add a card');
    expect(cardBoxView(view({ canAsk: false }), 'Maya Fernandes').ask).toBeNull();
    expect(cardBoxView(view({ canAsk: true, canChange: false }), 'Maya Fernandes').ask).toBeNull();
    expect(cardBoxView(view({ cardAskedOn: '2026-11-12' }), 'Maya Fernandes').askedLine).toBe('Asked to add a card in the app on 12 November 2026.');
    // Somebody else pays: their card is the one, and nothing about asking this person shows.
    const paid = cardBoxView(view({ canAsk: true, cardAskedOn: '2026-11-12', paidBy: { entryId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', name: 'Pat Lee' } }), 'Sam Lee');
    expect(paid.ask).toBeNull();
    expect(paid.askedLine).toBeNull();
  });

  it('a press for one person who is not asked says why in one sentence', () => {
    expect(cardAskOneKeptLine({ askCount: 0, kept: [{ reason: 'asked_recently', count: 1, people: [] }] })).toBe('Not asked. Already asked in the last 7 days.');
    expect(cardAskOneKeptLine({ askCount: 0, kept: [] })).toBe('Nobody you selected can be asked to add a card.');
  });
});

describe('where Ask members to add their card starts', () => {
  it('only for staff who record payments and keep the member list', () => {
    expect(askCardsTo('iron-house', ['billing.members', 'members.confirm'])).toBe('/console/iron-house/members?show=no-card');
    expect(askCardsTo('iron-house', ['billing.members'])).toBeNull();
    expect(askCardsTo('iron-house', ['members.confirm'])).toBeNull();
    expect(askCardsTo(undefined, ['billing.members', 'members.confirm'])).toBeNull();
  });
});

describe('the email with each request (Kd, 2026-11-14)', () => {
  const box = (over) => ({ selected: 2, askCount: 2, ask: [], kept: [], askDigest: 'd', emailed: true, noEmail: 0, ...over });

  it('says each gets an email, and who gets the message in the app only', async () => {
    const { cardAskBoxWords, cardAskDoneLine } = await import('./memberListPeople');
    expect(cardAskBoxWords(box()).what).toBe('Each gets a message in their inbox in the app and an email, asking them to add a card for their membership. Once added, the card is charged automatically each time the membership renews.');
    expect(cardAskBoxWords(box()).noEmail).toBeNull();
    expect(cardAskBoxWords(box({ noEmail: 1 })).noEmail).toBe('1 of them has no email address we can send to, so they get the message in the app only.');
    expect(cardAskBoxWords(box({ noEmail: 2 })).noEmail).toBe('None of them has an email address we can send to, so they get the message in the app only.');
    expect(cardAskBoxWords(box({ askCount: 1, noEmail: 1 })).noEmail).toBe('They have no email address we can send to, so they get the message in the app only.');
    expect(cardAskBoxWords(box({ emailed: false, noEmail: 0 })).what).toBe('Each gets a message in their inbox in the app asking them to add a card for their membership. Once added, the card is charged automatically each time the membership renews.');
    expect(cardAskDoneLine({ asked: 2, emailed: 2, kept: [] })).toBe("Asked 2 people to add a card. They'll see it in their inbox in the app and by email.");
    expect(cardAskDoneLine({ asked: 3, emailed: 1, kept: [] })).toBe("Asked 3 people to add a card. They'll see it in their inbox in the app, and 1 of them by email too.");
    expect(cardAskDoneLine({ asked: 1, emailed: 0, kept: [] })).toBe("Asked 1 person to add a card. They'll see it in their inbox in the app.");
  });
});
