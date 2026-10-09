// TEAMS IN A CHALLENGE FOR A MEMBER, drawn and in words (spec Part 3 §15.6; ROADMAP
// 19d-ii-a). Only the network is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { howToWin, myTeam, myTeamNote, pickBox, resultOf, teamRows, teamsLine } from './challengesView';

const svc = { list: vi.fn(), board: vi.fn(), join: vi.fn(), leave: vi.fn(), pickTeam: vi.fn() };
vi.mock('../../api/challengesApi', () => ({ challengesService: svc }));
vi.mock('../../api/orgsApi', () => ({
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  errorStatus: (err) => err?.response?.status ?? null,
}));
vi.mock('./PersonProfile', () => ({ default: ({ person }) => <div data-testid="profile">{person.name}</div> }));

const Challenges = (await import('./Challenges')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const RED = 'red';
const BLUE = 'blue';
const GREEN = 'green';
const me = (over = {}) => ({ value: 0, place: null, hidden: null, toNextPlace: null, nextPlace: null, reached: false, days: [], ...over });
const team = (id, name, people, value, place, over = {}) => ({ id, name, people, value, place, reached: false, isMine: false, ...over });
const mate = (id, name, value, isMe = false) => ({ userId: id, name, initials: name.slice(0, 1), value, isMe });
const teamBoard = (over = {}) => ({
  status: 'shown',
  rows: [team(RED, 'Red Team', 4, 11, 2), team(BLUE, 'Blue Team', 5, 14, 1, { isMine: true }), team(GREEN, 'Green Team', 0, 0, null)],
  mine: { teamId: BLUE, people: [mate('u2', 'Chen W.', 6), mate('me', 'Maya K.', 5, true), mate('u3', 'Tom B.', 3)], more: 0, counted: true },
  ...over,
});
const challenge = (id, name, over = {}) => ({
  id,
  name,
  details: '',
  prize: '',
  counts: 'gym_days',
  unit: '',
  lowestWins: false,
  startsOn: '2026-10-05',
  endsOn: '2026-10-11',
  target: null,
  who: 'everyone',
  teams: 'staff',
  cancelled: false,
  state: 'running',
  joined: false,
  can: { join: false, leave: false, pick: false },
  joinedCount: null,
  teamBoard: teamBoard(),
  board: { status: 'shown', ranked: 9, top: [], leaders: 1, reached: null },
  me: me({ value: 5, place: 3, days: ['2026-10-05', '2026-10-06'] }),
  ...over,
});
const listOf = (challenges, over = {}) => ({ gymId: 'g1', gymName: 'Iron House', timezone: 'Asia/Kolkata', today: '2026-10-07', status: 'shown', checkingIn: true, challenges, asOf: '2026-10-07T06:30:00.000Z', ...over });
const refused = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });
const cardOf = (name) => within(screen.getByText(name).closest('li'));
const texts = (list) => within(list).getAllByRole('listitem').map((li) => li.textContent.replace(/\s+/g, ' ').trim());
const noTeam = { rows: [team(RED, 'Red Team', 4, 0, null), team(BLUE, 'Blue Team', 5, 0, null)], mine: null };

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
});
afterEach(() => cleanup());

