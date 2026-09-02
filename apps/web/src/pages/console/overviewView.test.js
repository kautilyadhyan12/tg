// The gym's numbers, proved without a browser. The render test next door proves
// the screen draws these answers; this file proves the answers.
//
// **THE TWO THINGS THIS FILE EXISTS FOR** are the two ways a number on a console
// screen goes wrong, and both are recorded defects rather than hypotheticals:
// a figure the CLIENT worked out (:27992 §3 — right on six rows, wrong on four
// hundred), and an empty state that says something FALSE about a gym's history
// (:8267, :8343, :26736).
import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHT,
  adoptionLine,
  barTitle,
  chartGeometry,
  chartState,
  crowdNote,
  hasAnyActivity,
  hiddenPeopleCount,
  initials,
  nothingRecordedSentence,
  numbersState,
  OVERVIEW_PEOPLE_PREVIEW,
  previewPeople,
  tileCounts,
  todayLine,
  weekAxisLabel,
  weekComparison,
  weekLine,
} from './overviewView';

/** A payload shaped like the wire's, with everything quiet. Each test moves the
 *  ONE field it is about, so a case cannot pass because a sibling happened to be
 *  non-zero. */
const quiet = (over = {}) => ({
  timezone: 'Asia/Kolkata',
  today: '2026-09-02',
  tiles: {
    today: { visits: 0, visitors: 0 },
    week: { visits: 0, visitors: 0, prevVisits: 0, prevVisitors: 0 },
    month: { visitors: 0, members: 0, adoptionPct: null },
    ...over.tiles,
  },
  weeks: over.weeks ?? [],
});

const week = (weekStart, visits, visitors) => ({ weekStart, visits, visitors });

describe('the week a bar belongs to', () => {
  it('writes a gym Monday the way a person does, from the string and not a Date', () => {
    expect(weekAxisLabel('2026-08-18')).toBe('18 Aug');
    expect(weekAxisLabel('2026-01-05')).toBe('5 Jan');
    expect(weekAxisLabel('2026-12-28')).toBe('28 Dec');
  });

  // THE POINT OF THE ONE ABOVE, stated as its own case so a future refactor
  // through `toLocaleDateString` goes red rather than shifting every label by a
  // day west of the gym. A UTC-midnight Date rendered in the reader's zone is
  // :8156's trap and trap #8, and this is the assertion that catches it: the
  // FIRST of a month is what moves backwards into the previous month.
  it('does not move a date by resolving it in whoever is reading', () => {
    expect(weekAxisLabel('2026-03-01')).toBe('1 Mar');
    expect(weekAxisLabel('2026-01-01')).toBe('1 Jan');
  });

  it('hands back anything it cannot read rather than guessing or blanking', () => {
    expect(weekAxisLabel('not-a-date')).toBe('not-a-date');
    expect(weekAxisLabel('2026-13-01')).toBe('2026-13-01');
    expect(weekAxisLabel(null)).toBe('');
    expect(weekAxisLabel(undefined)).toBe('');
  });
});

describe('has anybody come at all', () => {
  it('is false for a gym where every window is empty', () => {
    expect(hasAnyActivity(quiet())).toBe(false);
  });

  // FOUR WINDOWS, FOUR CASES, one at a time. A single fixture with everything
  // set proves only that the function returns true for a busy gym.
  it('is true from today alone', () => {
    expect(hasAnyActivity(quiet({ tiles: { today: { visits: 1, visitors: 1 } } }))).toBe(true);
  });

  it('is true from this week alone', () => {
    const o = quiet({ tiles: { week: { visits: 3, visitors: 2, prevVisits: 0, prevVisitors: 0 } } });
    expect(hasAnyActivity(o)).toBe(true);
  });

  it('is true from last week alone, which is the window a quiet Monday hides', () => {
    const o = quiet({ tiles: { week: { visits: 0, visitors: 0, prevVisits: 9, prevVisitors: 6 } } });
    expect(hasAnyActivity(o)).toBe(true);
  });

  it('is true from the 30-day count alone', () => {
    const o = quiet({ tiles: { month: { visitors: 4, members: 10, adoptionPct: 40 } } });
    expect(hasAnyActivity(o)).toBe(true);
  });

  it('is true from a bar in the chart alone', () => {
    expect(hasAnyActivity(quiet({ weeks: [week('2026-07-06', 5, 3), week('2026-07-13', 0, 0)] }))).toBe(true);
  });
});

