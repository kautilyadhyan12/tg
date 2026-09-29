// @vitest-environment jsdom
// What Razorpay's window is told (ROADMAP 1d-i): what the app knows of the payer is filled in
// and its box hidden; what it does not know, Razorpay asks for.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRazorpayCheckout } from './razorpayCheckout';

afterEach(() => {
  delete window.Razorpay;
});

function fakeRazorpay() {
  const made = [];
  window.Razorpay = vi.fn(function Razorpay(options) {
    made.push(options);
    this.open = vi.fn();
  });
  return made;
}

describe("Razorpay's window", () => {
  it("is given the subscription, and fills in and hides the owner's email and mobile", async () => {
    const made = fakeRazorpay();
    await openRazorpayCheckout({ keyId: 'rzp_test_AAAAAAAAAAAAAA', subscriptionId: 'sub_AAAAAAAAAAAAAA', name: 'Pune Fitness', description: 'Monthly, up to 200 members', email: 'owner@example.com', contact: '+919876543210', onEvent: vi.fn() });
    expect(made[0]).toMatchObject({
      key: 'rzp_test_AAAAAAAAAAAAAA',
      subscription_id: 'sub_AAAAAAAAAAAAAA',
      prefill: { email: 'owner@example.com', contact: '+919876543210' },
      readonly: { email: true, contact: true },
      hidden: { email: true, contact: true },
    });
  });

  it('leaves the mobile box for Razorpay to ask when the gym gave none', async () => {
    const made = fakeRazorpay();
    await openRazorpayCheckout({ keyId: 'rzp_test_AAAAAAAAAAAAAA', subscriptionId: 'sub_AAAAAAAAAAAAAA', name: 'Pune Fitness', description: 'x', email: 'owner@example.com', contact: '', onEvent: vi.fn() });
    expect(made[0].prefill).toEqual({ email: 'owner@example.com' });
    expect(made[0].hidden).toEqual({ email: true, contact: false });
    expect(made[0].readonly).toEqual({ email: true, contact: false });
  });
});
