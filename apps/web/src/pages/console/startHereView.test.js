// Overview's "Start here" list (ROADMAP 23b): what is drawn from the server's answer.
import { describe, expect, it } from 'vitest';
import { startHereCount, startHereView } from './startHereView';

const ALL = ['memberships', 'members', 'staff', 'classes', 'hours', 'frontDesk'];
const answer = ({ done = [], steps = ALL, hidden = false, canHide = true } = {}) => ({
  hidden,
  canHide,
  steps: steps.map((step) => ({ step, done: done.includes(step) })),
});
const view = (startHere, orgType = 'gym') => startHereView(startHere, 'iron-house', orgType);

describe('where each button goes', () => {
  it('every step opens the page where it is done: Memberships its own page, staff on Members → Staff with the form open, and the Settings ones name their section', () => {
    const rows = view(answer()).rows;
    expect(rows.map((r) => [r.step, r.actions.map((a) => [a.label, a.to])])).toEqual([
      ['memberships', [['Set up memberships', '/console/iron-house/memberships']]],
      [
        'members',
        [
          ['Import members', '/console/iron-house/members?open=import'],
          ['Add member', '/console/iron-house/members?open=add'],
        ],
      ],
      ['staff', [['Invite staff', '/console/iron-house/members?view=staff&open=invite']]],
      ['classes', [['Set up classes', '/console/iron-house/classes']]],
      ['hours', [['Set opening hours', '/console/iron-house/settings#opening-hours']]],
      ['frontDesk', [['Set up check-in', '/console/iron-house/settings#check-in-devices']]],
    ]);
  });

  it('only the three that open a form are marked as changes: the two for the member list, and Invite staff', () => {
    const rows = view(answer()).rows;
    const changing = rows.flatMap((r) => r.actions.filter((a) => a.changes === true).map((a) => a.label));
    expect(changing).toEqual(['Import members', 'Add member', 'Invite staff']);
  });

  it("a studio's and a trainer's own words", () => {
    const studio = view(answer({ steps: ['members', 'hours'] }), 'studio').rows;
    expect(studio[0].title).toBe('Bring your clients in');
    expect(studio[0].actions.map((a) => a.label)).toEqual(['Import clients', 'Add client']);
    expect(studio[1].line).toBe("Say when you're open, so your clients see it in the app.");
  });
});

describe('what is drawn', () => {
  it('a new gym: six steps, none done, the first one next', () => {
    const v = view(answer());
    expect(v.show).toBe('list');
    expect([v.doneCount, v.total, v.allDone, v.hasMembers]).toEqual([0, 6, false, true]);
    expect(startHereCount(v)).toBe('0 of 6 done');
    expect(v.rows.filter((r) => r.next).map((r) => r.step)).toEqual(['memberships']);
  });

  it('the next step is the first one not done, wherever it is', () => {
    const v = view(answer({ done: ['memberships', 'members', 'classes'] }));
    expect(startHereCount(v)).toBe('3 of 6 done');
    expect(v.rows.filter((r) => r.next).map((r) => r.step)).toEqual(['staff']);
    expect(v.rows.map((r) => r.done)).toEqual([true, true, false, true, false, false]);
  });

  it("somebody's own steps only: the count is theirs", () => {
    const v = view(answer({ steps: ['memberships', 'members', 'classes'], done: ['members'], canHide: false }));
    expect(startHereCount(v)).toBe('1 of 3 done');
    expect(v.canHide).toBe(false);
    expect(v.rows.map((r) => r.step)).toEqual(['memberships', 'members', 'classes']);
  });

  const quiet = [
    ['the read is on its way or failed', null],
    ['an answer with no steps list', { hidden: false, canHide: true }],
    ['somebody with no step of their own', answer({ steps: [], canHide: false })],
    ['hidden, for somebody who cannot show it', answer({ hidden: true, canHide: false })],
    ['all done, for somebody who cannot hide it', answer({ steps: ['members'], done: ['members'], canHide: false })],
    ['a step this build has never heard of, alone', { hidden: false, canHide: true, steps: [{ step: 'billing', done: false }] }],
  ];
  it.each(quiet)('nothing at all: %s', (_name, startHere) => {
    const v = view(startHere);
    expect(v.show).toBe('none');
    expect(v.hasMembers).toBe(false);
    expect(v.rows).toEqual([]);
  });

  it('hidden, for whoever may show it: only the line that brings it back', () => {
    const v = view(answer({ hidden: true, done: ['members'] }));
    expect(v.show).toBe('hidden');
    expect(v.canHide).toBe(true);
    // No list is drawn, so "Bring your members in" is not left out either.
    expect(v.hasMembers).toBe(false);
  });

  it('all done, for whoever may hide it: the finished box, nothing next', () => {
    const v = view(answer({ done: ALL }));
    expect(v.show).toBe('list');
    expect(v.allDone).toBe(true);
    expect(startHereCount(v)).toBe('6 of 6 done');
    expect(v.rows.some((r) => r.next)).toBe(false);
  });

  it('a step this build has never heard of is left out of the rows and the count', () => {
    const v = view({ hidden: false, canHide: true, steps: [{ step: 'members', done: true }, { step: 'billing', done: false }] });
    expect(v.rows.map((r) => r.step)).toEqual(['members']);
    expect(startHereCount(v)).toBe('1 of 1 done');
  });
});