describe('which of the four things the numbers zone is', () => {
  it('says nothing at all when there is no payload', () => {
    expect(numbersState(null)).toBe('none');
    expect(numbersState(undefined)).toBe('none');
  });

  // Part 3 §4.1's own edge: "org with 0 members ever → Overview IS the checklist
  // + poster CTA (no sad empty charts)".
  it('draws nothing for a gym nobody has joined and nobody has come to', () => {
    expect(numbersState(quiet())).toBe('no-members');
  });

  it('has something to say once the gym has members, even with nobody through the door', () => {
    expect(numbersState(quiet({ tiles: { month: { visitors: 0, members: 12, adoptionPct: 0 } } }))).toBe('nobody');
  });

  // THE ORDER IS THE WHOLE FUNCTION. `month.members` counts CURRENT,
  // non-complimentary members, so a gym whose only seat is the owner's
  // complimentary one reads 0 — and "2 people came today" is still TRUE.
  // Hiding a true number to honour an empty-state rule is the same defect the
  // rule exists to prevent, pointed the other way.
  it('draws the numbers for a gym with no members but somebody through the door', () => {
    const o = quiet({ tiles: { today: { visits: 2, visitors: 2 } } });
    expect(o.tiles.month.members).toBe(0);
    expect(numbersState(o)).toBe('ready');
  });

  it('draws the numbers for an ordinary busy gym', () => {
    const o = quiet({
      tiles: { week: { visits: 40, visitors: 22, prevVisits: 38, prevVisitors: 20 } },
    });
    expect(numbersState(o)).toBe('ready');
  });
});

describe('the sentence for a gym where nothing has been recorded', () => {
  // THE WINDOW IS NAMED AND "yet" IS NOT USED. The payload covers eight weeks
  // and cannot answer "has anybody EVER come" — :8343 is this project's recorded
  // cost of a sentence about a history the server was never asked about.
  //
  // ASSERTED AS THE LITERAL AN OWNER READS, not rebuilt from `OVERVIEW_WEEKS`
  // (:19960): a test that composes the string the same way the code does agrees
  // with it whatever the constant says.
  it('names the window it can actually see, and never says "yet"', () => {
    const text = nothingRecordedSentence(true);
    expect(text).toBe('Nobody has marked attendance in the last 8 weeks.');
    expect(text).not.toMatch(/yet/i);
  });

  it('points at the switch when the switch is what is stopping them', () => {
    expect(nothingRecordedSentence(false)).toBe(
      'Nobody can mark attendance — the switch is off in Settings.',
    );
  });

  // The contract defaults the field to `true`, so an older payload that omits it
  // must read as "on" and not fall into the switch sentence — which would tell
  // an owner their button is off while it is on.
  it('treats an absent switch as on', () => {
    expect(nothingRecordedSentence(undefined)).toMatch(/^Nobody has marked attendance/);
  });
});

describe('the headline figures', () => {
  it('says the second number only when somebody came twice', () => {
    expect(todayLine({ visits: 34, visitors: 34 })).toBe('34 people');
    expect(todayLine({ visits: 37, visitors: 34 })).toBe('34 people · 37 visits');
    expect(weekLine({ visits: 12, visitors: 12 })).toBe('12 people');
    expect(weekLine({ visits: 15, visitors: 12 })).toBe('12 people · 15 visits');
  });

  it('gets the singular right, on the screen an owner opens every morning', () => {
    expect(todayLine({ visits: 1, visitors: 1 })).toBe('1 person');
    expect(todayLine({ visits: 2, visitors: 1 })).toBe('1 person · 2 visits');
  });

  it('reads a quiet day as none rather than as nothing', () => {
    expect(todayLine({ visits: 0, visitors: 0 })).toBe('0 people');
  });
});

