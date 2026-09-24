// Paddle's own checkout window (ROADMAP Stage 3 item 1a). Paddle requires its script
// to be loaded from its own site (developer.paddle.com, "Include and initialize
// Paddle.js": "Always load Paddle.js directly from https://cdn.paddle.com/"), so it
// is added to the page the first time somebody presses Subscribe, never before.
// Card details go to Paddle's window alone; this page never sees them.

export const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

let loading = null;
let initialisedWith = null;
let listener = null;

function loadScript() {
  if (typeof window !== 'undefined' && window.Paddle) return Promise.resolve(window.Paddle);
  if (loading !== null) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle did not load')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Paddle did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Open Paddle's window for the transaction our server made. `onEvent` hears
 *  `completed` (with Paddle's transaction id) and `closed`. Resolves once the window
 *  is asked to open; rejects when Paddle's script cannot be loaded. */
export async function openPaddleCheckout({ environment, clientToken, transactionId, onEvent }) {
  const Paddle = await loadScript();
  listener = onEvent;
  const key = `${environment}:${clientToken}`;
  if (initialisedWith !== key) {
    if (environment === 'sandbox') Paddle.Environment.set('sandbox');
    Paddle.Initialize({
      token: clientToken,
      eventCallback: (event) => {
        if (listener === null) return;
        if (event?.name === 'checkout.completed') listener({ type: 'completed', transactionId: event?.data?.transaction_id ?? null });
        else if (event?.name === 'checkout.closed') listener({ type: 'closed' });
      },
    });
    initialisedWith = key;
  }
  Paddle.Checkout.open({
    transactionId,
    settings: { displayMode: 'overlay', theme: 'dark', locale: 'en', allowLogout: false },
  });
}

/** Close Paddle's window (after the payment has reached the gym). */
export function closePaddleCheckout() {
  listener = null;
  if (typeof window !== 'undefined' && window.Paddle?.Checkout?.close) window.Paddle.Checkout.close();
}
