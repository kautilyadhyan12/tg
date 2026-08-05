// Exercise library — what a person actually SEES. The reader's own tests
// (api/exerciseLibrary.test.js) prove the join and the filters; these prove the
// screen draws them, and that its three states are distinguishable.
//
// The state coverage is deliberate. The calendar card's round 2 found "three
// states with NO render assertion at all" (:4355), each surviving with every
// test green, so loading / failed / empty are each pinned here.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EXERCISE_CONTENT } from '@app/shared';
import ExerciseLibrary from './ExerciseLibrary';
import { CATEGORIES, difficultyStyle } from './exerciseLibraryView';
import { categoryNames } from '../api/exerciseLibrary';

vi.mock('../api/exerciseApi', () => ({
  exerciseService: { getExercisePage: vi.fn() },
}));
vi.mock('react-hot-toast', () => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  return { default: t };
});

const { exerciseService } = await import('../api/exerciseApi');
const toast = (await import('react-hot-toast')).default;

const catalogRow = (slug) => ({
  slug, nameKey: `exercise.${slug}`, family: 'F1', tier: 'T1',
  tracking: 'pose', met: 6, difficulty: null, equipment: null, muscles: null,
});

/** The whole 58-row catalog as the API would serve it — one page, as it is. */
const wholeCatalog = () => ({
  data: { items: EXERCISE_CONTENT.map((c) => catalogRow(c.slug)), nextCursor: null },
});

const draw = () => render(<MemoryRouter><ExerciseLibrary /></MemoryRouter>);

// The grid draws its first 20 rows sorted by name, so an assertion about a
// specific exercise has to pick one that is ON that page or search for it
// first. Measured, not guessed: "Chair Squats" is 11th, "Bicep Curls" 3rd,
// "Brisk Walking" 6th; "Squats" is 47th and "Mountain Pose" 32nd.
const searchFor = (term) =>
  fireEvent.change(screen.getByPlaceholderText(/Search exercises/), { target: { value: term } });

/** The card element wrapping a given name — the `group` div `ExerciseCard`
 *  renders. Used instead of walking `parentElement` twice, which silently
 *  followed the wrong node when the markup nested one level deeper. */
const cardFor = (name) => screen.getByText(name).closest('div.group');

/** Is the AI badge on this card? Asserted on the ELEMENT, not on a regex over
 *  `textContent` — adjacent text nodes concatenate ("AI" + "Rehabilitation" =
 *  "AIRehabilitation"), so a string match is both blind to word boundaries and
 *  liable to fire on an unrelated word that happens to contain the letters. */
const hasAiBadge = (name) =>
  [...cardFor(name).querySelectorAll('span, div')].some((el) => el.textContent.trim() === 'AI');

/** The detail panel that opens on a card click. Anchored on "Add to Workout",
 *  which exists ONLY in that panel (the grid card has no such button), so this
 *  cannot accidentally match the page behind it. */
const detailPanel = () => screen.getByText('Add to Workout').closest('div.fixed');

/** The panel's difficulty pill, or null when it draws none. `span.capitalize`
 *  is the pill and nothing else in the panel carries that class — the equipment
 *  chips beside it are deliberately not capitalized. */
const panelDifficultyPill = () => detailPanel().querySelector('span.capitalize');

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('the library on the new API', () => {
  it('shows the real names, not slugs', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    // "Chair Squats" — never "chair_squat" or the derived "Chair Squat".
    expect(await screen.findByText('Chair Squats')).toBeTruthy();
    expect(screen.queryByText('chair_squat')).toBeNull();
    expect(screen.queryByText('Chair Squat')).toBeNull();
    // And one from further down the alphabet, reached by searching.
    searchFor('squats');
    expect(await screen.findByText('Squats')).toBeTruthy();
  });

  it('asks the new API once, with no filter parameters', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    await screen.findByText('Chair Squats');
    expect(exerciseService.getExercisePage).toHaveBeenCalledTimes(1);
    expect(Object.keys(exerciseService.getExercisePage.mock.calls[0][0])).toEqual(['limit']);
  });

  it('prints the exact catalog size in the headline, and only once known', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    // While loading it must NOT claim a number — "0 Exercises" is a lie the old
    // shape could tell.
    expect(screen.queryByText(/^0 Exercises$/)).toBeNull();
    expect(await screen.findByText('58 Exercises')).toBeTruthy();
  });

  it('lists Mountain Pose and Brisk Walking — the REMOVED_EXERCISES hack is gone', async () => {
    // Part 4 §3.4:366-369: "the REMOVED_EXERCISES frontend hack dies with the
    // migration". 58 on screen, not 56.
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    // Brisk Walking is on the first page; Mountain Pose is 32nd, so search it.
    expect(await screen.findByText('Brisk Walking')).toBeTruthy();
    searchFor('mountain pose');
    expect(await screen.findByText('Mountain Pose')).toBeTruthy();
  });
});

describe('the three states are distinguishable', () => {
  it('LOADING: skeletons, and no "no exercises found"', () => {
    exerciseService.getExercisePage.mockReturnValue(new Promise(() => {}));
    const { container } = draw();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('No exercises found')).toBeNull();
  });

  it('FAILED: says the read failed — never "No exercises found"', async () => {
    exerciseService.getExercisePage.mockRejectedValue(new Error('network down'));
    draw();
    expect(await screen.findByText(/Couldn't load the exercises/)).toBeTruthy();
    // The distinction this state exists for: a dead server must not be reported
    // as an empty library, nor blame the user's filters.
    expect(screen.queryByText('No exercises found')).toBeNull();
    expect(screen.queryByText('Clear filters')).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });

  it('EMPTY: a search matching nothing offers to clear the filters', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    await screen.findByText('Chair Squats');
    searchFor('zzzznotanexercise');
    expect(await screen.findByText('No exercises found')).toBeTruthy();
    expect(screen.getByText('Clear filters')).toBeTruthy();
    expect(screen.queryByText(/Couldn't load the exercises/)).toBeNull();
  });

  it('TRUNCATED: a catalog that never ends is said out loud', async () => {
    exerciseService.getExercisePage.mockResolvedValue({
      data: { items: [catalogRow('squat')], nextCursor: 'squat' },
    });
    draw();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      'Showing part of the library', expect.anything(),
    ));
  });
});