describe('this week against last week', () => {
  // THE UNEVEN COMPARISON. `visits` is this gym-week SO FAR and `prevVisits` is
  // the WHOLE of the week before, so on a Tuesday a bare arrow compares two days
  // against seven and tells a healthy gym it is collapsing (:5807).
  it('never hands back a direction without a sentence naming both ends', () => {
    for (const [now, prev] of [[40, 38], [10, 38], [38, 38], [0, 0], [5, 0]]) {
      const c = weekComparison({ visits: now, visitors: 0, prevVisits: prev, prevVisitors: 0 });
      expect(typeof c.text).toBe('string');
      expect(c.text.length).toBeGreaterThan(0);
      if (c.direction !== null) {
        expect(c.text).toMatch(/whole of last week/);
        expect(c.text).toMatch(/so far/);
      }
    }
  });

  it('points the arrow at the visits and quotes last week in full', () => {
    expect(weekComparison({ visits: 40, prevVisits: 38 })).toEqual({
      direction: 'up',
      text: 'so far, against 38 visits in the whole of last week',
    });
    expect(weekComparison({ visits: 10, prevVisits: 38 }).direction).toBe('down');
    expect(weekComparison({ visits: 38, prevVisits: 38 }).direction).toBe('same');
  });

  // "Up from nothing" is not a trend, and an arrow over a gym's first week is
  // the same false confidence pointed the other way.
  it('draws no arrow at all when there is nothing to compare against', () => {
    expect(weekComparison({ visits: 12, prevVisits: 0 })).toEqual({
      direction: null,
      text: 'Nothing was recorded last week.',
    });
  });

  it('gets the singular right in the comparison too', () => {
    expect(weekComparison({ visits: 4, prevVisits: 1 }).text).toBe(
      'so far, against 1 visit in the whole of last week',
    );
  });
});

describe('the last 30 days', () => {
  // THE FIXTURE IS ONE NO HONEST GYM PRODUCES, AND THE FIRST VERSION OF THIS
  // TEST WAS NOT — it served `adoptionPct: 43` beside 12 of 28, which IS
  // 12/28 rounded, so the served value and a client-side division are the same
  // number and the assertion passed either way. **C155 was ALIVE on the first
  // sweep and that is how it was found**: :20712's class — a fixture in which
  // the defect and the fix are indistinguishable — and the third time in this
  // repo that a test written WITH a guarantee passed under its removal (:29117
  // §2, :29250 §5). The 77 is what makes it an observer (:29250 §3's shape).
  it('reads the percentage the server computed and never divides', () => {
    expect(adoptionLine({ visitors: 12, members: 28, adoptionPct: 77 })).toEqual({
      pct: 77,
      text: '12 of 28 members came in the last 30 days',
    });
  });

  // NULL AND NOT ZERO. A gym nobody has joined has no adoption to state, and 0%
  // would tell an owner on their first day that their members are ignoring them
  // (:8267's class). The server decides this; the screen must not re-derive it.
  it('draws nothing when the server states no share', () => {
    expect(adoptionLine({ visitors: 0, members: 0, adoptionPct: null })).toBeNull();
    expect(adoptionLine({})).toBeNull();
    expect(adoptionLine(null)).toBeNull();
  });

  it('gets the singular right', () => {
    expect(adoptionLine({ visitors: 1, members: 1, adoptionPct: 100 }).text).toBe(
      '1 of 1 member came in the last 30 days',
    );
  });
});

describe('a tile is a number and a caption', () => {
  // KD, 2026-09-03: *"the problem is design … its not looking good"*. The first
  // version put `1 person · 2 visits` where the FIGURE goes, so the thing an
  // owner reads at a glance was a line of prose with two numbers in it.
  it('leads with the people count, which is the number he asked for', () => {
    expect(tileCounts({ visits: 3, visitors: 2 })).toEqual({
      value: 2,
      unit: 'people',
      detail: '3 visits',
    });
  });

  // `dayTotalsLine`'s rule, preserved through the redesign: on the ordinary day
  // where nobody came twice, printing the same number twice is noise that
  // trains an owner to stop reading the tile.
  it('says nothing about visits when they are the same number', () => {
    expect(tileCounts({ visits: 2, visitors: 2 }).detail).toBeNull();
  });

  it('gets the singular right, on the screen an owner opens every morning', () => {
    expect(tileCounts({ visits: 1, visitors: 1 })).toEqual({
      value: 1,
      unit: 'person',
      detail: null,
    });
    expect(tileCounts({ visits: 2, visitors: 1 }).detail).toBe('2 visits');
  });

  it('reads a quiet day as a real zero', () => {
    expect(tileCounts({ visits: 0, visitors: 0 })).toEqual({
      value: 0,
      unit: 'people',
      detail: null,
    });
  });
});

