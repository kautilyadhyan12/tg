// TEAMS IN A CHALLENGE, IN THE CONSOLE, drawn (ROADMAP 19d-ii-a; spec Part 3 §15.6). Only
// the network is mocked: what staff see is read off the real page.
//
// The worst thing this screen could do: move somebody staff did not pick, or move people
// without the box that names each of them — so what is sent is checked against exactly the
// people whose team was changed, on whichever page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { closureDateLabel } from './hoursView';

const svc = { list: vi.fn(), board: vi.fn(), add: vi.fn(), change: vi.fn(), setCancelled: vi.fn(), setScores: vi.fn(), setTeamPeople: vi.fn() };
const orgApi = { getMine: vi.fn() };
vi.mock('../../api/challengesApi', () => ({ staffChallengesService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});

const Challenges = (await import('./Challenges')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'leaderboard.manage'],
  timezone: 'Asia/Kolkata',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const RED = '00000000-0000-4000-8000-0000000000a1';
const BLUE = '00000000-0000-4000-8000-0000000000b1';
const team = (id, name, people = 0, value = null, place = null) => ({ id, name, people, value, place });
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
  unit: '',
  lowestWins: false,
  teams: 'staff',
  cancelled: false,
  state: 'running',
  joinedCount: null,
  top: [],
  withNumber: 0,
  teamList: [team(RED, 'Red Team'), team(BLUE, 'Blue Team')],
  ...over,
});
const listOf = (current = [], over = {}) => ({ gymId: 'g1', gymName: 'Iron House', timezone: 'Asia/Kolkata', today: '2026-10-07', checkingIn: true, inApp: 143, current, past: [], pastTotal: 0, ...over });
const row = (id, name, teamId, over = {}) => ({ userId: id, name, initials: name.slice(0, 1), place: null, value: 0, hidden: null, reached: false, teamId, ...over });
const boardOf = (rows, over = {}) => ({ challengeId: 'a', memberStatus: 'too_few', ranked: 0, total: rows.length, hidden: 0, reached: null, page: 1, pages: 1, rows, asOf: '2026-10-07T06:30:00.000Z', ...over });

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/challenges']}>
      <Routes>
        <Route path="/console/:orgSlug/challenges" element={<Challenges />} />
      </Routes>
    </MemoryRouter>,
  );
};
const cards = () => screen.queryAllByTestId('challenge');
const cardOf = (name) => within(cards().find((el) => within(el).queryByRole('heading', { name }) !== null));
const form = () => within(screen.getByTestId('challenge-form'));
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });
const pickDate = (label, day) => {
  fireEvent.click(form().getByRole('button', { name: label }));
  const dayName = closureDateLabel(day);
  for (let n = 0; n < 24 && screen.queryByRole('button', { name: dayName }) === null; n += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  fireEvent.click(screen.getByRole('button', { name: dayName }));
};
const type = (label, text) => fireEvent.change(form().getByLabelText(label), { target: { value: text } });
const pick = (group, title) => fireEvent.click(within(form().getByRole('radiogroup', { name: group })).getByRole('radio', { name: new RegExp(`^${title}`) }));
const texts = (list) => within(list).getAllByRole('listitem').map((li) => li.textContent.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  orgApi.getMine.mockReset();
  resetConsoleOrgs();
  svc.list.mockResolvedValue(listOf());
});
afterEach(() => cleanup());