describe('teams, in words', () => {
  it('says how a challenge in teams is won', () => {
    expect(howToWin(challenge('a', 'A'))).toBe('The team with the most gym days wins');
    expect(howToWin(challenge('a', 'A', { target: 60 }))).toBe('Reach 60 gym days as a team');
    expect(howToWin(challenge('a', 'A', { counts: 'own', unit: 'seconds', lowestWins: true }))).toBe('The team with the fewest seconds wins');
    // A challenge people are in alone reads as it did.
    expect(howToWin(challenge('a', 'A', { teams: 'none', teamBoard: null }))).toBe('Most gym days wins');
  });

  it('says who makes the teams', () => {
    expect(teamsLine(challenge('a', 'A'), 'Iron House')).toBe('In teams. The staff at Iron House put people in teams.');
    expect(teamsLine(challenge('a', 'A', { teams: 'members' }), 'Iron House')).toBe('In teams. You pick your own team.');
    expect(teamsLine(challenge('a', 'A', { teams: 'none', teamBoard: null }), 'Iron House')).toBeNull();
  });

  it('lists the placed teams first, then the rest in the gym order, each with its people and number', () => {
    expect(teamRows(challenge('a', 'A')).map((t) => [t.name, t.place, t.people, t.number, t.isMine])).toEqual([
      ['Blue Team', 1, '5 people', '14 gym days', true],
      ['Red Team', 2, '4 people', '11 gym days', false],
      ['Green Team', null, 'Nobody yet', '0 gym days', false],
    ]);
    expect(teamRows(challenge('a', 'A'))[0].label).toBe('Blue Team, your team: 1st, 5 people, 14 gym days');
    // While no team has a number to show, none is printed, not even a 0.
    const hidden = teamRows(challenge('a', 'A', { teamBoard: teamBoard({ status: 'too_few', rows: [team(RED, 'Red Team', 1, 0, null), team(BLUE, 'Blue Team', 1, 0, null)] }) }));
    expect(hidden.map((t) => [t.name, t.place, t.people, t.number])).toEqual([
      ['Red Team', null, '1 person', null],
      ['Blue Team', null, '1 person', null],
    ]);
    expect(teamRows(challenge('a', 'A', { teams: 'none', teamBoard: null }))).toEqual([]);
  });

  it('tells the member where they stand with a team, and nothing when there is nothing to say', () => {
    const cases = [
      ['in a team, counted', {}, null],
      ['in a team while hidden from boards', { teamBoard: teamBoard({ mine: { ...teamBoard().mine, counted: false } }) }, "Your number isn't added to Blue Team's, because you aren't shown on this gym's boards."],
      ['staff make them, in none yet', { teamBoard: teamBoard(noTeam) }, "You're not in a team yet. The staff at Iron House put people in teams."],
      ['staff make them, not in the challenge', { who: 'joined', me: null, can: { join: true, leave: false, pick: false }, teamBoard: teamBoard(noTeam) }, null],
      ['members pick, in the challenge with no team', { teams: 'members', can: { join: false, leave: false, pick: true }, teamBoard: teamBoard(noTeam) }, 'Pick your team.'],
      ['members pick, not in it yet', { teams: 'members', who: 'joined', me: null, can: { join: false, leave: false, pick: true }, teamBoard: teamBoard(noTeam) }, 'Pick a team to join the challenge.'],
      ['ended', { state: 'ended', teamBoard: teamBoard(noTeam) }, null],
      ['cancelled', { cancelled: true, teamBoard: teamBoard(noTeam) }, null],
      ['alone', { teams: 'none', teamBoard: null }, null],
    ];
    for (const [what, over, expected] of cases) expect(myTeamNote(challenge('a', 'A', over), 'Iron House'), what).toBe(expected);
  });

  it("lists the member's own team, themselves as You, and says when teammates are still to show", () => {
    expect(myTeam(challenge('a', 'A'))).toEqual({
      name: 'Blue Team',
      people: [
        { userId: 'u2', name: 'Chen W.', initials: 'C', isMe: false, number: '6 gym days' },
        { userId: 'me', name: 'You', initials: 'You', isMe: true, number: '5 gym days' },
        { userId: 'u3', name: 'Tom B.', initials: 'T', isMe: false, number: '3 gym days' },
      ],
      more: null,
      note: 'Teammates show here once they have a gym day.',
    });
    // A big team: the leading ones are named and the rest with a number counted.
    const big = challenge('a', 'A', { teamBoard: teamBoard({ rows: [team(BLUE, 'Blue Team', 25, 90, 1, { isMine: true })], mine: { ...teamBoard().mine, more: 14 } }) });
    expect([myTeam(big).more, myTeam(big).note]).toEqual(['and 14 more with a gym day', 'Teammates show here once they have a gym day.']);
    const full = challenge('a', 'A', { teamBoard: teamBoard({ rows: [team(BLUE, 'Blue Team', 17, 90, 1, { isMine: true })], mine: { ...teamBoard().mine, more: 14 } }) });
    expect(myTeam(full).note).toBeNull();
    const all = challenge('a', 'A', { teamBoard: teamBoard({ rows: [team(BLUE, 'Blue Team', 3, 14, 1, { isMine: true })] }) });
    expect(myTeam(all).note).toBeNull();
    expect(myTeam(challenge('a', 'A', { teamBoard: teamBoard(noTeam) }))).toBeNull();
  });

  it('asks before a pick, and says whether it can be changed afterwards', () => {
    const red = { id: RED, name: 'Red Team' };
    const open = { teams: 'members', can: { join: false, leave: false, pick: true }, teamBoard: teamBoard(noTeam) };
    expect(pickBox(challenge('a', 'A', open), red)).toEqual({
      title: 'Join Red Team?',
      line: "The challenge has started, so you can't change team after this.",
      yes: 'Join Red Team',
      no: 'Not now',
    });
    expect(pickBox(challenge('a', 'A', { ...open, who: 'joined', state: 'coming', startsOn: '2026-10-12' }), red).line).toBe('This puts you in the challenge. You can change team until Mon 12 Oct, when the challenge starts.');
    expect(pickBox(challenge('a', 'A', { teams: 'members', state: 'coming', startsOn: '2026-10-12' }), red)).toMatchObject({ title: 'Move to Red Team?', yes: 'Move to Red Team' });
  });

  it('says how a challenge in teams finished, and how the member own team did', () => {
    const ended = (over = {}) => challenge('a', 'A', { state: 'ended', ...over });
    expect(resultOf(ended())).toEqual({ headline: 'Winner: Blue Team, with 14 gym days.', mine: 'Your team, Blue Team, won. You had 5 gym days.' });
    const second = teamBoard({ rows: [team(RED, 'Red Team', 4, 20, 1), team(BLUE, 'Blue Team', 5, 14, 2, { isMine: true })] });
    expect(resultOf(ended({ teamBoard: second }))).toEqual({ headline: 'Winner: Red Team, with 20 gym days.', mine: 'Your team, Blue Team, finished 2nd, with 14 gym days. You had 5 gym days.' });
    const level = teamBoard({ rows: [team(RED, 'Red Team', 4, 14, 1), team(BLUE, 'Blue Team', 5, 14, 1, { isMine: true }), team(GREEN, 'Green Team', 2, 3, 3)] });
    expect(resultOf(ended({ teamBoard: level }))).toEqual({ headline: 'Joint winners: Red Team and Blue Team, with 14 gym days each.', mine: 'Your team, Blue Team, was joint first. You had 5 gym days.' });
    const reached = teamBoard({ rows: [team(RED, 'Red Team', 4, 61, 1, { reached: true }), team(BLUE, 'Blue Team', 5, 40, 2, { isMine: true })] });
    expect(resultOf(ended({ target: 60, teamBoard: reached }))).toEqual({ headline: '1 team reached 60 gym days: Red Team.', mine: 'Your team, Blue Team, got to 40 of 60. You had 5 gym days.' });
    const none = teamBoard({ rows: [team(RED, 'Red Team', 4, 12, 1), team(BLUE, 'Blue Team', 5, 9, 2)], mine: null });
    expect(resultOf(ended({ target: 60, teamBoard: none, me: null }))).toEqual({ headline: 'No team reached 60 gym days.', mine: null });
    expect(resultOf(ended({ teamBoard: teamBoard({ status: 'too_few', ...noTeam }) }))).toEqual({ headline: 'It finished with fewer than 3 people in it, so there are no places.', mine: null });
    expect(resultOf(ended({ teamBoard: teamBoard({ rows: [team(RED, 'Red Team', 0, 0, null), team(BLUE, 'Blue Team', 0, 0, null)], mine: null }), me: me() }))).toEqual({ headline: 'No team had a number.', mine: null });
  });
});

