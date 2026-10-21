// Settings → Payments → Square Terminals (ROADMAP 18d-ii-b-i), for the gym's owner and for
// everybody else.
//
// The worst thing this part could do is show a Terminal as the gym's when it is not, or let
// somebody other than the owner pair or remove one. So the list is the server's, the buttons are
// the owner's alone, Remove asks first, and "paired" is said only when the server says so.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getGymPayments: vi.fn(),
      connectSquare: vi.fn(),
      chooseSquareLocation: vi.fn(),
      disconnectSquare: vi.fn(),
      pairSquareTerminal: vi.fn(),
      checkSquarePairing: vi.fn(),
      removeSquareTerminal: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const PaymentsPanel = (await import('./PaymentsPanel')).default;
const SquareTerminals = (await import('./SquareTerminals')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'iron-house', name: 'Iron House', orgType: 'gym', country: 'US', timezone: 'America/Chicago', clockFormat: '12h' };
const CONNECTED = { state: 'connected', businessName: 'Iron House LLC', locationName: 'Austin', locations: [], connectedAt: '2026-10-19T14:30:00.000Z', removedAt: null };
const PAIRING_ID = '22222222-2222-4222-8222-222222222222';
const TERMINAL = { id: PAIRING_ID, serial: 'R5WNWB5BKNG9R', practice: null, pairedAt: '2026-10-21T15:00:00.000Z' };
const PRACTICE = { id: '33333333-3333-4333-8333-333333333333', serial: null, practice: 'saves', pairedAt: '2026-10-21T15:00:00.000Z' };
const none = (over = {}) => ({ needsAllow: false, list: [], pairing: null, ...over });
const payments = (terminals, over = {}) => ({ availability: 'square', country: 'US', canConnect: true, squareReady: true, square: CONNECTED, terminals, ...over });

const assign = vi.fn();

function openPanel(data) {
  orgService.getGymPayments.mockResolvedValue({ data: { payments: data } });
  render(
    <MemoryRouter>
      <PaymentsPanel org={ORG} readOnly={false} countryTo={null} openSquare={assign} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^payments/i }));
}