describe('the few names under the numbers', () => {
  const people = Array.from({ length: 9 }, (_, i) => ({ userId: `u${i}`, displayName: `M${i}`, visits: [] }));

  it('previews five and keeps the server order', () => {
    const shown = previewPeople(people);
    expect(shown).toHaveLength(OVERVIEW_PEOPLE_PREVIEW);
    expect(shown.map((p) => p.userId)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
  });

  it('survives a missing or malformed list rather than throwing', () => {
    expect(previewPeople(null)).toEqual([]);
    expect(previewPeople([null, undefined, { userId: 'u', displayName: 'A', visits: [] }])).toHaveLength(1);
  });

  // THE COUNT IS NOT TAKEN FROM THE PREVIEW. A gym of four hundred still reads
  // the right number above a list of five — :27992 §3's exact breakage.
  it('works out how many are not on screen from the server total', () => {
    expect(hiddenPeopleCount({ people: 40 }, previewPeople(people))).toBe(35);
  });

  it('hides nobody when everybody fits', () => {
    expect(hiddenPeopleCount({ people: 3 }, [1, 2, 3])).toBe(0);
    // A total SMALLER than the page is not a negative remainder — it is a
    // server and a screen disagreeing, and the honest answer is "none hidden".
    expect(hiddenPeopleCount({ people: 2 }, [1, 2, 3])).toBe(0);
    expect(hiddenPeopleCount(null, [1])).toBe(0);
  });
});

describe('the letters in the circle beside a name', () => {
  it('takes the first and last name', () => {
    expect(initials('Kd Owner')).toBe('KO');
    expect(initials('Rita Sen')).toBe('RS');
    expect(initials('Anil Kumar Das')).toBe('AD');
  });

  it('takes two letters from a single name', () => {
    expect(initials('owner')).toBe('OW');
  });

  // Non-Latin scripts keep their own first character rather than being
  // transliterated or blanked — a member whose name this cannot abbreviate must
  // still get a circle with something in it.
  it('keeps a non-Latin name rather than blanking it', () => {
    expect(initials('অনিল দাস')).toBe('অদ');
  });

  it('never renders an empty circle', () => {
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials(undefined)).toBe('?');
  });
});

describe('the two numbers that can disagree without either being wrong', () => {
  // THE SCREEN KD ACTUALLY SAW, 2026-09-03: "Today · 1 person" beside
  // "Last 30 days · 0% — 0 of 2 members came". Both true — the visitor held a
  // complimentary owner's seat, which `month`'s two figures exclude — and the
  // pair reads as a screen disagreeing with itself.
  const owner = { tiles: { today: { visits: 1, visitors: 1 }, month: { visitors: 0, members: 2, adoptionPct: 0 } } };

  it('explains the gap when somebody came and the share did not move', () => {
    expect(crowdNote(quiet(owner).tiles)).toMatch(/Free seats/);
  });

  it('says nothing when a counted member is the one who came', () => {
    const tiles = quiet({ tiles: { ...owner.tiles, month: { visitors: 1, members: 2, adoptionPct: 50 } } }).tiles;
    expect(crowdNote(tiles)).toBeNull();
  });

  it('says nothing when nobody has come recently at all', () => {
    const tiles = quiet({ tiles: { month: { visitors: 0, members: 2, adoptionPct: 0 } } }).tiles;
    expect(crowdNote(tiles)).toBeNull();
  });

  // No members means no share is drawn at all, so there is no pair to explain
  // and the sentence would be about nothing.
  it('says nothing when there is no share on screen to disagree with', () => {
    const tiles = quiet({ tiles: { today: { visits: 1, visitors: 1 } } }).tiles;
    expect(tiles.month.members).toBe(0);
    expect(crowdNote(tiles)).toBeNull();
  });

  it('is reached from the week as well as from today', () => {
    const tiles = quiet({
      tiles: {
        week: { visits: 3, visitors: 2, prevVisits: 0, prevVisitors: 0 },
        month: { visitors: 0, members: 2, adoptionPct: 0 },
      },
    }).tiles;
    expect(crowdNote(tiles)).toMatch(/Free seats/);
  });
});

