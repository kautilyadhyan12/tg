// SQUARE'S OWN CARD FORM, in a box on the console (ROADMAP 18d-ii). Square's script draws the
// card boxes in a window of its own inside our page: what is typed there goes to Square and
// never to us, and Square hands back a one-time token for it (developer.squareup.com, "Store a
// card on file", read 2026-10-20). The script is loaded from Square, as Square asks, once.

const SCRIPT = {
  sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js',
  production: 'https://web.squarecdn.com/v1/square.js',
};

let loading = null;

/** Square's script, loaded once for the server's Square environment. */
export function loadSquare(environment) {
  if (globalThis.Square !== undefined) return Promise.resolve(globalThis.Square);
  if (loading !== null && loading.environment === environment) return loading.promise;
  const src = SCRIPT[environment];
  if (src === undefined) return Promise.reject(new Error('unknown Square environment'));
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => (globalThis.Square === undefined ? reject(new Error('Square did not load')) : resolve(globalThis.Square));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Square did not load'));
    };
    document.head.appendChild(script);
  });
  loading = { environment, promise };
  return promise;
}

/** Square's boxes in the console's own colours, read by name from `console.css` where the form
 *  is drawn (either look). Square takes plain values; a name not set is left to Square. */
export function cardStyle(element) {
  const read = (name) => {
    const value = globalThis.getComputedStyle(element).getPropertyValue(name).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : null;
  };
  const [input, line, focus, text, placeholder, bad] = ['--input', '--input-line', '--accent', '--t1', '--t3', '--bad'].map(read);
  if ([input, line, focus, text, placeholder, bad].includes(null)) return null;
  return {
    '.input-container': { borderColor: line, borderRadius: '12px' },
    '.input-container.is-focus': { borderColor: focus },
    '.input-container.is-error': { borderColor: bad },
    '.message-text': { color: placeholder },
    '.message-icon': { color: placeholder },
    '.message-text.is-error': { color: bad },
    '.message-icon.is-error': { color: bad },
    input: { backgroundColor: input, color: text },
    'input::placeholder': { color: placeholder },
    'input.is-error': { color: bad },
  };
}

/** Square's card boxes, drawn into `container` for the gym's own Square location. */
export async function attachCardForm(form, container) {
  const Square = await loadSquare(form.environment);
  const payments = Square.payments(form.applicationId, form.locationId);
  const style = cardStyle(container);
  const card = await payments.card(style === null ? undefined : { style });
  await card.attach(container);
  return card;
}

/** The card typed in, as Square's token to save it. The member is there and typing it
 *  (not a phone or mail order), and saving it is the point: Square decides whether the bank
 *  checks them. Null when Square did not take what was typed; its boxes say why. */
export async function tokenizeToSave(card, contact) {
  const result = await card.tokenize({
    intent: 'STORE',
    customerInitiated: true,
    sellerKeyedIn: false,
    billingContact: {
      ...(contact.givenName === '' ? {} : { givenName: contact.givenName }),
      ...(contact.familyName === '' ? {} : { familyName: contact.familyName }),
      ...(contact.email === null ? {} : { email: contact.email }),
      countryCode: contact.countryCode,
    },
  });
  return result?.status === 'OK' && typeof result.token === 'string' ? result.token : null;
}
