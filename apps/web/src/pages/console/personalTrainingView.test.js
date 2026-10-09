// PERSONAL TRAINING, the words and the hours form (ROADMAP 17e-i). The worst thing this
// screen could do is say a cancel is free when it keeps a session used, or send hours the
// trainer did not type: both are read here from what the server sent.
import { describe, expect, it } from 'vitest';
import { addPtTimeOffRequestSchema, savePtTrainerRequestSchema } from '@app/shared';
import {
  addRange,
  bookCost,
  limitLeft,
  bookSentence,
  bookableUntil,
  canAddRange,
  canGoEarlier,
  dayTabs,
  hoursBrief,
  pickDay,
  markRow,
  pastDaysNote,
  canGoLater,
  cancelBox,
  classInTimeOff,
  coachedClassRow,
  dayHeading,
  dayTimeOffRow,
  durationWords,
  freeTimeLabel,
  hoursDraft,
  hoursFormProblem,
  hoursRequest,
  noTimesNote,
  peopleHeading,
  personRow,
  pickTrainer,
  pickerIsEmpty,
  removeRange,
  sessionClash,
  sessionLength,
  timeOffAsked,
  timeOffBoxLines,
  timeOffBoxRow,
  timeOffBoxTitle,
  timeOffDayLimits,
  timeOffDraft,
  timeOffFormProblem,
  timeOffLine,
  timeOffOverlap,
  timeOffRemoveBox,
  timeOffRequest,
  timeOffSummary,
  sessionRow,
  sessionsAWeek,
  setRange,
  setupCount,
  setupSteps,
  trainerGroups,
  trainerName,
  trainerSummary,
  weekTitle,
} from './personalTrainingView';

const trainer = (over = {}) => ({
  userId: 'u-sam',
  name: 'Sam Reed',
  initials: 'SR',
  offers: true,
  sessionMinutes: 60,
  hours: [
    { weekday: 1, fromMinute: 960, toMinute: 1200 },
    { weekday: 1, fromMinute: 540, toMinute: 660 },
    { weekday: 5, fromMinute: 420, toMinute: 600 },
  ],
  mine: false,
  ...over,
});
const notSetUp = (over = {}) => trainer({ sessionMinutes: null, offers: false, hours: [], ...over });
const session = (over = {}) => ({
  id: 'a1',
  trainerId: 'u-sam',
  localDate: '2026-10-09',
  localStartMinute: 600,
  minutes: 60,
  startsAt: '2026-10-09T09:00:00.000Z',
  status: 'booked',
  name: 'Maya Lopez',
  initials: 'ML',
  entryId: null,
  membership: 'PT 10',
  packCharged: true,
  usesLimit: false,
  cancel: 'free',
  ...over,
});

describe('a trainer on the page', () => {
  it('reads in plain words whether they take sessions', () => {
    expect(trainerSummary(trainer())).toBe('60-minute sessions');
    expect(trainerSummary(trainer({ sessionMinutes: 20 }))).toBe('20-minute sessions');
    expect(trainerSummary(trainer({ offers: false }))).toBe('Not taking sessions');
    expect(trainerSummary(trainer({ hours: [] }))).toBe('Taking sessions, but no hours set');
    expect(trainerSummary(notSetUp())).toBe('No hours set yet');
    expect(trainerName(trainer({ mine: true }))).toBe('Sam Reed (you)');
    expect(trainerName(trainer({ name: null }))).toBe('A member of staff');
  });

  it('lists their hours by day, earliest first, on the clock the gym reads', () => {
    expect(hoursBrief(trainer(), '24h')).toEqual(['Mon · 09:00 – 11:00, 16:00 – 20:00', 'Fri · 07:00 – 10:00']);
    expect(hoursBrief(trainer(), '12h')).toEqual(['Mon · 9:00 AM – 11:00 AM, 4:00 PM – 8:00 PM', 'Fri · 7:00 AM – 10:00 AM']);
    expect(hoursBrief(trainer({ hours: [] }), '24h')).toEqual([]);
  });

  it('the staff are those set up to take sessions, and the rest who can be added', () => {
    const ana = notSetUp({ userId: 'u-ana', name: 'Ana' });
    const groups = trainerGroups([ana, trainer(), trainer({ userId: 'u-off', offers: false })]);
    expect(groups.setUp.map((t) => t.userId)).toEqual(['u-sam', 'u-off']);
    expect(groups.others.map((t) => t.userId)).toEqual(['u-ana']);
    expect(trainerGroups(undefined)).toEqual({ setUp: [], others: [] });
  });

  it('whoever runs the timetable is never shown as a trainer they are not: the week is of somebody set up, or of nobody', () => {
    const ana = notSetUp({ userId: 'u-ana', name: 'Ana' });
    const me = notSetUp({ userId: 'u-me', mine: true });
    const sam = trainer();
    const meSetUp = trainer({ userId: 'u-me', mine: true });
    expect(pickTrainer([ana, me, sam], null, true).userId).toBe('u-sam');
    expect(pickTrainer([ana, me, sam], 'u-sam', true).userId).toBe('u-sam');
    // Somebody not set up cannot be the week shown, even when the address names them.
    expect(pickTrainer([ana, me, sam], 'u-ana', true).userId).toBe('u-sam');
    expect(pickTrainer([ana, me], null, true)).toBeNull();
    // An owner who does train sees their own week first.
    expect(pickTrainer([sam, meSetUp], null, true).userId).toBe('u-me');
    expect(pickTrainer([], null, true)).toBeNull();
    // Somebody who sees only their own row always gets it.
    expect(pickTrainer([me], null, false).userId).toBe('u-me');
    expect(pickTrainer([me], 'u-sam', false).userId).toBe('u-me');
  });
});