describe('whether there is a trend to plot yet', () => {
  const eightQuiet = [
    week('2026-07-13', 0, 0), week('2026-07-20', 0, 0), week('2026-07-27', 0, 0),
    week('2026-08-03', 0, 0), week('2026-08-10', 0, 0), week('2026-08-17', 0, 0),
    week('2026-08-24', 0, 0), week('2026-08-31', 0, 0),
  ];

  it('is still collecting when nothing has ever landed in the chart', () => {
    expect(chartState(eightQuiet)).toBe('collecting');
    expect(chartState([])).toBe('collecting');
  });

  // The current week is the LAST bucket by the server's construction. A gym in
  // its first week has this bar and nothing to compare it against — Part 3
  // §4.1's "< 1 wk data" state.
  it('is still collecting when only this week has anything in it', () => {
    const weeks = [...eightQuiet.slice(0, 7), week('2026-08-31', 14, 9)];
    expect(chartState(weeks)).toBe('collecting');
  });

  it('is ready as soon as one past week has anything in it', () => {
    const weeks = [...eightQuiet];
    weeks[6] = week('2026-08-24', 3, 2);
    expect(chartState(weeks)).toBe('ready');
  });
});

describe('the chart, in pixels', () => {
  const series = [
    week('2026-07-13', 10, 6), week('2026-07-20', 20, 11), week('2026-07-27', 0, 0),
    week('2026-08-03', 40, 18), week('2026-08-10', 30, 15), week('2026-08-17', 25, 14),
    week('2026-08-24', 35, 17), week('2026-08-31', 8, 7),
  ];

  it('draws no frame at all for an empty series', () => {
    expect(chartGeometry([])).toBeNull();
    expect(chartGeometry(null)).toBeNull();
  });

  it('gives one bar per week, oldest first, labelled with its Monday', () => {
    const g = chartGeometry(series);
    expect(g.bars).toHaveLength(8);
    expect(g.bars[0].label).toBe('13 Jul');
    expect(g.bars[7].label).toBe('31 Aug');
    expect(g.linePoints.split(' ')).toHaveLength(8);
  });

  it('marks the newest bucket as this week, and only that one', () => {
    const g = chartGeometry(series);
    expect(g.bars.map((b) => b.isCurrent)).toEqual([false, false, false, false, false, false, false, true]);
  });

  it('scales the tallest bar to the full height and a quiet week to nothing', () => {
    const g = chartGeometry(series);
    expect(g.max).toBe(40);
    expect(g.bars[3].height).toBe(CHART_HEIGHT);
    expect(g.bars[3].y).toBe(0);
    expect(g.bars[2].height).toBe(0);
  });

  // ONE SCALE FOR BOTH SERIES, and this is the assertion that holds it there.
  // `visitors` is a DISTINCT count over the rows `visits` counts, so it can
  // never exceed them; on two scales the line could ride ABOVE the bars and show
  // an owner more people than visits — a picture that cannot happen. On a shared
  // scale the point sits on or under the bar top, i.e. `cy >= y`.
  it('keeps the people line on or under the visits bars', () => {
    const g = chartGeometry(series);
    for (const bar of g.bars) {
      expect(bar.cy).toBeGreaterThanOrEqual(bar.y);
      expect(bar.cy).toBeLessThanOrEqual(CHART_HEIGHT);
    }
  });

  it('survives an all-quiet series without dividing by zero', () => {
    const g = chartGeometry([week('2026-08-24', 0, 0), week('2026-08-31', 0, 0)]);
    expect(g.max).toBe(1);
    expect(g.bars.every((b) => b.height === 0)).toBe(true);
    expect(g.bars.every((b) => Number.isFinite(b.cy))).toBe(true);
  });

  it('says the whole bar in one sentence, and says which one is unfinished', () => {
    const g = chartGeometry(series);
    expect(barTitle(g.bars[0])).toBe('Week of 13 Jul: 10 visits, 6 people');
    expect(barTitle(g.bars[7])).toBe('This week so far: 8 visits, 7 people');
  });
});