/** The Terminals part alone, holding the box's answer as the box does, asking every 5 ms. */
function Holder({ start, owner = true, readOnly = false }) {
  const [data, setData] = useState(start);
  return (
    <SquareTerminals
      org={ORG}
      terminals={data.terminals}
      owner={owner}
      readOnly={readOnly}
      onPayments={setData}
      onReload={() => undefined}
      onConnectAgain={() => undefined}
      checkEveryMs={5}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('connected in the US, Canada or Australia', () => {
  it('the owner pairs a Terminal: the code and the steps, waiting, then the Terminal by its serial number', async () => {
    render(<Holder start={payments(none())} />);
    expect(screen.getByText('No Terminals paired yet.')).toBeTruthy();
    orgService.pairSquareTerminal.mockResolvedValue({ data: { code: 'AFZEFB', pairBy: '2026-10-21T15:05:00.000Z', payments: payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:05:00.000Z' } })) } });
    orgService.checkSquarePairing
      .mockResolvedValueOnce({ data: { outcome: 'waiting', payments: payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:05:00.000Z' } })) } })
      .mockResolvedValueOnce({ data: { outcome: 'paired', payments: payments(none({ list: [TERMINAL] })) } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair a Terminal' }));

    const box = await screen.findByRole('group', { name: 'Pair a Square Terminal' });
    expect(within(box).getByText('AFZEFB')).toBeTruthy();
    expect(within(box).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'If the Terminal is signed in, sign out first (Settings > Sign out).',
      'Tap Sign in, then Use a device code.',
      'Enter this code:',
    ]);
    expect(within(box).getByText(/^Expires at /)).toBeTruthy();
    expect(within(box).getByText('Waiting for the Terminal…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pair a Terminal' })).toBeNull();

    expect(await screen.findByText('Terminal paired.')).toBeTruthy();
    expect(orgService.checkSquarePairing).toHaveBeenCalledTimes(2);
    expect(orgService.checkSquarePairing).toHaveBeenCalledWith(ORG.id, PAIRING_ID);
    expect(screen.queryByRole('group', { name: 'Pair a Square Terminal' })).toBeNull();
    expect(screen.queryByText('AFZEFB')).toBeNull();
    expect(screen.getByText('Square Terminal')).toBeTruthy();
    expect(screen.getByText('Serial R5WNWB5BKNG9R · Paired 21 Oct 2026')).toBeTruthy();
  });

  it('a code that runs out says so, and Get a new code asks Square again', async () => {
    render(<Holder start={payments(none())} />);
    orgService.pairSquareTerminal.mockResolvedValue({ data: { code: 'AFZEFB', pairBy: '2026-10-21T15:05:00.000Z', payments: payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:05:00.000Z' } })) } });
    orgService.checkSquarePairing.mockResolvedValue({ data: { outcome: 'expired', payments: payments(none()) } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair a Terminal' }));
    expect(await screen.findByText('This code has expired.')).toBeTruthy();
    expect(screen.queryByText('AFZEFB')).toBeNull();
    expect(screen.queryByText('Waiting for the Terminal…')).toBeNull();
    orgService.pairSquareTerminal.mockResolvedValue({ data: { code: 'QYXRJQ', pairBy: '2026-10-21T15:10:00.000Z', payments: payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:10:00.000Z' } })) } });
    orgService.checkSquarePairing.mockResolvedValue({ data: { outcome: 'waiting', payments: payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:10:00.000Z' } })) } });
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    expect(await screen.findByText('QYXRJQ')).toBeTruthy();
    expect(orgService.pairSquareTerminal).toHaveBeenCalledTimes(2);
  });

  it('a code waiting from before, with the code gone from the screen: Get a new code or Cancel', async () => {
    orgService.checkSquarePairing.mockResolvedValue({ data: { outcome: 'waiting', payments: payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:05:00.000Z' } })) } });
    render(<Holder start={payments(none({ pairing: { id: PAIRING_ID, pairBy: '2026-10-21T15:05:00.000Z' } }))} />);
    const box = screen.getByRole('group', { name: 'Pair a Square Terminal' });
    expect(within(box).getByText(/^A pairing code is active until .+\. Get a new code if you no longer have it\.$/)).toBeTruthy();
    expect(within(box).getByRole('button', { name: 'Get a new code' })).toBeTruthy();
    orgService.removeSquareTerminal.mockResolvedValue({ data: { payments: payments(none()) } });
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Pair a Square Terminal' })).toBeNull());
    expect(orgService.removeSquareTerminal).toHaveBeenCalledWith(ORG.id, PAIRING_ID);
    expect(screen.getByRole('button', { name: 'Pair a Terminal' })).toBeTruthy();
  });

  it('Remove asks first, names what changes and what stays, and says it is done in the same place', async () => {
    render(<Holder start={payments(none({ list: [TERMINAL] }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const ask = screen.getByRole('group', { name: 'Remove this Terminal?' });
    expect(within(ask).getByText('It will no longer be available to Iron House.')).toBeTruthy();
    expect(within(ask).getByText('It stays signed in to Square. To sign it out, go to Settings > Sign out on the Terminal.')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(orgService.removeSquareTerminal).not.toHaveBeenCalled();
    orgService.removeSquareTerminal.mockResolvedValue({ data: { payments: payments(none()) } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Remove this Terminal?' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Terminal removed.')).toBeTruthy();
    expect(orgService.removeSquareTerminal).toHaveBeenCalledWith(ORG.id, TERMINAL.id);
    expect(screen.getByText('No Terminals paired yet.')).toBeTruthy();
  });

  it("a refusal from the server is said in the box, and nothing reads as paired", async () => {
    render(<Holder start={payments(none())} />);
    orgService.pairSquareTerminal.mockRejectedValue({ response: { status: 409, data: { error: 'terminals_full', message: 'You can pair up to 20 Terminals. Remove one to pair another.' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair a Terminal' }));
    expect(await screen.findByText('You can pair up to 20 Terminals. Remove one to pair another.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Pair a Square Terminal' })).toBeNull();
    expect(screen.queryByText('Terminal paired.')).toBeNull();
  });

  it('anybody else reads the list, with no button, and the line says who can', async () => {
    render(<Holder start={payments(none({ list: [TERMINAL] }))} owner={false} />);
    expect(screen.getByText('Serial R5WNWB5BKNG9R · Paired 21 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Only the owner can pair or remove Terminals.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it("a gym whose plan has ended can't pair, and is told why", async () => {
    render(<Holder start={payments(none())} readOnly />);
    expect(screen.getByRole('button', { name: 'Pair a Terminal' }).disabled).toBe(true);
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
  });
});

describe("Square's sandbox", () => {
  it('a simulated Terminal added for testing is listed by what it does, and the box offers nothing a real gym does not see', async () => {
    const simulated = { ...PRACTICE, practice: 'cancels' };
    render(<Holder start={payments(none({ list: [simulated] }))} />);
    expect(screen.getByText('Simulated Terminal · Member cancels')).toBeTruthy();
    expect(screen.getByText('Added 21 Oct 2026')).toBeTruthy();
    expect(screen.queryByText(/Test mode|sandbox|Add simulated/)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Remove', 'Pair a Terminal']);
    orgService.removeSquareTerminal.mockResolvedValue({ data: { payments: payments(none()) } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const ask = screen.getByRole('group', { name: 'Remove this Terminal?' });
    expect(within(ask).getByText("It's a simulated Terminal in Square's sandbox.")).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Terminal removed.')).toBeTruthy();
    expect(orgService.removeSquareTerminal).toHaveBeenCalledWith(ORG.id, simulated.id);
  });
});

describe('in the Payments box', () => {
  it('connected before the Terminal could be used: the owner connects Square again, on Square\'s own page', async () => {
    openPanel(payments(none({ needsAllow: true })));
    const part = await screen.findByRole('region', { name: 'Square Terminals' });
    expect(within(part).getByText('Reconnect Square to use Square Terminals.')).toBeTruthy();
    expect(within(part).queryByRole('button', { name: 'Pair a Terminal' })).toBeNull();
    orgService.connectSquare.mockResolvedValue({ data: { url: 'https://connect.squareupsandbox.com/oauth2/authorize?state=abc' } });
    fireEvent.click(within(part).getByRole('button', { name: 'Reconnect Square' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.squareupsandbox.com/oauth2/authorize?state=abc'));
  });

  it('anybody else is told the owner needs to', async () => {
    openPanel(payments(none({ needsAllow: true }), { canConnect: false }));
    expect(await screen.findByText('The owner needs to reconnect Square before Terminals can be used.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect Square' })).toBeNull();
  });

  it('elsewhere, or not connected, there is no Terminals part', async () => {
    openPanel(payments(null, { country: 'GB' }));
    expect(await screen.findByText('Connected to Square · Iron House LLC')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Square Terminals' })).toBeNull();
    expect(screen.queryByText('Square Terminals')).toBeNull();
  });

  it('sits between the connection and Disconnect, and the box keeps every button it had', async () => {
    openPanel(payments(none({ list: [TERMINAL] })));
    const part = await screen.findByRole('region', { name: 'Square Terminals' });
    expect(within(part).getByText('Serial R5WNWB5BKNG9R · Paired 21 Oct 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect Square' })).toBeTruthy();
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(['Iron House LLC', 'Austin', '19 Oct 2026']);
  });
});