describe('the hours form', () => {
  it('opens as the trainer was saved, and sends back exactly that', () => {
    const draft = hoursDraft(trainer());
    expect(draft.days[1]).toEqual([
      { from: '09:00', to: '11:00' },
      { from: '16:00', to: '20:00' },
    ]);
    expect(draft.days[2]).toEqual([]);
    expect(hoursFormProblem(draft)).toBeNull();
    const body = hoursRequest(draft);
    expect(body).toEqual({
      offers: true,
      sessionMinutes: 60,
      hours: [
        { weekday: 1, fromMinute: 540, toMinute: 660 },
        { weekday: 1, fromMinute: 960, toMinute: 1200 },
        { weekday: 5, fromMinute: 420, toMinute: 600 },
      ],
    });
    expect(savePtTrainerRequestSchema.safeParse(body).success).toBe(true);
    expect(sessionsAWeek(draft)).toBe('9 sessions a week');
  });

  it('a session is as long as the gym types: any length on a five-minute mark from 10 minutes to 4 hours', () => {
    expect(['10', '20', ' 45 ', '75', '240'].map(sessionLength)).toEqual([10, 20, 45, 75, 240]);
    expect(['', '5', '52', '245', '60.5', 'sixty', '-30', '1e2'].map(sessionLength)).toEqual([null, null, null, null, null, null, null, null]);
    const draft = hoursDraft(trainer());
    const typed = { ...draft, sessionMinutes: '20' };
    expect(hoursFormProblem(typed)).toBeNull();
    expect(hoursRequest(typed).sessionMinutes).toBe(20);
    expect(savePtTrainerRequestSchema.safeParse(hoursRequest(typed)).success).toBe(true);
    // 2 + 4 + 3 hours in pieces of 20 minutes.
    expect(sessionsAWeek(typed)).toBe('27 sessions a week');
    expect(hoursFormProblem({ ...draft, sessionMinutes: '52' })).toBe(
      'Type how long a session is, in minutes. Any length from 10 to 240 minutes, in steps of 5.',
    );
    expect(hoursFormProblem({ ...draft, sessionMinutes: '' })).toContain('Type how long a session is');
  });

  it('somebody with nothing set starts ticked to take sessions, at 60 minutes, with no hours', () => {
    const draft = hoursDraft(notSetUp());
    expect([draft.offers, draft.sessionMinutes]).toEqual([true, '60']);
    expect(hoursFormProblem(draft)).toBe('Add the hours they train, or untick "Takes personal training sessions".');
    // Unticked, no hours is fine: they take none.
    expect(hoursFormProblem({ ...draft, offers: false })).toBeNull();
    expect(hoursRequest({ ...draft, offers: false })).toEqual({ offers: false, sessionMinutes: 60, hours: [] });
  });

  it('says the one thing wrong, and nothing can be sent until it is right', () => {
    const empty = hoursDraft(trainer({ hours: [] }));
    const with_ = (weekday, ...ranges) => ranges.reduce((d, r, n) => setRange(addRange(d, weekday), weekday, n, r), empty);
    expect(hoursFormProblem(with_(2, { from: '09:00', to: '' }))).toBe('Pick a start and an end time for each set of hours, or remove it.');
    expect(hoursFormProblem(with_(2, { from: '11:00', to: '09:00' }))).toBe('Each set of hours must end after it starts.');
    expect(hoursFormProblem(with_(2, { from: '09:00', to: '12:00' }, { from: '11:00', to: '13:00' }))).toBe('Two sets of hours on the same day overlap.');
    expect(hoursFormProblem(with_(3, { from: '09:00', to: '09:30' }))).toBe(
      'Wednesday has hours shorter than one 60-minute session. Make them longer, or remove them.',
    );
    // The same half hour is enough for a 30-minute session.
    expect(hoursFormProblem({ ...with_(3, { from: '09:00', to: '09:30' }), sessionMinutes: '30' })).toBeNull();
    // Midnight at the end of the day.
    const late = with_(6, { from: '22:00', to: '24:00' });
    expect(hoursFormProblem(late)).toBeNull();
    expect(hoursRequest(late).hours).toEqual([{ weekday: 6, fromMinute: 1320, toMinute: 1440 }]);
  });

  it('a day holds three sets of hours, and one can be taken off', () => {
    let draft = hoursDraft(trainer({ hours: [] }));
    for (let n = 0; n < 3; n++) {
      expect(canAddRange(draft, 4)).toBe(true);
      draft = addRange(draft, 4);
    }
    expect(canAddRange(draft, 4)).toBe(false);
    draft = setRange(draft, 4, 1, { from: '10:00', to: '11:00' });
    expect(removeRange(draft, 4, 0).days[4]).toEqual([
      { from: '10:00', to: '11:00' },
      { from: '', to: '' },
    ]);
  });
});

describe('the week', () => {
  const week = { today: '2026-10-07', from: '2026-10-07', to: '2026-10-13', lastDay: '2026-12-01', sessionMinutes: 60, offers: true };
  it('is titled by its days and stops at today and at the last day', () => {
    expect(weekTitle(week)).toBe('Wed 7 Oct – Tue 13 Oct');
    expect([canGoEarlier(week), canGoLater(week)]).toEqual([false, true]);
    expect([canGoEarlier({ ...week, from: '2026-10-14', to: '2026-10-20' }), canGoLater({ ...week, from: '2026-11-25', to: '2026-12-01' })]).toEqual([true, false]);
    expect(dayHeading('2026-10-07', '2026-10-07')).toBe('Today · Wed 7 Oct');
    expect(dayHeading('2026-10-08', '2026-10-07')).toBe('Thu 8 Oct');
  });

  it('says why a trainer has no times, only when that needs saying', () => {
    expect(noTimesNote(week, trainer())).toBeNull();
    expect(noTimesNote({ ...week, sessionMinutes: null, offers: false }, trainer())).toBe('Sam Reed has no hours yet. Set their hours to book sessions.');
    expect(noTimesNote({ ...week, offers: false }, trainer())).toBe("Sam Reed isn't taking sessions. Their booked sessions are still shown.");
  });

  it('says how far ahead it goes, by the day', () => {
    expect(bookableUntil(week)).toBe('Sessions can be booked up to Tue 1 Dec.');
  });

  it('a class the trainer coaches reads its time and its name, and a session booked into it says so', () => {
    const spin = { name: 'Spin', localStartMinute: 615, minutes: 45 };
    expect(coachedClassRow(spin, '24h')).toBe('10:15 – 11:00 · Spin');
    expect(coachedClassRow(spin, '12h')).toBe('10:15 AM – 11:00 AM · Spin');
    // A session from 10:00 to 11:00 runs into it; one that ends at 10:15, or starts at 11:00, does not.
    expect(sessionClash(session(), [spin])).toBe('This runs into Spin, a class they coach at the same time. Move one of them.');
    expect(sessionClash(session({ localStartMinute: 555 }), [spin])).toBeNull();
    expect(sessionClash(session({ localStartMinute: 660 }), [spin])).toBeNull();
    expect(sessionClash(session(), [])).toBeNull();
    expect(sessionClash(session(), undefined)).toBeNull();
  });


  it('a free time reads as the whole session, start to end', () => {
    expect(freeTimeLabel(540, 60, '24h')).toBe('09:00 – 10:00');
    expect(freeTimeLabel(540, 20, '12h')).toBe('9:00 AM – 9:20 AM');
  });

  it('a session reads its time, its person and what it was booked on', () => {
    expect(sessionRow(session(), '24h')).toEqual({ time: '10:00 – 11:00', name: 'Maya Lopez', detail: 'PT 10 · 1 session used' });
    expect(sessionRow(session({ packCharged: false, membership: 'PT Unlimited' }), '24h').detail).toBe('PT Unlimited');
    expect(sessionRow(session({ packCharged: false, membership: null }), '24h').detail).toBe('');
    // A reader who is not sent the membership's name still reads that a session is used.
    expect(sessionRow(session({ packCharged: true, membership: null }), '24h').detail).toBe('1 session used from their pack');
    expect(sessionRow(session({ name: null }), '12h')).toMatchObject({ time: '10:00 AM – 11:00 AM', name: 'Somebody no longer on your list' });
  });
});

