// The console's kept answer to "who am I here, and what may I do?".
//
// These are the store's own rules, tested where they are decided. The half a
// person actually SEES — a power taken away landing on a screen that is already
// open, without a reload — is in `console.render.test.jsx` and
// `settings.render.test.jsx`, because a rule proven only here is a rule proven
// one layer above the screen it protects (:15007's shape).
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const { setCurrentUserId } = await import('../../utils/storage');
const {
  consoleOrgsRegainedFocus,
  consoleOrgsSnapshot,
  ensureConsoleOrgs,
  refreshConsoleOrgs,
  resetConsoleOrgs,
  subscribeConsoleOrgs,
} = await import('./consoleOrgs');

const ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', staffRole: 'owner' };
const answer = (orgs) => ({ data: { orgs } });
const offline = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

/** Let the store's promise chain settle. `ensure`/`refresh` are deliberately
 *  fire-and-forget — no screen awaits them — so the tests wait the same way the
 *  app does rather than on a handle the app does not have. */
const settled = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  setCurrentUserId('u1');
  orgService.getMine.mockResolvedValue(answer([ORG]));
});

describe('asking once', () => {
  it('serves every screen from ONE read', async () => {
    // Three screens mounting is `ensure` three times: the shell around the
    // screen, the screen, and the next screen the owner taps.
    ensureConsoleOrgs();
    ensureConsoleOrgs();
    await settled();
    ensureConsoleOrgs();
    await settled();

    expect(orgService.getMine).toHaveBeenCalledTimes(1);
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'ready', orgs: [ORG] });
  });

  it('lets the window coming back JOIN a read already on its way instead of starting a second one', async () => {
    // T3 round 2, L-2 — and this guard had NO test, which is the whole reason it
    // is here. The sharing is what stops a caller that asks in a loop putting one
    // request per pass on the wire, and this card has already shipped exactly
    // such a loop once (:16388). Its only instrument was mutant C49, **whose
    // signal is a HANG rather than a RED** — a sweep that aborts, which is how it
    // reads as "the harness is broken" rather than "the app is". :5348 rule 5
    // wants a class that has recurred to have a permanent guard; this is it.
    let land;
    orgService.getMine.mockReturnValueOnce(
      new Promise((resolve) => {
        land = () => resolve(answer([ORG]));
      }),
    );
    ensureConsoleOrgs();

    // The screen is still waiting when the person clicks back into the window.
    consoleOrgsRegainedFocus();
    land();
    await settled();

    expect(orgService.getMine).toHaveBeenCalledTimes(1);
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'ready', orgs: [ORG] });
  });

  it('asks again when the last answer FAILED, so a fresh screen is not handed a dead error card', async () => {
    orgService.getMine.mockRejectedValueOnce(offline());
    ensureConsoleOrgs();
    await settled();
    expect(consoleOrgsSnapshot().status).toBe('failed');

    ensureConsoleOrgs();
    await settled();
    expect(orgService.getMine).toHaveBeenCalledTimes(2);
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'ready' });
  });

  it('never answers a person who asked ON PURPOSE with a read that was already in the air', async () => {
    // T3 C/H-1's other half, and the reason `NewGym` calling `refresh` is not
    // the whole fix. A background re-check begun a moment BEFORE a gym was
    // created cannot know about that gym — so waiting on it would tell the owner
    // their brand-new gym does not exist, exactly as before, just less often.
    ensureConsoleOrgs();
    await settled();

    let landStale;
    orgService.getMine.mockReturnValueOnce(
      new Promise((resolve) => {
        landStale = () => resolve(answer([ORG]));
      }),
    );
    consoleOrgsRegainedFocus();

    // ...and now the gym is created, which asks the store to go again.
    const newGym = { ...ORG, id: 'g2', slug: 'new-gym', name: 'New Gym' };
    orgService.getMine.mockResolvedValue(answer([ORG, newGym]));
    refreshConsoleOrgs();
    landStale();
    await settled();

    expect(orgService.getMine).toHaveBeenCalledTimes(3);
    expect(consoleOrgsSnapshot().orgs).toEqual([ORG, newGym]);
  });

  it('shows the spinner when a person presses Try again', async () => {
    orgService.getMine.mockRejectedValueOnce(offline());
    ensureConsoleOrgs();
    await settled();

    refreshConsoleOrgs();
    expect(consoleOrgsSnapshot().status).toBe('loading');
    await settled();
    expect(consoleOrgsSnapshot().status).toBe('ready');
  });
});