describe('search and filters, with no further requests', () => {
  it('filters in memory — the endpoint is asked exactly once', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    await screen.findByText('Chair Squats');
    searchFor('plank');
    await waitFor(() => expect(screen.queryByText('Chair Squats')).toBeNull());
    expect(screen.getByText('Plank')).toBeTruthy();
    expect(exerciseService.getExercisePage).toHaveBeenCalledTimes(1);
  });

  it('pages with "Load more" without asking the server again', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    const { container } = draw();
    await screen.findByText('58 Exercises');
    const first = container.querySelectorAll('h3').length;
    expect(first).toBe(20);                      // the page's own LIMIT
    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(container.querySelectorAll('h3').length).toBe(40));
    expect(exerciseService.getExercisePage).toHaveBeenCalledTimes(1);
  });
});

describe('the AI badge tells the truth', () => {
  // THE PAIR IS THE TEST, and deliberately so — either assertion alone is
  // satisfiable by a constant (the M20/M21 precedent, DECISIONS :4119). Both
  // rows are on the first page and both are `ai_supported: true` in the Mongo
  // seed; only Chair Squats has an engine definition. So a build that copied
  // the seed flag badges both and fails the second, and a build that dropped
  // the badge entirely fails the first.
  it('badges Chair Squats, which the engine CAN grade', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    await screen.findByText('Chair Squats');
    expect(hasAiBadge('Chair Squats')).toBe(true);
  });

  it('does NOT badge Bicep Curls, which the old data claimed and the engine cannot', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    await screen.findByText('Bicep Curls');
    expect(hasAiBadge('Bicep Curls')).toBe(false);
  });
});

describe('difficultyStyle — the one-of-N fix', () => {
  it('gives each known difficulty its own colour', () => {
    expect(difficultyStyle('beginner').color).toBe('#4ade80');
    expect(difficultyStyle('intermediate').color).toBe('#fbbf24');
    expect(difficultyStyle('advanced').color).toBe('#f87171');
  });

  it('does NOT paint an unknown difficulty as beginner', () => {
    // The defect this closes: `DIFF_COLORS[d] || DIFF_COLORS.beginner` asserted
    // "beginner" about a value nobody had graded.
    const unknown = difficultyStyle('elite');
    expect(unknown).not.toBeNull();
    expect(unknown.color).not.toBe(difficultyStyle('beginner').color);
  });

  it('says nothing at all when there is no difficulty', () => {
    expect(difficultyStyle(null)).toBeNull();
    expect(difficultyStyle('')).toBeNull();
    expect(difficultyStyle(undefined)).toBeNull();
  });

  it('draws no pill for a row with no difficulty', async () => {
    exerciseService.getExercisePage.mockResolvedValue({
      data: { items: [catalogRow('brand_new_move')], nextCursor: null },
    });
    const { container } = draw();
    await screen.findByText('Brand New Move');
    expect(container.textContent).not.toMatch(/beginner/i);
  });

  // T3 round 2, F2 — THE ASSERTIONS ROUND 1'S FIX SHIPPED WITHOUT. Round 1
  // (F3) found the DETAIL PANEL still painting an ungraded exercise green as
  // "beginner" from its own private DIFF_COLORS copy, and fixed it. Nothing
  // rendered that panel: the defect was put straight back and all 494 tests
  // stayed green (measured). The OWED line was then re-ticked citing M20/M21,
  // which pin the GRID's pill in a different file. The pair below is what makes
  // that tick true — the negative alone is satisfied by "never draw a pill".
  it('DETAIL PANEL: draws no difficulty pill for a row with no difficulty', async () => {
    exerciseService.getExercisePage.mockResolvedValue({
      data: { items: [catalogRow('brand_new_move')], nextCursor: null },
    });
    draw();
    fireEvent.click(await screen.findByText('Brand New Move'));
    await screen.findByText('Add to Workout');
    expect(panelDifficultyPill()).toBeNull();
    expect(detailPanel().textContent).not.toMatch(/beginner/i);
  });

  it('DETAIL PANEL: draws the real difficulty when there is one', async () => {
    exerciseService.getExercisePage.mockResolvedValue(wholeCatalog());
    draw();
    // Chair Squats is `beginner` in the content table — a REAL value, so the
    // pill must appear and say so. Without this control the assertion above is
    // satisfied by a panel that never draws a pill at all.
    fireEvent.click(await screen.findByText('Chair Squats'));
    await screen.findByText('Add to Workout');
    expect(panelDifficultyPill()).not.toBeNull();
    expect(panelDifficultyPill().textContent.trim()).toBe('beginner');
  });
});

describe('the category pills and the data agree', () => {
  // Neither direction is visible to a reader of either file.
  it('every pill matches a real category', () => {
    const inData = categoryNames();
    for (const cat of CATEGORIES.filter((c) => c.name !== 'All')) {
      expect(inData).toContain(cat.name);
    }
  });

  it('every category in the data has a pill', () => {
    const pills = CATEGORIES.map((c) => c.name);
    for (const name of categoryNames()) expect(pills).toContain(name);
  });
});