describe('picking the person', () => {
  const maya = { entryId: 'e1', name: 'Maya Lopez', pt: { membership: 'PT 10', sessionsLeft: 9 } };
  it('somebody with a pack reads how many sessions are left; a membership without a count reads its name', () => {
    expect(personRow(maya, true)).toEqual({ name: 'Maya Lopez', detail: 'PT 10 · 9 sessions left', pickable: true });
    expect(personRow({ ...maya, pt: { membership: 'PT 10', sessionsLeft: 1 } }, true).detail).toBe('PT 10 · 1 session left');
    expect(personRow({ ...maya, pt: { membership: 'PT Unlimited', sessionsLeft: null } }, true).detail).toBe('PT Unlimited');
  });
  it('where the gym sells memberships, somebody with nothing that includes it cannot be picked, and the row says why', () => {
    expect(personRow({ entryId: 'e2', name: 'Leo Grant', pt: null }, true)).toEqual({
      name: 'Leo Grant',
      detail: 'No membership that includes personal training',
      pickable: false,
    });
    // A gym with no memberships books anybody on its list.
    expect(personRow({ entryId: 'e2', name: 'Leo Grant', pt: null }, false)).toEqual({ name: 'Leo Grant', detail: '', pickable: true });
  });
  it('a membership with a limit reads what is left that week or month; with none left the person cannot be picked, and the row says why', () => {
    const gold = { membership: 'Gold', limit: 4, period: 'week', left: 3 };
    const onGold = { entryId: 'e3', name: 'Noor Khan', pt: { membership: 'Gold', sessionsLeft: null }, limit: gold };
    expect(limitLeft(gold)).toBe('3 of 4 sessions left that week');
    expect(limitLeft({ ...gold, limit: 1, left: 1, period: 'month' })).toBe('1 of 1 session left that month');
    expect(limitLeft({ ...gold, left: 0 })).toBe('no sessions left that week');
    expect(personRow(onGold, true)).toEqual({ name: 'Noor Khan', detail: 'Gold · 3 of 4 sessions left that week', pickable: true });
    expect(personRow({ ...onGold, pt: null, limit: { ...gold, left: 0 } }, true)).toEqual({
      name: 'Noor Khan',
      detail: 'Gold · no sessions left that week',
      pickable: false,
    });
    // Past the limit a pack pays: the row is the pack's, and says nothing of the limit.
    expect(personRow({ ...onGold, pt: { membership: 'PT 10', sessionsLeft: 9 }, limit: null }, true).detail).toBe('PT 10 · 9 sessions left');
    expect(bookCost(onGold)).toBe('It is booked on Gold, which includes 4 a week: 3 of 4 sessions left that week, before this one.');
    expect(bookCost({ ...onGold, limit: null })).toBe('It is booked on Gold.');
    // A pack that pays because Gold's sessions are used says so.
    expect(bookCost({ ...onGold, pt: { membership: 'PT 10', sessionsLeft: 9 }, limit: { ...gold, left: 0 } })).toBe("One session is used from PT 10. Gold's sessions for that week are used.");
  });
  it('cancelling a session that counts against a limit: free says it no longer counts; late gives staff both choices, as a pack does', () => {
    const view = { freeCancelMinutes: 120, clockFormat: '24h' };
    const counted = session({ membership: 'Gold', packCharged: false, usesLimit: true });
    expect(cancelBox(counted, view).question).toBe(
      "Cancel Maya Lopez's session on Fri 9 Oct, 10:00 – 11:00? It's free to cancel, and it no longer counts as one of the sessions their membership includes.",
    );
    const late = cancelBox({ ...counted, cancel: 'late' }, view);
    expect(late.question).toContain('Choose whether it still counts as one of the sessions their membership includes.');
    expect(late.choices).toEqual([
      { key: 'late', label: 'Late cancel: the session stays used', lateOk: true, giveBack: false },
      { key: 'back', label: 'Cancel and give the session back', lateOk: true, giveBack: true },
    ]);
    // A membership with no limit has nothing to keep used: one choice, as before.
    const open = cancelBox({ ...counted, usesLimit: false, cancel: 'late' }, view);
    expect(open.choices).toEqual([{ key: 'late', label: 'Cancel session', lateOk: true, giveBack: false }]);
    // A pack's own two choices are as they were.
    expect(cancelBox(session({ cancel: 'late' }), view).choices.map((c) => c.key)).toEqual(['late', 'back']);
  });
  it('the list says what it is showing', () => {
    expect(peopleHeading({ gymHasTypes: true, people: [maya] }, '')).toBe('Your members, people with personal training first');
    expect(peopleHeading({ gymHasTypes: false, people: [maya] }, '  ')).toBe('Your members');
    expect(peopleHeading({ gymHasTypes: true, people: [] }, '')).toBe('Your member list is empty. Add people on Members first.');
    // The page is named as this kind of organisation's menu names it.
    expect(peopleHeading({ gymHasTypes: true, people: [] }, '', 'studio')).toBe('Your member list is empty. Add people on Clients first.');
    // Its button is offered for an empty list alone, never for a search that found nobody.
    expect(pickerIsEmpty({ people: [] }, '  ')).toBe(true);
    expect(pickerIsEmpty({ people: [] }, 'zzz')).toBe(false);
    expect(pickerIsEmpty({ people: [maya] }, '')).toBe(false);
    expect(pickerIsEmpty(null, '')).toBe(false);
    expect(peopleHeading({ gymHasTypes: true, people: [maya] }, 'may')).toBe('Matching people');
    expect(peopleHeading({ gymHasTypes: true, people: [] }, 'zzz')).toBe('Nobody on your member list matches.');
  });
  it('the box before a booking names who is booked, with whom and when, and what it uses', () => {
    const at = { trainer: trainer(), localDate: '2026-10-09', startMinute: 600, minutes: 60, clockFormat: '24h' };
    expect(bookSentence({ ...at, person: maya })).toBe('Maya Lopez will be booked with Sam Reed on Fri 9 Oct, 10:00 – 11:00.');
    expect(bookSentence({ ...at, person: null })).toBe('Pick who the session is for.');
    expect(bookCost(maya)).toBe('One session is used from PT 10.');
    expect(bookCost({ ...maya, pt: { membership: 'PT Unlimited', sessionsLeft: null } })).toBe('It is booked on PT Unlimited.');
    expect(bookCost({ ...maya, pt: null })).toBe('');
  });
});

describe('the box before a cancel', () => {
  const view = { freeCancelMinutes: 120, clockFormat: '24h' };
  it('a free cancel says the pack gets its session back, only where a pack was charged', () => {
    expect(cancelBox(session(), view)).toEqual({
      question: "Cancel Maya Lopez's session on Fri 9 Oct, 10:00 – 11:00? It's free to cancel, and their pack gets the session back.",
      choices: [{ key: 'free', label: 'Cancel session', lateOk: false, giveBack: false }],
    });
    expect(cancelBox(session({ packCharged: false }), view).question).toBe("Cancel Maya Lopez's session on Fri 9 Oct, 10:00 – 11:00? It's free to cancel.");
  });

  it('a late cancel on a pack offers both outcomes, each button saying what happens to the session', () => {
    const box = cancelBox(session({ cancel: 'late' }), view);
    expect(box.question).toBe(
      "Cancel Maya Lopez's session on Fri 9 Oct, 10:00 – 11:00? It starts in less than 2 hours, so it's too late to cancel for free. Choose what happens to the session on their pack.",
    );
    expect(box.choices).toEqual([
      { key: 'late', label: 'Late cancel: the session stays used', lateOk: true, giveBack: false },
      { key: 'back', label: 'Cancel and give the session back', lateOk: true, giveBack: true },
    ]);
    // Never a free-sounding button on a late cancel.
    expect(box.choices.every((c) => c.lateOk)).toBe(true);
  });

  it('a late cancel with no pack has one outcome, and says it is recorded as late', () => {
    const box = cancelBox(session({ cancel: 'late', packCharged: false }), { ...view, freeCancelMinutes: 90 });
    expect(box.question).toContain("It starts in less than 90 minutes, so it's too late to cancel for free. It will be recorded as a late cancel.");
    expect(box.choices).toEqual([{ key: 'late', label: 'Cancel session', lateOk: true, giveBack: false }]);
  });

  it('a length of time in words', () => {
    expect([30, 60, 90, 120, 1440, 2880].map(durationWords)).toEqual(['30 minutes', '1 hour', '90 minutes', '2 hours', '1 day', '2 days']);
  });
});

