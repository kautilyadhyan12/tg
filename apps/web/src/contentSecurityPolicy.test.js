// The console's Content Security Policy (ROADMAP 18d-ii): only our own scripts and the named
// companies' may run, Square's card boxes and its card address are allowed, and nothing that
// would let an injected script run is.
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './contentSecurityPolicy';

const directivesOf = (policy) => Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('the console policy, as built', () => {
  const built = directivesOf(contentSecurityPolicy({ apiAddresses: ['https://api.kwazo.example/v1', undefined, '', 'not an address'] }));

  it('runs no script written into the page, and no evaluated code but WebAssembly', () => {
    expect(built['script-src']).not.toContain("'unsafe-inline'");
    expect(built['script-src']).not.toContain("'unsafe-eval'");
    expect(built['script-src']).toContain("'wasm-unsafe-eval'");
    for (const values of Object.values(built)) expect(values).not.toContain('*');
    expect(built['object-src']).toEqual(["'none'"]);
    expect(built['base-uri']).toEqual(["'self'"]);
  });

  it("allows Square's card boxes as Square's own page lists them, for its test area and live", () => {
    for (const host of ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com']) {
      expect(built['script-src']).toContain(host);
      expect(built['frame-src']).toContain(host);
      expect(built['connect-src']).toContain(host);
      expect(built['style-src']).toContain(host);
    }
    for (const host of ['https://pci-connect.squareup.com', 'https://pci-connect.squareupsandbox.com', 'https://o160250.ingest.sentry.io']) expect(built['connect-src']).toContain(host);
    for (const host of ['https://square-fonts-production-f.squarecdn.com', 'https://d1g145x70srn7h.cloudfront.net', 'https://cash-f.squarecdn.com']) expect(built['font-src']).toContain(host);
  });

  it("allows the gym's plan checkout, the robot check and the camera's fallback, and the api by its origin alone", () => {
    expect(built['script-src']).toEqual(expect.arrayContaining(['https://cdn.paddle.com', 'https://checkout.razorpay.com', 'https://challenges.cloudflare.com', 'https://cdn.jsdelivr.net']));
    expect(built['frame-src']).toEqual(expect.arrayContaining(['https://*.paddle.com', 'https://*.razorpay.com', 'https://challenges.cloudflare.com']));
    expect(built['connect-src']).toContain('https://api.kwazo.example');
    expect(built['connect-src']).toEqual(expect.arrayContaining(['https://cdn.jsdelivr.net', 'https://storage.googleapis.com']));
    expect(built['connect-src'].filter((v) => v.includes('not an address') || v === 'undefined')).toEqual([]);
    expect(built['connect-src']).not.toContain('ws:');
  });

  it("Vite's development server adds only its own written-in script and its reload socket", () => {
    const dev = directivesOf(contentSecurityPolicy({ apiAddresses: ['http://127.0.0.4:3004'], dev: true }));
    expect(dev['script-src']).toContain("'unsafe-inline'");
    expect(dev['connect-src']).toEqual(expect.arrayContaining(['http://127.0.0.4:3004', 'ws:', 'wss:']));
    expect(dev['script-src']).not.toContain("'unsafe-eval'");
  });
});
