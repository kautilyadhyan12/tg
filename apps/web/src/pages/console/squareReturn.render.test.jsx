// Where Square sends a gym's owner back (ROADMAP 18d-i): Square's answer goes to the server
// exactly as it came, once, and the person lands on their gym's Payments box.
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { finishSquare: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const SquareReturn = (await import('./SquareReturn')).default;

function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{`${location.pathname}${location.hash}|${JSON.stringify(location.state)}`}</p>;
}

function open(search) {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/connect/square${search}`]}>
        <Routes>
          <Route path="/connect/square" element={<SquareReturn />} />
          <Route path="/console/:orgSlug/settings" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

const STATE = 'a'.repeat(43);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('back from Square', () => {
  it("after Allow: Square's code goes to the server once, and the owner lands on the gym's Payments box with what happened", async () => {
    orgService.finishSquare.mockResolvedValue({ data: { gymSlug: 'iron-house', outcome: 'connected', refusal: null } });
    open(`?code=sq0cgb-abc&state=${STATE}`);
    expect((await screen.findByTestId('landed')).textContent).toBe('/console/iron-house/settings#payments|{"squareOutcome":{"outcome":"connected","refusal":null}}');
    expect(orgService.finishSquare).toHaveBeenCalledTimes(1);
    expect(orgService.finishSquare).toHaveBeenCalledWith({ state: STATE, code: 'sq0cgb-abc' });
  });

  it('after Deny: the error goes instead of a code', async () => {
    orgService.finishSquare.mockResolvedValue({ data: { gymSlug: 'iron-house', outcome: 'cancelled', refusal: null } });
    open(`?error=access_denied&error_description=user_denied&state=${STATE}`);
    await screen.findByTestId('landed');
    expect(orgService.finishSquare).toHaveBeenCalledWith({ state: STATE, error: 'access_denied' });
  });

  it('opened without Square: says nothing was connected, and asks the server nothing', async () => {
    open('?code=sq0cgb-abc');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('This page opens when you come back from Square. Nothing was connected.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open your console' }).getAttribute('href')).toBe('/console');
    expect(orgService.finishSquare).not.toHaveBeenCalled();
  });

  it("a press that ran out: the server's sentence, and the way back to the gym whose Connect was pressed", async () => {
    window.sessionStorage.setItem('squareConnectGym', 'iron-house');
    orgService.finishSquare.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: 'square_connect_expired', message: 'This Square sign-in has run out or was already used. Press Connect Square again.' } },
    });
    open(`?code=sq0cgb-abc&state=${STATE}`);
    expect(await screen.findByText('This Square sign-in has run out or was already used. Press Connect Square again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Payments' }).getAttribute('href')).toBe('/console/iron-house/settings#payments');
  });
});
