// THE CONSOLE'S CONTENT SECURITY POLICY (ROADMAP 18d-ii): which scripts, frames and addresses the
// browser lets the app use. Square requires one for its card boxes (developer.squareup.com,
// "Web Payments SDK" and "Content Security Policy", read 2026-10-20), and it is what stops a
// changed copy of our page from running a script that draws a fake card box: only our own
// scripts and those of the companies named here may run. Written into the page as it is built
// (`vite.config.js`), so it travels with the console to whatever host serves it.
//
// Each outside address is here for one thing the app does:
//   Square: its card boxes, their scripts, styles, fonts and the address they send the card to.
//   Paddle and Razorpay: the checkout a gym pays its plan through (their own domains: neither
//     publishes a fixed list of hosts).
//   Cloudflare: the robot check at sign-up and sign-in (developers.cloudflare.com, "Turnstile
//     Content Security Policy").
//   jsDelivr and Google's storage: the camera's pose files and model, only when our own copy is
//     missing (`usePoseDetection.js`, `dev/poseTuning.js`).
//   OpenStreetMap and LocationIQ: the address search on runs.

const SQUARE = ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com'];
const SQUARE_CONNECT = ['https://pci-connect.squareup.com', 'https://pci-connect.squareupsandbox.com', 'https://o160250.ingest.sentry.io'];
// Square's list, and the fonts its card boxes were seen loading (`cash-f`, measured 2026-10-20).
const SQUARE_FONTS = ['https://square-fonts-production-f.squarecdn.com', 'https://d1g145x70srn7h.cloudfront.net', 'https://cash-f.squarecdn.com'];
const PADDLE = ['https://cdn.paddle.com', 'https://*.paddle.com'];
const RAZORPAY = ['https://checkout.razorpay.com', 'https://*.razorpay.com'];
const CLOUDFLARE = ['https://challenges.cloudflare.com'];
const POSE = ['https://cdn.jsdelivr.net'];
const POSE_MODEL = ['https://storage.googleapis.com'];
const ADDRESSES = ['https://nominatim.openstreetmap.org', 'https://api.locationiq.com'];

/** The origin of an address the app talks to, or null when there is none or it is not one. */
function originOf(address) {
  if (typeof address !== 'string' || address.trim() === '') return null;
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'wss:' || url.protocol === 'ws:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The policy, as one string. `apiAddresses`: the api and the other servers the build talks to
 * (`VITE_API_URL` and the rest). `dev`: Vite's own development server, whose page carries one
 * script written into it and reloads over a websocket; never in a build.
 */
export function contentSecurityPolicy({ apiAddresses = [], dev = false } = {}) {
  const apis = [...new Set(apiAddresses.map(originOf).filter((o) => o !== null))];
  const webApis = apis.filter((o) => o.startsWith('http'));
  const directives = {
    'default-src': ["'self'"],
    // WebAssembly for the camera's pose model; never any other evaluated code.
    'script-src': ["'self'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-inline'"] : []), ...SQUARE, ...PADDLE, ...RAZORPAY, ...CLOUDFLARE, ...POSE],
    // The screens set colours on elements, and the companies' boxes bring their own styles and
    // fonts (Paddle's and Razorpay's checkouts are not proved on this laptop, which holds no keys
    // of theirs: their own domains are allowed).
    'style-src': ["'self'", "'unsafe-inline'", ...SQUARE, ...PADDLE, ...RAZORPAY],
    'font-src': ["'self'", 'data:', ...SQUARE_FONTS, ...PADDLE, ...RAZORPAY],
    // Pictures come from the api, from photos taken in the browser, and from outside pages a
    // gym links (a product's picture); a picture cannot run code.
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...webApis],
    'media-src': ["'self'", 'blob:', 'https:', ...webApis],
    'connect-src': ["'self'", ...apis, ...SQUARE, ...SQUARE_CONNECT, ...PADDLE, ...RAZORPAY, ...CLOUDFLARE, ...POSE, ...POSE_MODEL, ...ADDRESSES, ...(dev ? ['ws:', 'wss:'] : [])],
    'frame-src': [...SQUARE, ...PADDLE, ...RAZORPAY, ...CLOUDFLARE],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
    .join('; ');
}

/** Vite's part: the policy written into the page's head, first, for the build and for Vite's
 *  own development server alike. */
export function contentSecurityPolicyPlugin(env) {
  const apiAddresses = [env.VITE_API_URL, env.VITE_AUTH_API_URL, env.VITE_ML_API_URL, env.VITE_WS_URL];
  let dev = false;
  return {
    name: 'content-security-policy',
    configResolved(config) {
      dev = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy({ apiAddresses, dev }) },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