describe("a member's challenge in teams", () => {
  it('draws the teams with their places, the member own team marked, its people, and their own number with no bar', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'Team Week', { target: 60 })]));
    render(<Challenges gym={GYM} />);
    const card = cardOf(await screen.findByText('Team Week').then((el) => el.textContent));
    expect(card.getByText('Reach 60 gym days as a team')).toBeTruthy();
    expect(card.getByText('In teams. The staff at Iron House put people in teams.')).toBeTruthy();
    expect(texts(card.getByRole('list', { name: 'Teams' }))).toEqual(['1stBlue TeamYour team5 people14 gym days', '2ndRed Team4 people11 gym days', '—Green TeamNobody yet0 gym days']);
    expect(texts(card.getByRole('list', { name: 'People in Blue Team' }))).toEqual(['CChen W.6 gym days', 'YouYou5 gym days', 'TTom B.3 gym days']);
    expect(card.getByText('Teammates show here once they have a gym day.')).toBeTruthy();
    // The number to reach is the team's: the member's own number has no bar and no "to go".
    const mine = within(card.getByLabelText('Your number in this challenge'));
    expect(mine.queryByRole('progressbar')).toBeNull();
    expect(mine.queryByText(/to go/)).toBeNull();
    expect(mine.queryByText(/3rd of/)).toBeNull();
    // The first three people are not drawn; everyone's numbers are a button away.
    expect(card.queryByRole('list', { name: 'Top three' })).toBeNull();
    expect(card.getByRole('button', { name: 'See the whole board of Team Week' }).textContent).toBe("See everyone's numbers (9)");
    // Staff make the teams: nothing to press on a team.
    expect(card.queryByRole('button', { name: /^(Join|Move to) / })).toBeNull();
  });

  it('where members pick: each team has its button, the pick is asked first, and only the pressed team is sent', async () => {
    const open = challenge('a', 'Pick Week', { teams: 'members', who: 'joined', me: null, joinedCount: 9, can: { join: false, leave: false, pick: true }, teamBoard: teamBoard({ rows: [team(RED, 'Red Team', 4, 11, 2), team(BLUE, 'Blue Team', 5, 14, 1)], mine: null }) });
    const after = { ...open, joined: true, me: me(), can: { join: false, leave: true, pick: false }, teamBoard: teamBoard({ rows: [team(RED, 'Red Team', 5, 11, 2, { isMine: true }), team(BLUE, 'Blue Team', 5, 14, 1)], mine: { teamId: RED, people: [mate('me', 'Maya K.', 0, true)], counted: true } }) };
    svc.list.mockResolvedValue(listOf([open]));
    svc.pickTeam.mockResolvedValue(after);
    render(<Challenges gym={GYM} />);
    await screen.findByText('Pick Week');
    const card = () => cardOf('Pick Week');
    expect(card().getByText('In teams. You pick your own team.')).toBeTruthy();
    expect(card().getByText('Pick a team to join the challenge.')).toBeTruthy();
    // Picking is how a person joins here: no Join button beside the teams.
    expect(card().queryByRole('button', { name: 'Join Pick Week' })).toBeNull();
    expect(card().getAllByRole('button', { name: /^Join (Red|Blue) Team$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Join Blue Team', 'Join Red Team']);

    fireEvent.click(card().getByRole('button', { name: 'Join Red Team' }));
    const box = within(card().getByRole('group', { name: 'Join Red Team?' }));
    expect(box.getByText("This puts you in the challenge. The challenge has started, so you can't change team after this.")).toBeTruthy();
    expect(svc.pickTeam).not.toHaveBeenCalled();
    // Not now closes it and sends nothing.
    fireEvent.click(box.getByRole('button', { name: 'Not now' }));
    expect(card().queryByRole('group', { name: 'Join Red Team?' })).toBeNull();
    expect(svc.pickTeam).not.toHaveBeenCalled();

    fireEvent.click(card().getByRole('button', { name: 'Join Red Team' }));
    fireEvent.click(within(card().getByRole('group', { name: 'Join Red Team?' })).getByRole('button', { name: 'Join Red Team' }));
    await waitFor(() => expect(svc.pickTeam).toHaveBeenCalledTimes(1));
    expect(svc.pickTeam.mock.calls[0]).toEqual(['g1', 'a', RED]);
    // The card is the server's answer: in Red, and nothing more to press on a team.
    await waitFor(() => expect(texts(card().getByRole('list', { name: 'Teams' }))).toEqual(['1stBlue Team5 people14 gym days', '2ndRed TeamYour team5 people11 gym days']));
    expect(card().queryByRole('button', { name: /^(Join|Move to) / })).toBeNull();
    expect(card().getByRole('button', { name: 'Leave Pick Week' })).toBeTruthy();
  });

  it('before it starts a member in a team may move, and is asked first', async () => {
    const coming = challenge('a', 'Next Week', { teams: 'members', state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18', can: { join: false, leave: false, pick: true }, me: me(), teamBoard: teamBoard({ status: 'not_started', rows: [team(RED, 'Red Team', 4, 0, null), team(BLUE, 'Blue Team', 5, 0, null, { isMine: true })], mine: { teamId: BLUE, people: [mate('me', 'Maya K.', 0, true)], counted: true } }), board: { status: 'not_started', ranked: 0, top: [], leaders: 0, reached: null } });
    svc.list.mockResolvedValue(listOf([coming]));
    svc.pickTeam.mockResolvedValue(coming);
    render(<Challenges gym={GYM} />);
    await screen.findByText('Next Week');
    const card = cardOf('Next Week');
    // No numbers before it starts.
    expect(texts(card.getByRole('list', { name: 'Teams' }))).toEqual(['—Red Team4 peopleMove here', '—Blue TeamYour team5 people']);
    fireEvent.click(card.getByRole('button', { name: 'Move to Red Team' }));
    const box = within(card.getByRole('group', { name: 'Move to Red Team?' }));
    expect(box.getByText('You can change team until Mon 12 Oct, when the challenge starts.')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Move to Red Team' }));
    await waitFor(() => expect(svc.pickTeam).toHaveBeenCalledWith('g1', 'a', RED));
  });

  it("a pick the server refuses says the server's words and reads the list again", async () => {
    const open = challenge('a', 'Pick Week', { teams: 'members', can: { join: false, leave: false, pick: true }, teamBoard: teamBoard({ rows: [team(RED, 'Red Team', 4, 11, 2), team(BLUE, 'Blue Team', 5, 14, 1)], mine: null }) });
    svc.list.mockResolvedValue(listOf([open]));
    svc.pickTeam.mockRejectedValue(refused(409, "This challenge has started, so you can't change team now."));
    render(<Challenges gym={GYM} />);
    await screen.findByText('Pick Week');
    fireEvent.click(cardOf('Pick Week').getByRole('button', { name: 'Join Blue Team' }));
    fireEvent.click(within(cardOf('Pick Week').getByRole('group', { name: 'Join Blue Team?' })).getByRole('button', { name: 'Join Blue Team' }));
    expect((await cardOf('Pick Week').findByRole('alert')).textContent).toBe("This challenge has started, so you can't change team now.");
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it('with fewer than three people counted: the teams and their people, no numbers, and why', async () => {
    const few = challenge('a', 'Small Week', { teamBoard: teamBoard({ status: 'too_few', rows: [team(RED, 'Red Team', 1, 0, null), team(BLUE, 'Blue Team', 1, 0, null, { isMine: true })], mine: { teamId: BLUE, people: [mate('me', 'Maya K.', 2, true)], counted: true } }), board: { status: 'too_few', ranked: 0, top: [], leaders: 0, reached: null }, me: me({ value: 2 }) });
    svc.list.mockResolvedValue(listOf([few]));
    render(<Challenges gym={GYM} />);
    await screen.findByText('Small Week');
    const card = cardOf('Small Week');
    expect(texts(card.getByRole('list', { name: 'Teams' }))).toEqual(['—Red Team1 person', '—Blue TeamYour team1 person']);
    expect(texts(card.getByRole('list', { name: 'People in Blue Team' }))).toEqual(['YouYou2 gym days']);
    expect(card.getByText("The teams' numbers show once 3 people have a gym day in this challenge.")).toBeTruthy();
  });

  it('a member hidden from boards is told their number is not in their team total; one in no team is told who makes the teams', async () => {
    const hidden = challenge('a', 'Hidden Week', { me: me({ value: 5, hidden: 'opted_out' }), teamBoard: teamBoard({ mine: { teamId: BLUE, people: [mate('me', 'Maya K.', 5, true)], counted: false } }) });
    const none = challenge('b', 'Waiting Week', { teamBoard: teamBoard({ rows: [team(RED, 'Red Team', 4, 11, 1), team(BLUE, 'Blue Team', 5, 9, 2)], mine: null }) });
    svc.list.mockResolvedValue(listOf([hidden, none]));
    render(<Challenges gym={GYM} />);
    await screen.findByText('Hidden Week');
    expect(cardOf('Hidden Week').getByText("Your number isn't added to Blue Team's, because you aren't shown on this gym's boards.")).toBeTruthy();
    expect(cardOf('Waiting Week').getByText("You're not in a team yet. The staff at Iron House put people in teams.")).toBeTruthy();
    expect(cardOf('Waiting Week').queryByRole('list', { name: /^People in/ })).toBeNull();
  });

  it('an ended challenge in teams says which team won and how the member team did', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'Last Week', { state: 'ended', startsOn: '2026-09-28', endsOn: '2026-10-04' })]));
    render(<Challenges gym={GYM} />);
    await screen.findByText('Last Week');
    const result = within(cardOf('Last Week').getByLabelText('How it finished'));
    expect(result.getByText('Winner: Blue Team, with 14 gym days.')).toBeTruthy();
    expect(result.getByText('Your team, Blue Team, won. You had 5 gym days.')).toBeTruthy();
  });
});