// 17e-iii-b. The worst thing these words could do: say a time off cancels nobody while the
// box hides a session in it, or send days the form did not show.
describe("a trainer's time off", () => {
  const TODAY = '2026-10-07';
  const KEY = '00000000-0000-4000-8000-000000000081';
  const days = (fromDate, toDate) => ({ id: 'o1', fromDate, toDate, fromMinute: null, toMinute: null });
  const hours = (day, fromMinute, toMinute) => ({ id: 'o2', fromDate: day, toDate: day, fromMinute, toMinute });
  const samReed = { name: 'Sam Reed', mine: false };

  it('one time off reads as its days, or its day and hours, on the gym’s clock, with the year when it is not this one', () => {
    expect(timeOffLine(days('2026-10-09', '2026-10-09'), '24h', TODAY)).toBe('Fri 9 Oct · all day');
    expect(timeOffLine(days('2026-10-12', '2026-10-16'), '24h', TODAY)).toBe('Mon 12 Oct – Fri 16 Oct · all day');
    expect(timeOffLine(hours('2026-10-09', 540, 720), '12h', TODAY)).toBe('Fri 9 Oct · 9:00 AM – 12:00 PM');
    expect(timeOffLine(days('2026-12-28', '2027-01-04'), '24h', TODAY)).toBe('Mon 28 Dec – Mon 4 Jan 2027 · all day');
  });

  it('a trainer’s row names the next one and counts the rest, and says nothing with none', () => {
    expect(timeOffSummary({ timeOff: [] }, '24h', TODAY)).toBeNull();
    expect(timeOffSummary({}, '24h', TODAY)).toBeNull();
    expect(timeOffSummary({ timeOff: [days('2026-10-09', '2026-10-09')] }, '24h', TODAY)).toBe('Time off: Fri 9 Oct · all day');
    expect(timeOffSummary({ timeOff: [hours('2026-10-09', 540, 720), days('2026-10-12', '2026-10-16'), days('2026-11-02', '2026-11-02')] }, '24h', TODAY)).toBe(
      'Time off: Fri 9 Oct · 09:00 – 12:00, and 2 more',
    );
  });

  it('a day of the week says what is off', () => {
    expect(dayTimeOffRow({ id: 'o', fromMinute: null, toMinute: null }, '24h')).toBe('Time off · all day');
    expect(dayTimeOffRow({ id: 'o', fromMinute: 540, toMinute: 720 }, '12h')).toBe('Time off · 9:00 AM – 12:00 PM');
  });

  it('a session or a class inside the time off says so; one beside it does not', () => {
    const session = (localStartMinute) => ({ localStartMinute, minutes: 60 });
    const morning = [{ id: 'o', fromMinute: 600, toMinute: 720 }];
    const inIt = 'This is in their time off. Cancel it and book another time, or remove the time off.';
    expect(sessionClash(session(600), [], morning)).toBe(inIt);
    // Somebody who cannot book is told who can.
    expect(sessionClash(session(600), [], morning, false)).toBe(
      'This is in their time off. Cancel it and ask a manager to book another time, or remove the time off.',
    );
    expect(sessionClash(session(570), [], morning)).toBe(inIt);
    expect(sessionClash(session(690), [], morning)).toBe(inIt);
    expect(sessionClash(session(540), [], morning)).toBeNull();
    expect(sessionClash(session(720), [], morning)).toBeNull();
    expect(sessionClash(session(1380), [], [{ id: 'o', fromMinute: null, toMinute: null }])).toBe(inIt);
    expect(sessionClash(session(600), [], [])).toBeNull();
    expect(sessionClash(session(600), [], undefined)).toBeNull();
    // Time off is said before a class over it; outside the time off the class is still said.
    expect(sessionClash(session(600), [{ name: 'Spin', localStartMinute: 630, minutes: 45 }], morning)).toBe(inIt);
    expect(sessionClash(session(720), [{ name: 'Spin', localStartMinute: 730, minutes: 45 }], morning)).toContain('Spin');
    const spin = { name: 'Spin', localStartMinute: 630, minutes: 45 };
    expect(classInTimeOff(spin, morning)).toBe('In their time off. Give this class another coach on the Calendar.');
    // Somebody who cannot open the Calendar is told who can, and is not sent there.
    expect(classInTimeOff(spin, morning, false)).toBe('In their time off. Whoever runs the timetable can give this class another coach.');
    expect(classInTimeOff({ ...spin, localStartMinute: 720 }, morning, false)).toBeNull();
    expect(classInTimeOff({ ...spin, localStartMinute: 720 }, morning)).toBeNull();
    expect(classInTimeOff(spin, [])).toBeNull();
  });

  it.each([
    ['nothing picked', { kind: 'days', fromDate: '', toDate: '', from: '', to: '' }, 'Pick the first and the last day.'],
    ['no last day', { kind: 'days', fromDate: '2026-10-09', toDate: '', from: '', to: '' }, 'Pick the first and the last day.'],
    ['one whole day', { kind: 'days', fromDate: '2026-10-09', toDate: '2026-10-09', from: '', to: '' }, null],
    ['today', { kind: 'days', fromDate: TODAY, toDate: TODAY, from: '', to: '' }, null],
    ['started yesterday, ends tomorrow', { kind: 'days', fromDate: '2026-10-06', toDate: '2026-10-08', from: '', to: '' }, null],
    ['backwards', { kind: 'days', fromDate: '2026-10-09', toDate: '2026-10-08', from: '', to: '' }, 'The last day is before the first day.'],
    ['all in the past', { kind: 'days', fromDate: '2026-10-01', toDate: '2026-10-06', from: '', to: '' }, 'That day has already passed.'],
    ['longer than a year', { kind: 'days', fromDate: '2026-10-09', toDate: '2027-10-10', from: '', to: '' }, 'Time off can be up to a year long.'],
    ['starting more than a year ahead', { kind: 'days', fromDate: '2027-10-09', toDate: '2027-10-09', from: '', to: '' }, 'Time off can start up to a year ahead.'],
    ['a day that is not one', { kind: 'days', fromDate: '2027-02-30', toDate: '2027-03-02', from: '', to: '' }, "That isn't a day on the calendar."],
    ['part of a day, no day', { kind: 'hours', fromDate: '', toDate: '', from: '09:00', to: '12:00' }, 'Pick the day.'],
    ['part of a day, no times', { kind: 'hours', fromDate: '2026-10-09', toDate: '', from: '', to: '' }, 'Pick a start and an end time.'],
    ['part of a day, no end', { kind: 'hours', fromDate: '2026-10-09', toDate: '', from: '09:00', to: '' }, 'Pick a start and an end time.'],
    ['part of a day', { kind: 'hours', fromDate: '2026-10-09', toDate: '', from: '09:00', to: '12:00' }, null],
    ['part of a day, backwards', { kind: 'hours', fromDate: '2026-10-09', toDate: '', from: '12:00', to: '09:00' }, 'The end time must be after the start time.'],
    ['part of a day, a last day left over from Whole days', { kind: 'hours', fromDate: '2026-10-09', toDate: '2026-10-16', from: '09:00', to: '12:00' }, null],
  ])('the form: %s', (_name, draft, problem) => {
    expect(timeOffFormProblem(draft, TODAY)).toBe(problem);
    // Whatever the form lets through, the server's own schema takes.
    if (problem === null) expect(addPtTimeOffRequestSchema.safeParse(timeOffRequest(draft, KEY)).success).toBe(true);
  });

  it('the form starts empty, takes days from today to a year on, and stops at fifty', () => {
    expect(timeOffDraft()).toEqual({ kind: 'days', fromDate: '', toDate: '', from: '', to: '' });
    // The last day's calendar starts at the first day picked and runs a year from it.
    expect(timeOffDayLimits(TODAY, '')).toEqual({ min: TODAY, max: '2027-10-08', lastMin: TODAY, lastMax: '2027-10-07' });
    expect(timeOffDayLimits(TODAY, '2026-12-28')).toEqual({ min: TODAY, max: '2027-10-08', lastMin: '2026-12-28', lastMax: '2027-12-28' });
    // Whatever both calendars let through is a time off the form takes.
    expect(timeOffFormProblem({ kind: 'days', fromDate: '2027-10-08', toDate: '2028-10-07', from: '', to: '' }, TODAY)).toBeNull();
    const fine = { kind: 'days', fromDate: '2026-10-09', toDate: '2026-10-09', from: '', to: '' };
    expect(timeOffFormProblem(fine, TODAY, 49)).toBeNull();
    expect(timeOffFormProblem(fine, TODAY, 50)).toBe('A trainer can have up to 50 times off coming. Remove one first.');
  });

  it('the box before a removal names whose time off and which, and says nothing booked changes', () => {
    const week = days('2026-10-12', '2026-10-16');
    expect(timeOffRemoveBox(week, { ...samReed, timeOff: [week] }, '24h', TODAY)).toEqual({
      question: "Remove Sam Reed's time off on Mon 12 Oct – Fri 16 Oct · all day?",
      after: "These times go back to Sam Reed's usual hours, so sessions can be booked in them again. Nothing that is booked changes.",
    });
    expect(timeOffRemoveBox(hours('2026-10-09', 540, 720), { name: 'Sam Reed', mine: true }, '12h', TODAY).question).toBe(
      "Remove Sam Reed (you)'s time off on Fri 9 Oct · 9:00 AM – 12:00 PM?",
    );
  });

  it('the removal box never says the times can be booked again while other time off still covers them', () => {
    const friday = { ...days('2026-10-09', '2026-10-09'), id: 'all-day' };
    const hour = { ...hours('2026-10-09', 600, 660), id: 'hour' };
    const nextWeek = { ...days('2026-10-12', '2026-10-16'), id: 'week' };
    const sam = { ...samReed, timeOff: [friday, hour, nextWeek] };
    const stays = 'Sam Reed has other time off in these times, and that stays. Nothing that is booked changes.';
    expect(timeOffRemoveBox(hour, sam, '24h', TODAY).after).toBe(stays);
    expect(timeOffRemoveBox(friday, sam, '24h', TODAY).after).toBe(stays);
    expect(timeOffRemoveBox(nextWeek, sam, '24h', TODAY).after).toContain('so sessions can be booked in them again');
  });

  it.each([
    ['the same day, whole and part', days('2026-10-09', '2026-10-09'), hours('2026-10-09', 600, 660), true],
    ['whole days that share one day', days('2026-10-09', '2026-10-12'), days('2026-10-12', '2026-10-16'), true],
    ['whole days side by side', days('2026-10-09', '2026-10-11'), days('2026-10-12', '2026-10-16'), false],
    ['hours that cross', hours('2026-10-09', 540, 660), hours('2026-10-09', 630, 720), true],
    ['hours that touch', hours('2026-10-09', 540, 600), hours('2026-10-09', 600, 660), false],
    ['the same hours on another day', hours('2026-10-09', 540, 660), hours('2026-10-10', 540, 660), false],
    ['hours on a day inside whole days', hours('2026-10-14', 540, 660), days('2026-10-12', '2026-10-16'), true],
    ['hours on the day after whole days', hours('2026-10-17', 540, 660), days('2026-10-12', '2026-10-16'), false],
  ])('two times off overlap or not: %s', (_name, a, b, yes) => {
    expect(timeOffOverlap(a, b)).toBe(yes);
    expect(timeOffOverlap(b, a)).toBe(yes);
  });

  it('what is sent is what the form shows: whole days carry no times, part of a day carries one day, and the mark only when confirming', () => {
    expect(timeOffRequest({ kind: 'days', fromDate: '2026-10-12', toDate: '2026-10-16', from: '09:00', to: '12:00' }, KEY)).toEqual({
      requestKey: KEY, fromDate: '2026-10-12', toDate: '2026-10-16', fromMinute: null, toMinute: null,
    });
    expect(timeOffRequest({ kind: 'hours', fromDate: '2026-10-09', toDate: '2026-10-16', from: '09:00', to: '12:00' }, KEY, 'a'.repeat(64))).toEqual({
      requestKey: KEY, fromDate: '2026-10-09', toDate: '2026-10-09', fromMinute: 540, toMinute: 720, confirm: 'a'.repeat(64),
    });
  });

  const row = (id, name, localDate, localStartMinute, minutes) => ({ id, name, localDate, localStartMinute, minutes });
  const S1 = '33333333-3333-4333-8333-000000000001';
  const C1 = '44444444-4444-4444-8444-000000000001';
  const over = (sessions, classes) => ({
    mark: 'b'.repeat(64),
    sessions: { count: sessions.length, shown: sessions },
    classes: { count: classes.length, shown: classes },
    classesUpTo: '2026-12-01',
  });
  const maya = row(S1, 'Maya Lopez', '2026-10-09', 600, 60);
  const spin = row(C1, 'Spin', '2026-10-09', 630, 45);

  it('reads the server’s answer only when it is that answer, whole', () => {
    const answer = (data) => ({ response: { data } });
    expect(timeOffAsked(answer({ error: 'time_off_over_bookings', over: over([maya], []) }))).toEqual(over([maya], []));
    expect(timeOffAsked(answer({ error: 'time_off_ended', message: 'That time has already passed.' }))).toBeNull();
    expect(timeOffAsked(answer({ error: 'time_off_over_bookings', over: { ...over([maya], []), mark: 'no' } }))).toBeNull();
    expect(timeOffAsked(answer({ error: 'time_off_over_bookings', over: over([], []) }))).toBeNull();
    expect(timeOffAsked(new Error('offline'))).toBeNull();
  });

  it('the box says who has what in the time, and names each one with its day and time', () => {
    expect(timeOffBoxTitle(over([maya], []), samReed)).toBe('Sam Reed has 1 session booked in this time');
    expect(timeOffBoxTitle(over([maya, { ...maya, id: 'x' }], [spin]), samReed)).toBe('Sam Reed has 2 sessions booked and coaches 1 class in this time');
    expect(timeOffBoxTitle(over([], [spin, { ...spin, id: 'y' }]), samReed)).toBe('Sam Reed coaches 2 classes in this time');
    expect(timeOffBoxTitle(over([maya], []), { name: 'Sam Reed', mine: true })).toBe('Sam Reed (you) has 1 session booked in this time');
    expect(timeOffBoxRow(maya, '12h', TODAY, 'session')).toEqual({ name: 'Maya Lopez', detail: 'Fri 9 Oct · 10:00 AM – 11:00 AM' });
    expect(timeOffBoxRow({ ...maya, name: null }, '24h', TODAY, 'session')).toEqual({ name: 'Somebody no longer on your list', detail: 'Fri 9 Oct · 10:00 – 11:00' });
    expect(timeOffBoxRow(spin, '24h', TODAY, 'class')).toEqual({ name: 'Spin', detail: 'Fri 9 Oct · 10:30 – 11:15' });
  });

  it('the box says what adding it does and that nobody is cancelled, for what is in it and nothing else', () => {
    const friday = { kind: 'days', fromDate: '2026-10-09', toDate: '2026-10-09', from: '', to: '' };
    expect(timeOffBoxLines(over([maya], []), samReed, friday)).toEqual([
      'If you add this time off, no new session can be booked with Sam Reed in it.',
      'This session stays booked: nobody is cancelled and nothing comes off or goes back on a pack. To move one, cancel it on this page and book another time.',
    ]);
    // A trainer who cannot book is told who can.
    expect(timeOffBoxLines(over([maya], []), samReed, friday, false)[1]).toBe(
      'This session stays booked: nobody is cancelled and nothing comes off or goes back on a pack. To move one, cancel it on this page and ask a manager to book another time.',
    );
    expect(timeOffBoxLines(over([], [spin, { ...spin, id: 'y' }]), samReed, friday)).toEqual([
      'If you add this time off, no new session can be booked with Sam Reed in it.',
      'These classes stay on the calendar with Sam Reed as coach. To change the coach, open the class on the Calendar.',
    ]);
    // A trainer adding their own time off cannot open the Calendar, and is not sent there.
    expect(timeOffBoxLines(over([], [spin]), samReed, friday, true, false)[1]).toBe(
      'This class stays on the calendar with Sam Reed as coach. Whoever runs the timetable can change the coach.',
    );
    // A time off that runs past the calendar's last day says its later classes are not listed.
    const long = { kind: 'days', fromDate: '2026-11-20', toDate: '2026-12-20', from: '', to: '' };
    expect(timeOffBoxLines(over([maya, { ...maya, id: 'x' }], [spin]), samReed, long).at(-1)).toBe(
      "Classes after Tue 1 Dec aren't on the calendar yet, so they aren't listed here. Sam Reed's week will mark them when they are.",
    );
    expect(timeOffBoxLines(over([maya], [spin]), samReed, { ...long, toDate: '2026-12-01' })).toHaveLength(3);
    // Part of one day reads its own day, not a last day left over from Whole days.
    expect(timeOffBoxLines(over([maya], []), samReed, { kind: 'hours', fromDate: '2026-10-09', toDate: '2026-12-20', from: '09:00', to: '12:00' })).toHaveLength(2);
  });
});

