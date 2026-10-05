// PERSONAL TRAINING, the words and the hours form (ROADMAP 17e-i). The worst thing this
// screen could do is say a cancel is free when it keeps a session used, or send hours the
// trainer did not type: both are read here from what the server sent.
import { describe, expect, it } from 'vitest';
import { savePtTrainerRequestSchema } from '@app/shared';
import {
  addRange,
  bookCost,
  bookSentence,
  bookableUntil,
  canAddRange,
  canGoEarlier,
  canGoLater,
  cancelBox,
  coachedClassRow,
  dayHeading,
  durationWords,
  freeTimeLabel,
  hoursDraft,
  hoursFormProblem,
  hoursLines,
  hoursRequest,
  howItWorks,
  noTimesNote,
  peopleHeading,
  personRow,
  pickTrainer,
  removeRange,
  sessionClash,
  sessionLength,
  sessionRow,
  sessionsAWeek,
  setRange,
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
    expect(hoursLines(trainer(), '24h')).toEqual(['Monday · 09:00 – 11:00, 16:00 – 20:00', 'Friday · 07:00 – 10:00']);
    expect(hoursLines(trainer(), '12h')).toEqual(['Monday · 9:00 AM – 11:00 AM, 4:00 PM – 8:00 PM', 'Friday · 7:00 AM – 10:00 AM']);
    expect(hoursLines(trainer({ hours: [] }), '24h')).toEqual([]);
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

  it('the steps a new gym reads leave out the membership one where the gym sells none', () => {
    expect(howItWorks(true)).toHaveLength(3);
    expect(howItWorks(true)[1]).toContain('Includes personal training');
    expect(howItWorks(false)).toEqual(['Add a trainer and set the hours they are free.', "Press one of the trainer's free times and pick the member."]);
  });

  it('a free time reads as the whole session, start to end', () => {
    expect(freeTimeLabel(540, 60, '24h')).toBe('09:00 – 10:00');
    expect(freeTimeLabel(540, 20, '12h')).toBe('9:00 AM – 9:20 AM');
  });

  it('a session reads its time, its person and what it was booked on', () => {
    expect(sessionRow(session(), '24h')).toEqual({ time: '10:00 – 11:00', name: 'Maya Lopez', detail: 'PT 10 · 1 session used' });
    expect(sessionRow(session({ packCharged: false, membership: 'PT Unlimited' }), '24h').detail).toBe('PT Unlimited');
    expect(sessionRow(session({ packCharged: false, membership: null }), '24h').detail).toBe('');
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
  it('the list says what it is showing', () => {
    expect(peopleHeading({ gymHasTypes: true, people: [maya] }, '')).toBe('Your members, people with personal training first');
    expect(peopleHeading({ gymHasTypes: false, people: [maya] }, '  ')).toBe('Your members');
    expect(peopleHeading({ gymHasTypes: true, people: [] }, '')).toBe('Your member list is empty. Add people on Members first.');
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
