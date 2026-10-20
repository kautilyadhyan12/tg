// The member's menu line for their places (Kd's "My Gyms", 2026-09-02), in each kind's own
// name (ROADMAP 5f-iv), every word capitalised as his is.
import { describe, expect, it } from 'vitest';
import { navWithMyGyms } from './sidebarNav';

const ITEMS = [{ to: '/dashboard', label: 'Home' }, { to: '/settings', label: 'Settings' }];
const of = (orgType, id = 'x') => ({ id, name: 'Any', orgType, isMember: true });
const label = (gyms) => navWithMyGyms(ITEMS, gyms).find((item) => item.to === '/my-gyms')?.label;

describe('the My Gyms menu line', () => {
  it("names each kind's places by its own name", () => {
    expect(label([of('gym')])).toBe('My Gyms');
    expect(label([of('studio')])).toBe('My Studios');
    expect(label([of('yoga_studio')])).toBe('My Yoga Studios');
    expect(label([of('pilates_studio')])).toBe('My Pilates Studios');
    expect(label([of('crossfit_box')])).toBe('My CrossFit Gyms');
    expect(label([of('yoga_studio'), of('pilates_studio', 'y')])).toBe('My Organisations');
  });

  it('sits before Settings, and is absent with no places', () => {
    expect(navWithMyGyms(ITEMS, [of('gym')]).map((item) => item.to)).toEqual(['/dashboard', '/my-gyms', '/settings']);
    expect(navWithMyGyms(ITEMS, [])).toBe(ITEMS);
  });
});