// EVERY STEP TO A FIRST SESSION (ROADMAP 23d). The ticks are the server's facts and the
// list on screen, never a guess; a button goes only to somebody who can open its place.
describe('the steps to a first session, with a tick on each one done', () => {
  const OWNER = ['org.manage', 'staff.manage', 'memberships.manage', 'schedule.manage', 'members.read', 'members.confirm'];
  const MANAGER = ['memberships.manage', 'schedule.manage', 'members.read', 'members.confirm'];
  const SCHEDULER = ['schedule.manage', 'members.read'];
  const NONE = { typeIncludesPt: false, somebodyHoldsIt: false, listHasPeople: false, sessionBooked: false };
  const list = (over = {}) => ({ canManage: true, gymHasTypes: true, setup: NONE, trainers: [notSetUp()], ...over });
  const steps = (l, privileges = OWNER, orgType = 'gym') => setupSteps(l, { orgSlug: 'iron-house', privileges, orgType });
  const ticks = (view) => Object.fromEntries(view.rows.map((r) => [r.key, r.done]));

  it('a gym that sells memberships has four steps, and a gym that sells none has three', () => {
    expect(steps(list()).rows.map((r) => r.key)).toEqual(['trainer', 'type', 'held', 'book']);
    expect(steps(list({ gymHasTypes: false })).rows.map((r) => r.key)).toEqual(['trainer', 'people', 'book']);
    // With no types the membership facts are not asked about, whatever they say.
    const stale = list({ gymHasTypes: false, setup: { ...NONE, typeIncludesPt: true, somebodyHoldsIt: true } });
    expect(ticks(steps(stale))).toEqual({ trainer: false, people: false, book: false });
  });

  it.each([
    ['nothing done', {}, [notSetUp()], { trainer: false, type: false, held: false, book: false }, 'trainer', '0 of 4 done'],
    ['a trainer has hours', {}, [trainer()], { trainer: true, type: false, held: false, book: false }, 'type', '1 of 4 done'],
    ['one of two trainers has hours', {}, [notSetUp(), trainer({ userId: 'u-ana' })], { trainer: true, type: false, held: false, book: false }, 'type', '1 of 4 done'],
    ['a type includes it', { typeIncludesPt: true }, [trainer()], { trainer: true, type: true, held: false, book: false }, 'held', '2 of 4 done'],
    ['somebody holds it', { typeIncludesPt: true, somebodyHoldsIt: true }, [trainer()], { trainer: true, type: true, held: true, book: false }, 'book', '3 of 4 done'],
    // A trainer who is not taking sessions, or has no hours left, cannot be booked: not ticked.
    ['a trainer set up who is not taking sessions', {}, [trainer({ offers: false })], { trainer: false, type: false, held: false, book: false }, 'trainer', '0 of 4 done'],
    ['a trainer whose hours were all removed', {}, [trainer({ hours: [] })], { trainer: false, type: false, held: false, book: false }, 'trainer', '0 of 4 done'],
    // Each tick follows its own fact: a later step done does not tick an earlier one.
    ['a session, and no trainer now', { sessionBooked: true }, [notSetUp()], { trainer: false, type: false, held: false, book: true }, 'trainer', '1 of 4 done'],
    ['held, its type archived since', { somebodyHoldsIt: true }, [trainer()], { trainer: true, type: false, held: true, book: false }, 'type', '2 of 4 done'],
    // Sessions from before the gym sold memberships: booked, and nobody holds one yet.
    ['a session, a type, and nobody holding it', { typeIncludesPt: true, sessionBooked: true }, [trainer()], { trainer: true, type: true, held: false, book: true }, 'held', '3 of 4 done'],
    // People on the list tick nothing for a gym that sells memberships.
    ['people on the list', { listHasPeople: true }, [notSetUp()], { trainer: false, type: false, held: false, book: false }, 'trainer', '0 of 4 done'],
  ])('a gym that sells memberships, %s', (_what, setup, trainers, expected, next, count) => {
    const view = steps(list({ setup: { ...NONE, ...setup }, trainers }));
    expect(view.show).toBe(true);
    expect(ticks(view)).toEqual(expected);
    // The step to do next is the first one not done, and the only one marked.
    expect(view.rows.filter((r) => r.next).map((r) => r.key)).toEqual([next]);
    expect(setupCount(view)).toBe(count);
  });

  it.each([
    ['nothing done', {}, [notSetUp()], { trainer: false, people: false, book: false }, '0 of 3 done'],
    ['people on the list', { listHasPeople: true }, [notSetUp()], { trainer: false, people: true, book: false }, '1 of 3 done'],
    ['a trainer and people', { listHasPeople: true }, [trainer()], { trainer: true, people: true, book: false }, '2 of 3 done'],
  ])('a gym that sells none, %s', (_what, setup, trainers, expected, count) => {
    const view = steps(list({ gymHasTypes: false, setup: { ...NONE, ...setup }, trainers }));
    expect(ticks(view)).toEqual(expected);
    expect(setupCount(view)).toBe(count);
  });

  it('the list goes once every step is done, and comes back when one is not', () => {
    const all = { typeIncludesPt: true, somebodyHoldsIt: true, listHasPeople: true, sessionBooked: true };
    expect(steps(list({ setup: all, trainers: [trainer()] }))).toEqual({ show: false, rows: [], doneCount: 0, total: 0 });
    expect(steps(list({ gymHasTypes: false, setup: { ...NONE, listHasPeople: true, sessionBooked: true }, trainers: [trainer()] })).show).toBe(false);
    // The only trainer leaves, or the type is archived: the list is back, with that step open.
    expect(steps(list({ setup: all, trainers: [notSetUp()] })).rows.filter((r) => !r.done).map((r) => r.key)).toEqual(['trainer']);
    expect(steps(list({ setup: { ...all, typeIncludesPt: false }, trainers: [trainer()] })).rows.filter((r) => !r.done).map((r) => r.key)).toEqual(['type']);
  });

  it('is for whoever runs the timetable, and only where the server sent the steps', () => {
    const none = { show: false, rows: [], doneCount: 0, total: 0 };
    expect(steps(list({ canManage: false, setup: null }))).toEqual(none);
    // A reader who does not run the timetable is shown none, whatever arrived.
    expect(steps(list({ canManage: false }))).toEqual(none);
    for (const setup of [null, undefined, 'yes', 3]) expect(steps(list({ setup }))).toEqual(none);
    expect(steps(null)).toEqual(none);
    expect(steps(undefined)).toEqual(none);
    // A fact that is not a plain yes is a no: nothing is ticked on a guess.
    const odd = list({ setup: { typeIncludesPt: 'yes', somebodyHoldsIt: 1, listHasPeople: null }, trainers: [trainer()] });
    expect(ticks(steps(odd))).toEqual({ trainer: true, type: false, held: false, book: false });
  });

  it("each button opens the place its step is done in, and only for somebody who can open it", () => {
    const buttons = (view) => Object.fromEntries(view.rows.map((r) => [r.key, r.action === null ? null : [r.action.label, r.action.to]]));
    const members = ['Open Members', '/console/iron-house/members'];
    expect(buttons(steps(list(), OWNER))).toEqual({
      trainer: ['Invite staff', '/console/iron-house/members?view=staff&open=invite'],
      type: ['Open Memberships', '/console/iron-house/memberships'],
      held: members,
      book: null,
    });
    // A manager cannot invite staff; somebody with the timetable alone cannot open Memberships.
    expect(buttons(steps(list(), MANAGER))).toEqual({ trainer: null, type: ['Open Memberships', '/console/iron-house/memberships'], held: members, book: null });
    expect(buttons(steps(list(), SCHEDULER))).toEqual({ trainer: null, type: null, held: members, book: null });
    expect(buttons(steps(list({ gymHasTypes: false }), SCHEDULER))).toEqual({ trainer: null, people: members, book: null });
    // Inviting changes the gym: the page greys it for a gym with no live plan.
    expect(steps(list(), OWNER).rows[0].action.changes).toBe(true);
    expect(steps(list(), OWNER).rows[1].action.changes).toBeUndefined();
    // With no gym in the address there is nowhere to go.
    expect(setupSteps(list(), { orgSlug: undefined, privileges: OWNER, orgType: 'gym' }).rows.every((r) => r.action === null)).toBe(true);
  });

  it('a step with no button says who can do it, and never names a place its reader cannot open', () => {
    const lines = (privileges) => Object.fromEntries(steps(list(), privileges).rows.map((r) => [r.key, r.line]));
    expect(lines(OWNER)).toEqual({
      trainer: 'Pick somebody on your staff under Add a trainer, and set the hours they are available. Invite anybody who is not on your staff yet.',
      type: 'On Memberships, tick "Includes personal training" on a membership or pack you sell. A session is booked on it.',
      held: 'Open the person on Members and press Add membership. They can then be booked.',
      book: "Press one of a trainer's available times below, and pick the person.",
    });
    expect(lines(SCHEDULER)).toMatchObject({
      trainer: 'Pick somebody on your staff under Add a trainer, and set the hours they are available. The owner can invite somebody who is not on your staff yet.',
      type: 'Ask the owner to tick "Includes personal training" on a membership or pack you sell. A session is booked on it.',
    });
    expect(lines(SCHEDULER).type).not.toContain('On Memberships');
  });

  it("a studio's and a trainer's own words", () => {
    const studio = steps(list(), OWNER, 'studio').rows;
    expect(studio.find((r) => r.key === 'held')).toMatchObject({
      title: 'Give it to a client',
      line: 'Open the person on Clients and press Add membership. They can then be booked.',
      action: { label: 'Open Clients', to: '/console/iron-house/members' },
    });
    const noTypes = steps(list({ gymHasTypes: false }), OWNER, 'studio').rows;
    expect(noTypes.find((r) => r.key === 'people')).toMatchObject({
      title: 'Put your clients on your list',
      line: 'Anybody on your client list can be booked. Import your list, or add people one at a time.',
    });
  });
});

