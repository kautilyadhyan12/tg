// The Square customer list on a person's page, with Unlink (ROADMAP 18d-iii-b-ii-c-ii).
//
// THE WORST THING THIS BOX COULD DO: unlink without saying first what changes, or stop a card the box never named. So the first
// test: Unlink opens a box naming the customer, the payments that go back and the card that is stopped; nothing is sent until the
// box's own Unlink is pressed, and the press carries this page's person, that customer and the card the box named.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const live = vi.hoisted(() => ({ listeners: new Set() }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getSquareLinks: vi.fn(), getUnlinkBox: vi.fn(), unlinkSquareCustomer: vi.fn() } };
});
vi.mock('./liveNews', async (importOriginal) => {
  const actual = await importOriginal();
  const { useEffect, useRef } = await import('react');
  return {
    ...actual,
    useLiveNews: (gymId, onMessage, active = true) => {
      const latest = useRef(onMessage);
      latest.current = onMessage;
      useEffect(() => {
        if (!active || !gymId) return undefined;
        const listener = { fn: (message) => latest.current(message) };
        live.listeners.add(listener);
        return () => live.listeners.delete(listener);
      }, [gymId, active]);
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberSquareLinks = (await import('./MemberSquareLinks')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const SAM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IRON = { name: 'Iron House', slug: 'iron-house', timezone: 'America/Chicago', privileges: ['members.confirm', 'billing.members'] };
const LINK = { customerId: 'CPAT', also: false, linkedAt: '2026-10-29T18:30:00.000Z', from: { amountMinor: 2000, currency: 'USD', takenAt: '2026-10-29T18:29:00.000Z' } };
const BOX = { customerName: 'Pat Smith', also: false, waiting: 1, matched: 1, card: { brand: 'VISA', last4: '1111' }, added: false };
const ok = (data) => Promise.resolve({ data });
const refused = (status, error, message) => Promise.reject(Object.assign(new Error(message), { response: { status, data: { error, message } } }));

function show(props = {}) {
  return render(
    <MemoryRouter>
      <MemberSquareLinks gymId={GYM} gym={IRON} entryId={SAM} name="Sam Smith" readOnly={false} {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  live.listeners.clear();
});

describe('Square customer list: the worst thing', () => {
  it('Unlink says what changes before anything does, and the press carries this person, that customer and the card the box named', async () => {
    orgService.getSquareLinks.mockReturnValue(ok({ links: [LINK] }));
    orgService.getUnlinkBox.mockReturnValue(ok(BOX));
    orgService.unlinkSquareCustomer.mockReturnValue(ok({ unlinked: { customerName: 'Pat Smith', moved: 1, card: BOX.card, added: false }, links: [] }));
    const onUnlinked = vi.fn();
    show({ onUnlinked });
    expect(await screen.findByText(/Linked to a customer in your Square customer list when \$20\.00 paid on 29 Oct was matched\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByText('Unlink this Square customer from Sam Smith?')).toBeTruthy();
    expect(screen.getByText('In Square, this customer is Pat Smith.')).toBeTruthy();
    expect(screen.getByText(/Sam Smith’s card on file, Visa ending 1111, is saved on this customer/)).toBeTruthy();
    expect(screen.getByText('1 payment from this customer waiting on this page goes back to Payments to match.')).toBeTruthy();
    expect(orgService.getUnlinkBox).toHaveBeenCalledWith(GYM, SAM, 'CPAT');
    // Opening the box sends nothing.
    expect(orgService.unlinkSquareCustomer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Unlinked. Pat Smith’s payments in Square Point of Sale no longer come to Sam Smith’s page. 1 payment went back to Payments to match. Their Visa ending 1111 was removed. Save their card again.',
    );
    const [gymId, entryId, customerId, body] = orgService.unlinkSquareCustomer.mock.calls[0];
    expect([gymId, entryId, customerId, body.card]).toEqual([GYM, SAM, 'CPAT', BOX.card]);
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(onUnlinked).toHaveBeenCalledTimes(1);
    // The payments that went back are one press away.
    expect(screen.getByRole('link', { name: 'Open Payments to match' }).getAttribute('href')).toBe('/console/iron-house/payments-to-match');
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });
});

describe('Square customer list', () => {
  it('a card saved since the box was read: the box is read again, saying why, and nothing is unlinked unseen', async () => {
    orgService.getSquareLinks.mockReturnValue(ok({ links: [LINK] }));
    orgService.getUnlinkBox.mockReturnValueOnce(ok({ ...BOX, card: null })).mockReturnValueOnce(ok(BOX));
    orgService.unlinkSquareCustomer.mockImplementation(() => refused(409, 'square_unlink_changed', 'This has changed since you opened it. Check the box again, then unlink.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    expect(await screen.findByText('Unlink this Square customer from Sam Smith?')).toBeTruthy();
    expect(screen.queryByText(/card on file/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This has changed since you opened it. Check the box again, then unlink.');
    expect(await screen.findByText(/Sam Smith’s card on file, Visa ending 1111/)).toBeTruthy();
    expect(orgService.getUnlinkBox).toHaveBeenCalledTimes(2);
  });

  it('Cancel closes the box and sends nothing; a refusal is said in the box', async () => {
    orgService.getSquareLinks.mockReturnValue(ok({ links: [LINK] }));
    orgService.getUnlinkBox.mockReturnValue(ok(BOX));
    orgService.unlinkSquareCustomer.mockImplementation(() => refused(409, 'square_unlink_busy', 'A payment is being taken on their card right now. Try again in a minute.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Unlink this Square customer from Sam Smith?')).toBeNull();
    expect(orgService.unlinkSquareCustomer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await screen.findByText('Unlink this Square customer from Sam Smith?');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'A payment is being taken on their card right now. Try again in a minute.');
    expect(screen.getByText('Unlink this Square customer from Sam Smith?')).toBeTruthy();
  });

  it('nothing for a person Match linked nobody to, for staff who do not match payments, or in a read-only console', async () => {
    orgService.getSquareLinks.mockReturnValue(ok({ links: [] }));
    const { container } = show();
    await waitFor(() => expect(orgService.getSquareLinks).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();
    show({ gym: { ...IRON, privileges: ['members.confirm'] } });
    expect(screen.queryByText(/Square customer list/)).toBeNull();
    expect(orgService.getSquareLinks).toHaveBeenCalledTimes(1);
    cleanup();
    orgService.getSquareLinks.mockReturnValue(ok({ links: [LINK] }));
    show({ readOnly: true });
    expect(await screen.findByText(/Linked to a customer in your Square customer list/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });

  it("a link Match makes on another screen shows here by itself, from live news about this person's payments", async () => {
    orgService.getSquareLinks.mockReturnValueOnce(ok({ links: [] })).mockReturnValueOnce(ok({ links: [LINK] }));
    show();
    await waitFor(() => expect(orgService.getSquareLinks).toHaveBeenCalledTimes(1));
    act(() => {
      for (const l of live.listeners) l.fn({ what: 'memberships', entryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    });
    expect(orgService.getSquareLinks).toHaveBeenCalledTimes(1);
    act(() => {
      for (const l of live.listeners) l.fn({ what: 'memberships', entryId: SAM });
    });
    expect(await screen.findByRole('button', { name: 'Unlink' })).toBeTruthy();
  });
});