describe('teams on the Add challenge form', () => {
  it('a new challenge is one people are in alone, with no team boxes, and sends no team', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add challenge' }));
    const group = form().getByRole('radiogroup', { name: 'Alone or in teams' });
    expect(within(group).getAllByRole('radio').map((r) => [r.textContent.replace(/\s+/g, ' ').trim(), r.getAttribute('aria-checked')])).toEqual([
      ['AloneEach person has their own number and their own place.', 'true'],
      ["In teams you makeYou name the teams and put people in them on the challenge's board.", 'false'],
      ['In teams people pickYou name the teams. Your members pick their own in the app.', 'false'],
    ]);
    expect(form().queryByRole('group', { name: 'Teams' })).toBeNull();
  });

  it('in teams: two boxes to start, more can be added up to eight and removed down to two, and what is typed is what is sent', async () => {
    svc.add.mockImplementation(async (_gymId, _key, fields) => challenge('n', fields.name, { ...fields, state: 'coming', teamList: fields.teamList.map((t, i) => team(`00000000-0000-4000-8000-00000000000${i}`, t.name)) }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add challenge' }));
    type('Challenge name', 'Team October');
    pickDate('First day', '2026-10-12');
    pickDate('Last day', '2026-10-18');
    pick('Alone or in teams', 'In teams you make');
    const teams = () => within(form().getByRole('group', { name: 'Teams' }));
    expect(teams().getAllByRole('textbox')).toHaveLength(2);
    // With two there is nothing to remove.
    expect(teams().queryByRole('button', { name: /^Remove team/ })).toBeNull();
    expect(teams().getByText(/2 to 8 teams\. A team's number is its people's numbers added together\. After you save, press Put people in teams/)).toBeTruthy();
    // How it is won now speaks of teams.
    expect(within(form().getByRole('radiogroup', { name: 'How it is won' })).getAllByRole('radio').map((r) => r.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'The team with the mostOne board of teams. The first team wins.',
      'Every team that reaches a numberYou set the number. Every team that gets there wins.',
    ]);

    // Saved with a box empty: said, and nothing sent.
    type('Team 1 name', 'Red Team');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('Give team 2 a name, or remove it.');
    type('Team 2 name', ' red  TEAM ');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('Two teams are called red  TEAM. Give each team its own name.');
    expect(svc.add).not.toHaveBeenCalled();

    type('Team 2 name', ' Blue Team ');
    fireEvent.click(teams().getByRole('button', { name: 'Add a team' }));
    type('Team 3 name', 'Extra');
    fireEvent.click(teams().getByRole('button', { name: 'Add a team' }));
    type('Team 4 name', 'Green Team');
    fireEvent.click(teams().getByRole('button', { name: 'Remove team 3, Extra' }));
    expect(teams().getAllByRole('textbox').map((box) => box.value)).toEqual(['Red Team', ' Blue Team ', 'Green Team']);
    for (let n = 3; n < 8; n += 1) fireEvent.click(teams().getByRole('button', { name: 'Add a team' }));
    expect(teams().getAllByRole('textbox')).toHaveLength(8);
    expect(teams().queryByRole('button', { name: 'Add a team' })).toBeNull();
    for (let n = 8; n > 3; n -= 1) fireEvent.click(teams().getByRole('button', { name: `Remove team ${n}` }));

    // A team's target may be more than the challenge's seven days.
    pick('How it is won', 'Every team that reaches a number');
    type('Number a team has to reach', '60');
    expect(form().getByText("A team's number is its people's numbers added together. Every team that reaches this wins.")).toBeTruthy();
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add.mock.calls[0][2]).toMatchObject({
      name: 'Team October',
      target: 60,
      teams: 'staff',
      teamList: [
        { id: null, name: 'Red Team' },
        { id: null, name: 'Blue Team' },
        { id: null, name: 'Green Team' },
      ],
    });
    expect(svc.change).not.toHaveBeenCalled();
  });

  it('editing before it starts: a kept team keeps its id, and removing a team with people in it says who is left in no team before Save', async () => {
    const coming = challenge('a', 'Next Week', { state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18', withNumber: null, teamList: [team(RED, 'Red Team', 3), team(BLUE, 'Blue Team', 1), team('00000000-0000-4000-8000-0000000000c1', 'Green Team', 0)] });
    svc.list.mockResolvedValue(listOf([coming]));
    svc.change.mockResolvedValue(coming);
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(cardOf('Next Week').getByRole('button', { name: 'Edit Next Week' }));
    const teams = () => within(form().getByRole('group', { name: 'Teams' }));
    expect(teams().getAllByRole('textbox').map((box) => box.value)).toEqual(['Red Team', 'Blue Team', 'Green Team']);
    // An empty team goes without a word; one with people says what saving does.
    fireEvent.click(teams().getByRole('button', { name: 'Remove team 3, Green Team' }));
    expect(teams().queryByRole('note')).toBeNull();
    fireEvent.click(teams().getByRole('button', { name: 'Add a team' }));
    type('Team 3 name', 'Gold Team');
    fireEvent.click(teams().getByRole('button', { name: 'Remove team 1, Red Team' }));
    expect(teams().getByRole('note').textContent).toBe('Red Team has 3 people in it. Saving removes the team, and those people are left in no team. Nobody is told.');
    type('Team 1 name', 'The Blues');
    fireEvent.click(form().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    expect(svc.change.mock.calls[0][2]).toMatchObject({
      teams: 'staff',
      teamList: [
        { id: BLUE, name: 'The Blues' },
        { id: null, name: 'Gold Team' },
      ],
    });
  });

  it('once it has started the teams are switched off, with the reason', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week')]));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(cardOf('October Week').getByRole('button', { name: 'Edit October Week' }));
    expect(form().getByTestId('locked-note').textContent).toBe("This challenge has started, so what it counts, its first day, who is in it, how it is won and its teams can't change now. You can still change its name, prize, details and last day.");
    const teams = within(form().getByRole('group', { name: 'Teams' }));
    expect(teams.getAllByRole('textbox').every((box) => box.disabled)).toBe(true);
    expect(teams.queryByRole('button', { name: 'Add a team' })).toBeNull();
    expect(teams.queryByRole('button', { name: /^Remove team/ })).toBeNull();
    expect(within(form().getByRole('radiogroup', { name: 'Alone or in teams' })).getAllByRole('radio').every((r) => r.disabled)).toBe(true);
  });
});

describe('teams on a challenge card', () => {
  it('lists the teams, the leading one first, each with its people and its number as members see it', async () => {
    svc.list.mockResolvedValue(
      listOf([
        challenge('a', 'October Week', { withNumber: 9, teamList: [team(RED, 'Red Team', 4, 11, 2), team(BLUE, 'Blue Team', 5, 14, 1), team('00000000-0000-4000-8000-0000000000c1', 'Green Team', 0, 0, null)] }),
        challenge('b', 'Pick Week', { teams: 'members', state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18', withNumber: null }),
        challenge('c', 'Solo Week', { teams: 'none', teamList: [], withNumber: 0 }),
      ]),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(3));
    const a = cardOf('October Week');
    expect(within(a.getByTestId('challenge-teams')).getByText('Teams · you put people in them')).toBeTruthy();
    expect(texts(a.getByRole('list', { name: 'Teams: October Week' }))).toEqual(['1stBlue Team5 people14', '2ndRed Team4 people11', 'Green TeamNobody yet0']);
    expect(within(a.getByTestId('challenge-facts')).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Gym days', 'Counted by the app', 'Most wins', 'The first team', 'Everyone in the app · 143']);
    // The first three people are not drawn for a challenge in teams.
    expect(a.queryByRole('list', { name: 'In the lead: October Week' })).toBeNull();
    const b = cardOf('Pick Week');
    expect(within(b.getByTestId('challenge-teams')).getByText('Teams · your members pick their own')).toBeTruthy();
    expect(texts(b.getByRole('list', { name: 'Teams: Pick Week' }))).toEqual(['Red TeamNobody yet', 'Blue TeamNobody yet']);
    // Staff may put people in teams either way; a challenge people are in alone has no such button.
    expect(a.getByRole('button', { name: 'Put people in teams: October Week' })).toBeTruthy();
    expect(b.getByRole('button', { name: 'Put people in teams: Pick Week' })).toBeTruthy();
    const c = cardOf('Solo Week');
    expect(c.queryByTestId('challenge-teams')).toBeNull();
    expect(c.queryByRole('button', { name: /Put people in teams/ })).toBeNull();
  });

  it('an ended or cancelled challenge, and a gym that can only read, have no Put people in teams', async () => {
    svc.list.mockResolvedValue(listOf([challenge('x', 'Cancelled Week', { cancelled: true })], { past: [challenge('p', 'Last Week', { state: 'ended', startsOn: '2026-09-28', endsOn: '2026-10-04' })], pastTotal: 1 }));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cardOf('Cancelled Week').queryByRole('button', { name: /Put people in teams/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Past challenges (1)' }));
    expect(cardOf('Last Week').queryByRole('button', { name: /Put people in teams/ })).toBeNull();
    cleanup();
    resetConsoleOrgs();
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week')]));
    open({ ...ORG, consoleReadOnly: true });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cardOf('October Week').queryByRole('button', { name: /Put people in teams/ })).toBeNull();
  });
});

describe('putting people in teams', () => {
  const PEOPLE = [row('u1', 'Asha Rao', RED, { value: 3 }), row('u2', 'Bilal Khan', null), row('u3', 'Chen Wu', BLUE), row('u4', 'Dev Shah', null)];
  const openTeams = async (rows = PEOPLE, over = {}) => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week', over)]));
    svc.board.mockResolvedValue(boardOf(rows));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(cardOf('October Week').getByRole('button', { name: 'Put people in teams: October Week' }));
    await screen.findByTestId('challenge-board');
    return within(screen.getByTestId('challenge-board'));
  };
  const move = (board, name, teamId) => fireEvent.change(board.getByLabelText(`${name}: team`), { target: { value: teamId ?? '' } });

  it('reading the board, each person carries their team; no box to pick one', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week')]));
    svc.board.mockResolvedValue(boardOf(PEOPLE));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(cardOf('October Week').getByRole('button', { name: 'See the board: October Week' }));
    const board = within(await screen.findByTestId('challenge-board'));
    expect(board.getAllByTestId('challenge-row').map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      '—Asha RaoRed Team3',
      '—Bilal KhanNothing counted yetNo team0',
      '—Chen WuNothing counted yetBlue Team0',
      '—Dev ShahNothing counted yetNo team0',
    ]);
    expect(board.queryByRole('combobox')).toBeNull();
    expect(board.queryByRole('button', { name: 'Save teams' })).toBeNull();
  });

  it('each person has a team to pick; Save names exactly the people who change, and only they are sent', async () => {
    const board = await openTeams();
    expect(board.getByText('Pick a team beside each person and press Save teams. Somebody left on No team is in the challenge, and their number counts for no team.')).toBeTruthy();
    expect(board.getAllByRole('combobox').map((box) => [box.getAttribute('aria-label'), box.value])).toEqual([
      ['Asha Rao: team', RED],
      ['Bilal Khan: team', ''],
      ['Chen Wu: team', BLUE],
      ['Dev Shah: team', ''],
    ]);
    expect(within(board.getByLabelText('Asha Rao: team')).getAllByRole('option').map((o) => o.textContent)).toEqual(['No team', 'Red Team', 'Blue Team']);

    // Nothing moved: said, no box, nothing sent.
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    expect(board.getByRole('status').textContent).toBe('Nobody has been moved yet. Pick a team beside a person first.');
    expect(screen.queryByRole('group', { name: /^Move/ })).toBeNull();

    move(board, 'Asha Rao', BLUE);
    move(board, 'Bilal Khan', RED);
    move(board, 'Chen Wu', null);
    // Dev is picked a team and put back: he does not change, and is not named or sent.
    move(board, 'Dev Shah', RED);
    move(board, 'Dev Shah', null);
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    const box = within(screen.getByRole('group', { name: 'Move 3 people?' }));
    expect(box.getByText('Asha Rao: Red Team → Blue Team')).toBeTruthy();
    expect(box.getByText('Bilal Khan: No team → Red Team')).toBeTruthy();
    expect(box.getByText('Chen Wu: Blue Team → No team')).toBeTruthy();
    expect(box.queryByText(/Dev Shah/)).toBeNull();
    expect(box.getByText('Nobody else is moved.')).toBeTruthy();
    expect(box.getByText("The challenge is running, so each of these people's numbers moves with them: the teams' numbers change straight away. Your members see their new team in the app. Nobody is emailed.")).toBeTruthy();
    expect(svc.setTeamPeople).not.toHaveBeenCalled();

    // Keep editing closes the box and sends nothing; the picks are still there.
    fireEvent.click(box.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('group', { name: 'Move 3 people?' })).toBeNull();
    expect(svc.setTeamPeople).not.toHaveBeenCalled();
    expect(board.getByLabelText('Asha Rao: team').value).toBe(BLUE);

    svc.setTeamPeople.mockResolvedValue(3);
    svc.board.mockResolvedValue(boardOf([row('u1', 'Asha Rao', BLUE, { value: 3 }), row('u2', 'Bilal Khan', RED), row('u3', 'Chen Wu', null), row('u4', 'Dev Shah', null)]));
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Move 3 people?' })).getByRole('button', { name: 'Move 3 people' }));
    await waitFor(() => expect(svc.setTeamPeople).toHaveBeenCalledTimes(1));
    expect(svc.setTeamPeople.mock.calls[0]).toEqual([
      'g1',
      'a',
      [
        { userId: 'u1', teamId: BLUE },
        { userId: 'u2', teamId: RED },
        { userId: 'u3', teamId: null },
      ],
    ]);
    expect((await board.findByRole('status')).textContent).toBe('Saved. 3 people moved.');
    // The card's own teams are read again.
    await waitFor(() => expect(svc.list.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(board.getByLabelText('Chen Wu: team').value).toBe('');
  });

  it('one person: the box and its button say one, and before it starts nothing is said about numbers moving', async () => {
    const board = await openTeams(PEOPLE, { state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18', withNumber: null });
    move(board, 'Dev Shah', BLUE);
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    const box = within(screen.getByRole('group', { name: 'Move 1 person?' }));
    expect(box.getByText('Dev Shah: No team → Blue Team')).toBeTruthy();
    expect(box.getByText('Your members see their team in the app. Nobody is emailed.')).toBeTruthy();
    expect(box.queryByText(/numbers moves/)).toBeNull();
    expect(box.getByRole('button', { name: 'Move 1 person' })).toBeTruthy();
  });

  it('more than five people: five are named, the rest counted, and every one is sent', async () => {
    const many = Array.from({ length: 8 }, (_v, i) => row(`m${i}`, `Member ${i}`, null));
    const board = await openTeams(many);
    for (const p of many) move(board, p.name, RED);
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    const box = within(screen.getByRole('group', { name: 'Move 8 people?' }));
    expect(box.getAllByText(/^Member \d: No team → Red Team$/)).toHaveLength(5);
    expect(box.getByText('and 3 more')).toBeTruthy();
    svc.setTeamPeople.mockResolvedValue(8);
    fireEvent.click(box.getByRole('button', { name: 'Move 8 people' }));
    await waitFor(() => expect(svc.setTeamPeople).toHaveBeenCalledTimes(1));
    expect(svc.setTeamPeople.mock.calls[0][2]).toEqual(many.map((p) => ({ userId: p.userId, teamId: RED })));
  });

  it('a pick on page 1 is kept on page 2 and saved from there, and the page says it is waiting', async () => {
    const page1 = boardOf([row('u1', 'Asha Rao', null)], { page: 1, pages: 2, total: 101 });
    const page2 = boardOf([row('u9', 'Zara Ali', null)], { page: 2, pages: 2, total: 101 });
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week')]));
    svc.board.mockImplementation(async (_g, _c, page) => (page === 2 ? page2 : page1));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(cardOf('October Week').getByRole('button', { name: 'Put people in teams: October Week' }));
    const board = within(await screen.findByTestId('challenge-board'));
    move(board, 'Asha Rao', RED);
    expect(board.getByRole('note').textContent).toBe('1 person is moved and not saved yet. They are kept while you change page; press Save teams to save them all.');
    fireEvent.click(board.getByRole('button', { name: 'Next' }));
    await board.findByLabelText('Zara Ali: team');
    move(board, 'Zara Ali', BLUE);
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    const box = within(screen.getByRole('group', { name: 'Move 2 people?' }));
    expect(box.getByText('Asha Rao: No team → Red Team')).toBeTruthy();
    expect(box.getByText('Zara Ali: No team → Blue Team')).toBeTruthy();
    svc.setTeamPeople.mockResolvedValue(2);
    fireEvent.click(box.getByRole('button', { name: 'Move 2 people' }));
    await waitFor(() => expect(svc.setTeamPeople).toHaveBeenCalledTimes(1));
    expect(svc.setTeamPeople.mock.calls[0][2]).toEqual([
      { userId: 'u1', teamId: RED },
      { userId: 'u9', teamId: BLUE },
    ]);
  });

  it('a save the server refuses says why, closes the box and reads the list again', async () => {
    const board = await openTeams();
    move(board, 'Bilal Khan', RED);
    fireEvent.click(board.getByRole('button', { name: 'Save teams' }));
    svc.setTeamPeople.mockRejectedValue(refusal(409, "One of these people isn't in this challenge any more. Load the list again."));
    const before = svc.board.mock.calls.length;
    fireEvent.click(within(screen.getByRole('group', { name: 'Move 1 person?' })).getByRole('button', { name: 'Move 1 person' }));
    expect((await board.findByRole('alert')).textContent).toBe("One of these people isn't in this challenge any more. Load the list again.");
    expect(screen.queryByRole('group', { name: 'Move 1 person?' })).toBeNull();
    expect(svc.board.mock.calls.length).toBeGreaterThan(before);
  });

  it('where members pick, the help says staff may still move somebody', async () => {
    const board = await openTeams(PEOPLE, { teams: 'members' });
    expect(board.getByText('Your members pick their own team in the app. You can also put somebody in a team here, or move them: pick the team beside their name and press Save teams.')).toBeTruthy();
  });
});