describe('came or no-show (17e-iv-b)', () => {
  const started = (over = {}) => ({ name: 'Maya Lopez', status: 'booked', packCharged: false, usesLimit: false, cancel: null, canMark: true, ...over });

  it('a session that has not started, or was read before the server said, has nothing to mark', () => {
    expect(markRow(started({ canMark: false, cancel: 'free' }))).toBeNull();
    expect(markRow({ name: 'Maya Lopez', status: 'booked', cancel: null })).toBeNull();
    expect(markRow(null)).toBeNull();
  });

  it('not marked yet: two buttons, each saying who', () => {
    expect(markRow(started())).toEqual({
      tag: null,
      note: 'Not marked yet',
      actions: [
        { status: 'attended', label: 'Came', aria: 'Mark that Maya Lopez came' },
        { status: 'no_show', label: 'No-show', aria: 'Mark Maya Lopez as a no-show' },
      ],
    });
    expect(markRow(started({ name: null })).actions[0].aria).toBe('Mark that this person came');
  });

  it('marked: what it is, and one button to change it', () => {
    expect(markRow(started({ status: 'attended', packCharged: true }))).toEqual({
      tag: { label: 'Came', tone: 'good' },
      note: '',
      actions: [{ status: 'no_show', label: 'Change to no-show', aria: 'Change Maya Lopez to no-show' }],
    });
    expect(markRow(started({ status: 'no_show' }))).toEqual({
      tag: { label: 'No-show', tone: 'warn' },
      note: '',
      actions: [{ status: 'attended', label: 'Change to came', aria: 'Change Maya Lopez to came' }],
    });
  });

  it('a no-show says what it costs the person: a pack first, then a limit, else nothing', () => {
    expect(markRow(started({ status: 'no_show', packCharged: true, usesLimit: true })).note).toBe('The session stays used on their pack.');
    expect(markRow(started({ status: 'no_show', usesLimit: true })).note).toBe('It still counts as one of the sessions their membership includes.');
    expect(markRow(started({ status: 'no_show' })).note).toBe('');
  });

  it('the week turns back as far as the server reads, and says why days gone by are shown', () => {
    const week = { today: '2026-10-07', firstDay: '2026-09-09', from: '2026-10-07', to: '2026-10-13', lastDay: '2026-12-01' };
    expect(canGoEarlier(week)).toBe(true);
    expect(canGoEarlier({ ...week, from: '2026-09-09', to: '2026-09-15' })).toBe(false);
    expect(pastDaysNote(week)).toBeNull();
    expect(pastDaysNote({ ...week, from: '2026-09-30', to: '2026-10-06' })).toBe('Days that have passed are shown so you can mark who came.');
  });
});

