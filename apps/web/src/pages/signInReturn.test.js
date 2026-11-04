// A console page opened signed out is opened again after sign-in (19b-ii): the phone's Choose a new
// owner opens a gym's Staff tab in a browser that is usually signed out. Only this site's console
// pages, for 30 minutes, until a signed-in page is reached.
import { describe, expect, it } from 'vitest';
import { RETURN_FOR_MS, forgetReturn, isReturnPath, rememberReturn, readReturn } from './landingRoute';

const fakeStore = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
};
const STAFF = '/console/iron-house/members?view=staff&handOver=1';

describe('which pages are kept (the worst thing: sign-in sends somebody to another site)', () => {
  it.each([
    [STAFF, true],
    ['/console/iron-house', true],
    ['/console/iron-house/settings', true],
    // Never another site, however it is spelled.
    ['//evil.example/console/x', false],
    ['https://evil.example/console/iron-house', false],
    ['/console//evil.example', false],
    ['/console/\\evil.example', false],
    ['\\\\evil.example', false],
    ['/console/iron-house/../../\\evil.example', false],
    // Not a console page: sign-in lands as it always has.
    ['/console', false],
    ['/console/', false],
    ['/dashboard', false],
    ['/login', false],
    ['', false],
    [null, false],
    [42, false],
  ])('%s → %s', (path, kept) => {
    expect(isReturnPath(path)).toBe(kept);
  });
});

describe('kept for 30 minutes, in this tab, until a signed-in page is reached', () => {
  it('every step of signing in reads the same page, and arriving forgets it', () => {
    const store = fakeStore();
    expect(rememberReturn(STAFF, store, 1_000)).toBe(true);
    expect(readReturn(store, 2_000)).toBe(STAFF);
    expect(readReturn(store, 3_000)).toBe(STAFF);
    forgetReturn(store);
    expect(readReturn(store, 4_000)).toBeNull();
  });

  it('too old, or from a clock that went back, it is forgotten', () => {
    const store = fakeStore();
    rememberReturn(STAFF, store, 1_000);
    expect(readReturn(store, 1_000 + RETURN_FOR_MS + 1)).toBeNull();
    rememberReturn(STAFF, store, 5_000);
    expect(readReturn(store, 4_000)).toBeNull();
    rememberReturn(STAFF, store, 1_000);
    expect(readReturn(store, 1_000 + RETURN_FOR_MS)).toBe(STAFF);
  });

  it('a page that is not kept forgets the one before it, and sign-out forgets it', () => {
    const store = fakeStore();
    rememberReturn(STAFF, store, 1_000);
    rememberReturn('/dashboard', store, 2_000);
    expect(readReturn(store, 3_000)).toBeNull();
    rememberReturn(STAFF, store, 1_000);
    forgetReturn(store);
    expect(store.size()).toBe(0);
  });

  it('a value written by anything else is no page', () => {
    for (const raw of ['not json', JSON.stringify({ path: '//evil.example', at: 1_000 }), JSON.stringify({ path: STAFF }), 'null']) {
      const store = fakeStore();
      store.setItem('aihg.signInReturn', raw);
      expect(readReturn(store, 2_000)).toBeNull();
    }
  });

  it('with no storage at all, nothing is kept and nothing breaks', () => {
    expect(rememberReturn(STAFF, null)).toBe(false);
    expect(readReturn(null)).toBeNull();
  });
});
