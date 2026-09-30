// @vitest-environment jsdom
// What Paddle's window is told (ROADMAP Stage 3 item 1e): the gym owner's email and the gym's
// country, as the server sends them, so the payer types only the card and any postcode.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPaddleCheckout } from './paddleCheckout';

afterEach(() => {
  delete window.Paddle;
});

function fakePaddle() {
  const opened = [];
  window.Paddle = {
    Environment: { set: vi.fn() },
    Initialize: vi.fn(),
    Checkout: { open: vi.fn((options) => opened.push(options)), close: vi.fn() },
  };
  return opened;
}

const base = { environment: 'sandbox', clientToken: 'test_x', transactionId: 'txn_1', onEvent: vi.fn() };

describe("Paddle's window", () => {
  it("is given the transaction, and fills in the owner's email and the gym's country", async () => {
    const opened = fakePaddle();
    await openPaddleCheckout({ ...base, email: 'owner@example.com', country: 'AT' });
    expect(opened[0]).toMatchObject({ transactionId: 'txn_1', customer: { email: 'owner@example.com', address: { countryCode: 'AT' } } });
  });

  it('gives the email alone when the server sends no country, and Paddle asks for it', async () => {
    const opened = fakePaddle();
    await openPaddleCheckout({ ...base, email: 'owner@example.com', country: null });
    expect(opened[0].customer).toEqual({ email: 'owner@example.com' });
  });

  it('fills in nothing without an email, as before', async () => {
    const opened = fakePaddle();
    await openPaddleCheckout({ ...base, email: null, country: 'AT' });
    await openPaddleCheckout(base);
    expect(opened.map((o) => 'customer' in o)).toEqual([false, false]);
  });
});