describe('a trainer’s hours on as few lines as say them', () => {
  const at = (weekday, fromMinute, toMinute) => ({ weekday, fromMinute, toMinute });
  it.each([
    ['every day the same', [1, 2, 3, 4, 5, 6, 7].map((d) => at(d, 540, 1020)), ['Every day · 09:00 – 17:00']],
    ['weekdays, and a short Saturday', [...[1, 2, 3, 4, 5].map((d) => at(d, 540, 1020)), at(6, 540, 780)], ['Mon – Fri · 09:00 – 17:00', 'Sat · 09:00 – 13:00']],
    ['one day', [at(5, 540, 720)], ['Fri · 09:00 – 12:00']],
    ['a day off in the middle splits the run', [at(1, 540, 720), at(2, 540, 720), at(4, 540, 720)], ['Mon – Tue · 09:00 – 12:00', 'Thu · 09:00 – 12:00']],
    ['two sets of hours on a day', [at(1, 900, 1020), at(1, 540, 720)], ['Mon · 09:00 – 12:00, 15:00 – 17:00']],
    ['the same days with different hours are not joined', [at(1, 540, 720), at(2, 600, 720)], ['Mon · 09:00 – 12:00', 'Tue · 10:00 – 12:00']],
    ['no hours', [], []],
  ])('%s', (_name, hours, lines) => {
    expect(hoursBrief({ hours }, '24h')).toEqual(lines);
  });

  it('reads on the gym’s clock', () => {
    expect(hoursBrief({ hours: [{ weekday: 5, fromMinute: 540, toMinute: 780 }] }, '12h')).toEqual(['Fri · 9:00 AM – 1:00 PM']);
  });
});

