// A GYM'S CHALLENGES FOR ITS MEMBER, drawn (spec Part 3 §15.6; ROADMAP 19d-i). Only the
// network is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn(), board: vi.fn(), join: vi.fn(), leave: vi.fn() };
vi.mock('../../api/challengesApi', () => ({ challengesService: svc }));
vi.mock('../../api/orgsApi', () => ({
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  errorStatus: (err) => err?.response?.status ?? null,
}));
// A person's profile has its own suite; here it only has to open for the right person.
vi.mock('./PersonProfile', () => ({ default: ({ person }) => <div data-testid="profile">{person.name}</div> }));

const Challenges = (await import('./Challenges')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const me = (over = {}) => ({ value: 0, place: null, hidden: null, toNextPlace: null, nextPlace: null, reached: false, days: [], ...over });
const row = (id, name, place, value, over = {}) => ({ userId: id, name, initials: name.slice(0, 1), place, value, reached: false, isMe: false, ...over });
const TOP = [row('u1', 'Maya K.', 1, 5, { reached: true }), row('u2', 'Tom B.', 2, 4), row('u3', 'Priya S.', 3, 3)];
const challenge = (id, name, over = {}) => ({
  id,
  name,
  details: '',
  prize: '',
  counts: 'gym_days',
  startsOn: '2026-10-05',
  endsOn: '2026-10-11',
  target: null,
  who: 'everyone',
  cancelled: false,
  state: 'running',
  joined: false,
  can: { join: false, leave: false },
  joinedCount: null,
  board: { status: 'shown', ranked: 24, top: TOP, leaders: 1, reached: null },
  me: me(),
  ...over,
});
const listOf = (challenges, over = {}) => ({
  gymId: 'g1',
  gymName: 'Iron House',
  timezone: 'Asia/Kolkata',
  today: '2026-10-07',
  status: 'shown',
  checkingIn: true,
  challenges,
  asOf: '2026-10-07T06:30:00.000Z',
  ...over,
});
const refused = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });
const cardOf = (name) => within(screen.getByText(name).closest('li'));

// In braces: a function a `beforeEach` returns is called again as its tidy-up.
beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
});
afterEach(() => cleanup());