describe('re-checking in the background', () => {
  it('replaces the answer WHOLE and never shows a spinner', async () => {
    const seen = [];
    const stop = subscribeConsoleOrgs(() => seen.push(consoleOrgsSnapshot().status));
    ensureConsoleOrgs();
    await settled();
    seen.length = 0;

    // The gym has dropped off the caller's list — they were taken off staff
    // while the tab sat open. The screen must be able to say so.
    orgService.getMine.mockResolvedValue(answer([]));
    await backgroundRecheck();

    expect(seen).not.toContain('loading');
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'ready', orgs: [] });
    stop();
  });

  it('leaves a working screen ALONE when it fails', async () => {
    const seen = [];
    const stop = subscribeConsoleOrgs(() => seen.push(consoleOrgsSnapshot().status));
    ensureConsoleOrgs();
    await settled();
    seen.length = 0;

    orgService.getMine.mockRejectedValue(offline());
    await backgroundRecheck();

    // Not `failed`, and not blank: what the person is looking at stays.
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'ready', orgs: [ORG] });
    expect(seen).not.toContain('failed');
    stop();
  });
});

describe('a shared front-desk browser', () => {
  it('never hands the next account the last one’s gyms', async () => {
    ensureConsoleOrgs();
    await settled();
    expect(consoleOrgsSnapshot().status).toBe('ready');

    // Sign out, then somebody else signs in — `AuthContext` pushes the id in.
    setCurrentUserId(null);
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'idle', orgs: null });
    setCurrentUserId('u2');
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'idle', orgs: null });

    orgService.getMine.mockResolvedValue(answer([{ ...ORG, id: 'g2', name: 'Their Gym' }]));
    ensureConsoleOrgs();
    await settled();
    expect(consoleOrgsSnapshot().orgs).toEqual([{ ...ORG, id: 'g2', name: 'Their Gym' }]);
  });

  it('cannot let an answer already in flight land for the person who signed in next', async () => {
    let answerU1;
    orgService.getMine.mockReturnValueOnce(
      new Promise((resolve) => {
        answerU1 = () => resolve(answer([ORG]));
      }),
    );
    ensureConsoleOrgs();
    setCurrentUserId('u2');
    answerU1();
    await settled();

    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'idle', orgs: null });
  });

  it('asks for the next person’s OWN gyms rather than waiting on a read that can never be theirs', async () => {
    // T3 C/H-2. The one above proves the previous account's answer never lands;
    // this proves the next account gets an answer AT ALL. A read for `u1` that
    // is still in the air when `u2` signs in used to be handed to `u2` as if it
    // were theirs — and when it came back stamped `u1` their console was left
    // with nothing, on a spinner, with no way out but reloading the page: the
    // mount effect had already run, and the focus re-check returns early on an
    // empty store.
    let answerU1;
    orgService.getMine.mockReturnValueOnce(
      new Promise((resolve) => {
        answerU1 = () => resolve(answer([ORG]));
      }),
    );
    ensureConsoleOrgs();

    const theirGym = { ...ORG, id: 'g2', slug: 'their-gym', name: 'Their Gym' };
    setCurrentUserId('u2');
    orgService.getMine.mockResolvedValue(answer([theirGym]));
    ensureConsoleOrgs();
    // The hung read finally lands, after the second person is already looking at
    // the screen — the order that makes this a defect rather than a race.
    answerU1();
    await settled();

    expect(orgService.getMine).toHaveBeenCalledTimes(2);
    expect(consoleOrgsSnapshot()).toMatchObject({ status: 'ready', orgs: [theirGym] });
  });
});

/** THE function the window's two events call, not a copy of what it does — the
 *  wiring itself (that a real focus event reaches it) is proven in jsdom by the
 *  render suites. */
async function backgroundRecheck() {
  consoleOrgsRegainedFocus();
  await settled();
}