describe('the strip of days, and the day it opens on', () => {
  const day = (localDate, appointments = [], timeOff = []) => ({ localDate, appointments, timeOff, free: [], classes: [] });
  const booked = { status: 'booked', canMark: false };
  const toMark = { status: 'booked', canMark: true };
  const came = { status: 'attended', canMark: true };
  const missed = { status: 'no_show', canMark: true };
  const allDay = { id: 'o1', fromMinute: null, toMinute: null };
  const week = {
    today: '2026-10-07',
    days: [
      day('2026-10-07', [toMark, came]),
      day('2026-10-08', [booked, booked]),
      day('2026-10-09', [], [allDay]),
      day('2026-10-10', [booked], [allDay]),
      day('2026-10-11', [], [{ id: 'o2', fromMinute: 540, toMinute: 600 }]),
    ],
  };

  it('each day says the one thing that matters most: to mark, then booked, then a whole day off', () => {
    expect(dayTabs(week).map((t) => [t.weekday, t.date, t.today, t.note, t.tone])).toEqual([
      ['Wed', '7', true, '1 to mark', 'warn'],
      ['Thu', '8', false, '2 booked', 'on'],
      ['Fri', '9', false, 'Time off', 'plain'],
      ['Sat', '10', false, '1 booked', 'on'],
      ['Sun', '11', false, '', 'plain'],
    ]);
    expect(dayTabs(week).map((t) => t.label)).toEqual(['Today · Wed 7 Oct, 1 to mark', 'Thu 8 Oct, 2 booked', 'Fri 9 Oct, Time off', 'Sat 10 Oct, 1 booked', 'Sun 11 Oct']);
    expect(dayTabs(null)).toEqual([]);
  });

  it('"booked" counts only sessions still to come: ones already marked are said as marked (the review, L4)', () => {
    const notes = (appointments) => dayTabs({ today: '2026-10-20', days: [day('2026-10-07', appointments)] }).map((t) => [t.note, t.tone]);
    expect(notes([came, missed])).toEqual([['2 marked', 'on']]);
    expect(notes([came])).toEqual([['1 marked', 'on']]);
    expect(notes([came, booked])).toEqual([['1 booked', 'on']]);
    expect(notes([came, missed, toMark])).toEqual([['1 to mark', 'warn']]);
    expect(notes([toMark, booked, booked])).toEqual([['1 to mark', 'warn']]);
  });

  it('opens the day asked for while it is in the week, else today, else the first with a session, else the first', () => {
    expect(pickDay(week, '2026-10-09')).toBe('2026-10-09');
    expect(pickDay(week, '2026-11-01')).toBe('2026-10-07');
    expect(pickDay(week, null)).toBe('2026-10-07');
    const past = { today: '2026-10-20', days: [day('2026-10-07'), day('2026-10-08', [came]), day('2026-10-09', [booked])] };
    expect(pickDay(past, null)).toBe('2026-10-08');
    expect(pickDay({ today: '2026-10-20', days: [day('2026-10-07'), day('2026-10-08')] }, null)).toBe('2026-10-07');
    expect(pickDay({ today: '2026-10-20', days: [] }, null)).toBeNull();
  });
});
