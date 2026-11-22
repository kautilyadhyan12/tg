// Sign waiver pressed in the strip under a member's name (V2a): the Waiver box opens as its own
// button opens it, once a press, and a box drawn afresh never acts on the press it was drawn with.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getDeskWaiver: vi.fn(() => new Promise(() => undefined)), signAtDesk: vi.fn() } };
});
const DeskWaiver = (await import('./DeskWaiver')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const entry = { entryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fullName: 'Ada Lovelace', waiverDesk: null, members: [] };
const draw = (ask, more = {}) => <DeskWaiver gymId={GYM} entry={entry} readOnly={false} when={() => ''} onSigned={() => undefined} ask={ask} {...more} />;
const box = () => screen.queryByRole('group', { name: 'Sign the waiver' });

afterEach(cleanup);

describe("the strip's Sign waiver", () => {
  it('opens the box, once a press', () => {
    const { rerender } = render(draw(0));
    expect(box()).toBeNull();
    rerender(draw(1));
    expect(box()).not.toBeNull();
  });

  it('drawn afresh with a press already made, the box stays shut until a new press', () => {
    const { rerender } = render(draw(2));
    expect(box()).toBeNull();
    rerender(draw(3));
    expect(box()).not.toBeNull();
  });

  it('read-only, or signed at the desk already: nothing opens', () => {
    const { rerender } = render(draw(0, { readOnly: true }));
    rerender(draw(1, { readOnly: true }));
    expect(box()).toBeNull();
    cleanup();
    const signed = { ...entry, waiverDesk: { at: '2026-10-05T10:00:00.000Z', name: 'Ada', signer: 'person' } };
    const again = render(<DeskWaiver gymId={GYM} entry={signed} readOnly={false} when={() => ''} onSigned={() => undefined} ask={0} />);
    again.rerender(<DeskWaiver gymId={GYM} entry={signed} readOnly={false} when={() => ''} onSigned={() => undefined} ask={1} />);
    expect(box()).toBeNull();
  });
});