describe("a member's Challenges", () => {
  it('draws a running challenge: how it is won, its days, the prize, their own number with its bar, and the top three', async () => {
    svc.list.mockResolvedValue(
      listOf([
        challenge('c1', 'October Five', {
          target: 5,
          prize: 'A shaker for everyone who gets there',
          details: 'Any five days this week.',
          board: { status: 'shown', ranked: 24, top: TOP, leaders: 1, reached: 1 },
          me: me({ value: 3, place: 3, toNextPlace: 1, nextPlace: 2, days: ['2026-10-05', '2026-10-06', '2026-10-07'] }),
        }),
      ]),
    );
    render(<Challenges gym={GYM} />);
    const card = cardOf(await screen.findByText('October Five').then((el) => el.textContent));
    expect(card.getByText('Reach 5 gym days')).toBeTruthy();
    expect(card.getByText('5 days left')).toBeTruthy();
    expect(card.getByText('Mon 5 Oct – Sun 11 Oct')).toBeTruthy();
    expect(card.getByText('A shaker for everyone who gets there')).toBeTruthy();
    expect(card.getByText('Everyone at Iron House is in')).toBeTruthy();
    expect(card.getByText('Any five days this week.')).toBeTruthy();

    const mine = within(card.getByLabelText('Your number in this challenge'));
    expect(mine.getByText('3')).toBeTruthy();
    expect(mine.getByText('of 5 gym days')).toBeTruthy();
    const bar = mine.getByRole('progressbar');
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['3', '5']);
    expect(mine.getByText('2 to go')).toBeTruthy();
    expect(mine.getByText('3rd of 24 · 1 more gym day to reach 2nd')).toBeTruthy();
    // A flame a day: three counted, today among them, four still to come.
    expect(mine.getByLabelText('Mon 5 Oct: gym day')).toBeTruthy();
    expect(mine.getByLabelText('Wed 7 Oct: gym day')).toBeTruthy();
    expect(mine.getByLabelText('Sun 11 Oct: still to come')).toBeTruthy();

    const top = within(card.getByRole('list', { name: 'Top three' }));
    expect(top.getAllByRole('listitem').map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual(['1stMMaya K.5 Reached', '2ndTTom B.4', '3rdPPriya S.3']);
    // Everybody is in it: nothing to join and nothing to leave.
    expect(card.queryByRole('button', { name: /Join|Leave/ })).toBeNull();
    // What is counted is one tap away, in plain words.
    fireEvent.click(card.getByRole('button', { name: 'What October Five counts' }));
    expect(card.getByText(/A gym day is a day you're checked in at Iron House/)).toBeTruthy();
  });

  it('at the target the card says Done, and a hidden member is told only they see their line', async () => {
    svc.list.mockResolvedValue(
      listOf([
        challenge('c1', 'Target met', { target: 3, me: me({ value: 3, reached: true, place: 3, days: [] }) }),
        challenge('c2', 'Hidden', { me: me({ value: 9, place: 1, hidden: 'hide_me' }) }),
      ]),
    );
    render(<Challenges gym={GYM} />);
    const done = cardOf(await screen.findByText('Target met').then((el) => el.textContent));
    expect(done.getByText('Done')).toBeTruthy();
    expect(done.getByText('Done. You reached 3 gym days.')).toBeTruthy();
    const hidden = cardOf('Hidden');
    expect(hidden.getByText('Hide me is on. Only you see this row.')).toBeTruthy();
    // No place is said of somebody nobody else sees.
    expect(hidden.queryByText(/of 24/)).toBeNull();
  });

  it('a challenge people join: Join says what it does, puts them in, and Leave asks first', async () => {
    const open = challenge('c1', 'Joiners', { who: 'joined', joinedCount: 12, can: { join: true, leave: false }, me: null });
    const inIt = { ...open, joined: true, joinedCount: 13, can: { join: false, leave: true }, me: me({ value: 2, place: 4, toNextPlace: 1, nextPlace: 3 }) };
    svc.list.mockResolvedValue(listOf([open]));
    svc.join.mockResolvedValue(inIt);
    svc.leave.mockResolvedValue(open);
    render(<Challenges gym={GYM} />);
    const card = () => cardOf('Joiners');
    await screen.findByText('Joiners');
    expect(card().getByText('12 people have joined')).toBeTruthy();
    expect(card().getByText('Your gym days since Mon 5 Oct count as soon as you join.')).toBeTruthy();
    // Not in it: no number of theirs is drawn.
    expect(card().queryByLabelText('Your number in this challenge')).toBeNull();

    fireEvent.click(card().getByRole('button', { name: 'Join Joiners' }));
    await waitFor(() => expect(svc.join).toHaveBeenCalledWith('g1', 'c1'));
    await waitFor(() => expect(card().getByText('13 people have joined')).toBeTruthy());
    expect(card().getByText('4th of 24 · 1 more gym day to reach 3rd')).toBeTruthy();
    expect(card().queryByRole('button', { name: 'Join Joiners' })).toBeNull();

    // Leave is behind a box that says what happens; Stay in changes nothing.
    fireEvent.click(card().getByRole('button', { name: 'Leave Joiners' }));
    const box = within(card().getByRole('group', { name: 'Leave Joiners?' }));
    expect(box.getByText('You come off its board. Your gym days stay yours, and you can join again until it ends.')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Stay in' }));
    expect(svc.leave).not.toHaveBeenCalled();
    fireEvent.click(card().getByRole('button', { name: 'Leave Joiners' }));
    fireEvent.click(within(card().getByRole('group', { name: 'Leave Joiners?' })).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(svc.leave).toHaveBeenCalledWith('g1', 'c1'));
    await waitFor(() => expect(card().getByRole('button', { name: 'Join Joiners' })).toBeTruthy());
  });

  it('a join the server refuses is said in its words, and the list is read again', async () => {
    svc.list.mockResolvedValue(listOf([challenge('c1', 'Joiners', { who: 'joined', joinedCount: 0, can: { join: true, leave: false }, me: null })]));
    svc.join.mockRejectedValue(refused(409, 'This challenge has ended.'));
    render(<Challenges gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join Joiners' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This challenge has ended.');
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it('one not started says when it starts and draws no number; a cancelled one says so and offers nothing', async () => {
    svc.list.mockResolvedValue(
      listOf([
        challenge('c1', 'Next week', {
          state: 'coming',
          startsOn: '2026-10-12',
          endsOn: '2026-10-18',
          who: 'joined',
          joined: true,
          joinedCount: 3,
          can: { join: false, leave: true },
          board: { status: 'not_started', ranked: 0, top: [], leaders: 0, reached: null },
        }),
        challenge('c2', 'Called off', { cancelled: true, who: 'joined', joinedCount: 3, board: { status: 'not_started', ranked: 0, top: [], leaders: 0, reached: null }, me: null }),
      ]),
    );
    render(<Challenges gym={GYM} />);
    const coming = cardOf(await screen.findByText('Next week').then((el) => el.textContent));
    expect(coming.getByText('Starts in 5 days')).toBeTruthy();
    expect(coming.getByText("You're in.")).toBeTruthy();
    expect(coming.queryByLabelText('Your number in this challenge')).toBeNull();
    expect(coming.queryByRole('list', { name: 'Top three' })).toBeNull();
    const off = cardOf('Called off');
    expect(off.getByText('Cancelled')).toBeTruthy();
    expect(off.getByText('Iron House cancelled this challenge.')).toBeTruthy();
    expect(off.queryByRole('button', { name: /Join|Leave|board/ })).toBeNull();
  });

  it('one that has ended says who won and how the member did', async () => {
    svc.list.mockResolvedValue(
      listOf([
        challenge('c1', 'Last week', {
          state: 'ended',
          startsOn: '2026-09-28',
          endsOn: '2026-10-04',
          me: me({ value: 2, place: 9, days: ['2026-09-29', '2026-10-01'] }),
        }),
      ]),
    );
    render(<Challenges gym={GYM} />);
    const card = cardOf(await screen.findByText('Last week').then((el) => el.textContent));
    expect(card.getByText('Ended')).toBeTruthy();
    const result = within(card.getByLabelText('How it finished'));
    expect(result.getByText('Winner: Maya K., with 5 gym days.')).toBeTruthy();
    expect(result.getByText('You finished 9th, with 2 gym days.')).toBeTruthy();
    expect(card.getByText('9th of 24')).toBeTruthy();
  });

  it('too few people, and a gym that checks nobody in: each is said, never a bare 0', async () => {
    svc.list.mockResolvedValue(listOf([challenge('c1', 'Quiet', { board: { status: 'too_few', ranked: 0, top: [], leaders: 0, reached: null } })], { checkingIn: false }));
    render(<Challenges gym={GYM} />);
    const card = cardOf(await screen.findByText('Quiet').then((el) => el.textContent));
    expect(card.getByText('The places show once 3 people have a gym day in this challenge.')).toBeTruthy();
    expect(card.getByText("Iron House hasn't checked anyone in at the front desk in the last 30 days, so no gym days are being counted.")).toBeTruthy();
    expect(card.queryByRole('button', { name: /whole board/ })).toBeNull();
  });

  it('the whole board opens with every place, the member\'s own row marked, and a tap on somebody opens their profile', async () => {
    svc.list.mockResolvedValue(listOf([challenge('c1', 'October Five', { target: 5, me: me({ value: 2, place: 4 }) })]));
    svc.board.mockResolvedValue({
      challengeId: 'c1',
      status: 'shown',
      ranked: 24,
      rows: [...TOP, row('me', 'Vera V.', 4, 2, { isMe: true })],
      me: me({ value: 2, place: 4 }),
      asOf: '2026-10-07T06:30:00.000Z',
    });
    render(<Challenges gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: 'See the whole board of October Five' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'October Five' }));
    await waitFor(() => expect(svc.board).toHaveBeenCalledWith('g1', 'c1'));
    const rows = within(await sheet.findByRole('list', { name: 'The board' })).getAllByRole('button');
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual([
      '1st: Maya K., 5 gym days, reached the target',
      '2nd: Tom B., 4 gym days',
      '3rd: Priya S., 3 gym days',
      '4th: You, 2 gym days',
    ]);
    expect(sheet.getByText(/Reach 5 gym days · 24 on the board · Updated 12:00 pm/)).toBeTruthy();
    // Their own row opens nothing; somebody else's opens that person.
    expect(rows[3].disabled).toBe(true);
    fireEvent.click(rows[1]);
    expect((await screen.findByTestId('profile')).textContent).toBe('Tom B.');
  });

  it('a hidden member on the whole board has their own line under it, and is told why', async () => {
    svc.list.mockResolvedValue(listOf([challenge('c1', 'October', { me: me({ value: 9, place: 1, hidden: 'hide_me' }) })]));
    svc.board.mockResolvedValue({ challengeId: 'c1', status: 'shown', ranked: 24, rows: TOP, me: me({ value: 9, place: 1, hidden: 'hide_me' }), asOf: '2026-10-07T06:30:00.000Z' });
    render(<Challenges gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: 'See the whole board of October' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'October' }));
    expect(await sheet.findByText('Hide me is on. Only you see this row.')).toBeTruthy();
    expect(within(sheet.getByRole('list', { name: 'The board' })).getAllByRole('button')).toHaveLength(3);
  });

  it('loading, empty, not on a plan, not a member and a failed read are five different sentences', async () => {
    svc.list.mockReturnValueOnce(new Promise(() => {}));
    const first = render(<Challenges gym={GYM} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    first.unmount();

    svc.list.mockResolvedValueOnce(listOf([]));
    const second = render(<Challenges gym={GYM} />);
    expect(await screen.findByText('Iron House has no challenges on right now.')).toBeTruthy();
    second.unmount();

    svc.list.mockResolvedValueOnce(listOf([], { status: 'paused' }));
    const third = render(<Challenges gym={GYM} />);
    expect(await screen.findByText("Iron House's challenges aren't available right now.")).toBeTruthy();
    third.unmount();

    svc.list.mockRejectedValueOnce(refused(404, 'Organisation not found.'));
    const fourth = render(<Challenges gym={GYM} />);
    expect(await screen.findByText("Iron House's challenges aren't available right now.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    fourth.unmount();

    svc.list.mockRejectedValueOnce(new Error('offline'));
    svc.list.mockResolvedValueOnce(listOf([challenge('c1', 'Back again')]));
    render(<Challenges gym={GYM} />);
    expect(await screen.findByText("Couldn't load the challenges.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeTruthy();
  });
});
