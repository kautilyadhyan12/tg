// Razorpay's own checkout window for an Indian gym (ROADMAP Stage 3 item 1d-i). Razorpay's
// script is loaded from its own site (razorpay.com/docs, Subscriptions integration guide:
// https://checkout.razorpay.com/v1/checkout.js) the first time somebody presses Subscribe,
// never before. Card and UPI details go to Razorpay's window alone; this page never sees
// them, and what the window reports is never trusted: the server asks Razorpay itself.

export const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let loading = null;
let open = null;

function loadScript() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading !== null) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not load')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Razorpay did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Open Razorpay's window for the subscription our server made. `onEvent` hears `completed`
 *  (the mandate was given, or the first payment taken) and `closed`. Resolves once the window
 *  is asked to open; rejects when Razorpay's script cannot be loaded. */
export async function openRazorpayCheckout({ keyId, subscriptionId, name, description, email, contact, onEvent }) {
  const Razorpay = await loadScript();
  const instance = new Razorpay({
    key: keyId,
    subscription_id: subscriptionId,
    name,
    description,
    // Razorpay asks every payer for a mobile number and an email, unless the app already knows
    // them, as apps that sign in by mobile do (its checkout options `prefill`, `readonly` and
    // `hidden`, read 2026-09-29). The owner's sign-in email, and the mobile an Indian gym gave
    // for its payments (Kd, RULINGS 2026-09-29), are filled in and their boxes hidden; one the
    // app does not have, Razorpay asks for.
    prefill: { ...(email ? { email } : {}), ...(contact ? { contact } : {}) },
    readonly: { email: Boolean(email), contact: Boolean(contact) },
    hidden: { email: Boolean(email), contact: Boolean(contact) },
    // The console's accent (console.css --accent): Razorpay's window takes a colour, not a name.
    theme: { color: '#FF8A1F' },
    handler: () => onEvent({ type: 'completed' }),
    modal: { ondismiss: () => onEvent({ type: 'closed' }), confirm_close: true },
  });
  open = instance;
  instance.open();
}

/** Close Razorpay's window (after the payment has reached the gym). */
export function closeRazorpayCheckout() {
  if (open !== null && typeof open.close === 'function') open.close();
  open = null;
}
