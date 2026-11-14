// THE FRONT PAGE (ROADMAP Stage 4 item 12a). The worst it could do to a real person: lock gyms out of signing
// in and their console, or quietly weaken the console's security rules. Those two come first; the rest checks
// that the page keeps its own strict rules, uses only files that are here, and says what the app says.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_DISCLAIMER_VERSION, DISCLAIMER_WORDINGS, LEGAL_PATHS } from '@app/shared';
import { contentSecurityPolicy, contentSecurityPolicyPlugin, frontPageContentSecurityPolicy, isFrontPage } from '../contentSecurityPolicy.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const exists = (relative) => existsSync(new URL(relative, import.meta.url));
const page = read('../../home.html');
const css = read('./home.css');
const script = read('./home.js');
const caddy = read('../../../../infra/Caddyfile.selfhost');
const directivesOf = (policy) => Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

// The web site's block of the server's settings, every line trimmed, comments out.
const siteLines = caddy.slice(caddy.indexOf('{$WEB_DOMAIN} {')).split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));

describe('signing in and the console are where they were', () => {
  it("shows the front page at the site's own address alone; every other address is still the console", () => {
    const rewrites = siteLines.filter((l) => l.startsWith('rewrite'));
    expect(rewrites).toEqual(['rewrite @front /home.html']);
    // The matcher is the bare address, exactly: not a prefix, not a pattern, not a list.
    expect(siteLines.filter((l) => l.startsWith('@front'))).toEqual(['@front path /']);
    // Everything else falls through to the console's page, as before.
    expect(siteLines).toContain('try_files {path} /index.html');
    expect(siteLines.filter((l) => l.startsWith('try_files'))).toHaveLength(1);
  });

  it("keeps the console's own page whole, and builds both pages", async () => {
    const console_ = read('../../index.html');
    expect(console_).toContain('<div id="root"></div>');
    expect(console_).toContain('<script type="module" src="/src/main.jsx"></script>');
    const { default: config } = await import('../../vite.config.js');
    const input = config({ mode: 'production', command: 'build' }).build.rollupOptions.input;
    expect(Object.keys(input).sort()).toEqual(['home', 'main']);
    expect(input.main.replaceAll('\\', '/')).toMatch(/\/apps\/web\/index\.html$/);
    expect(input.home.replaceAll('\\', '/')).toMatch(/\/apps\/web\/home\.html$/);
  });
});

describe("the security rules: the console's unchanged, the front page's stricter", () => {
  const plugin = contentSecurityPolicyPlugin({ VITE_API_URL: 'https://api.getkwazo.com' });
  plugin.configResolved({ command: 'build' });
  const metaFor = (ctx) => plugin.transformIndexHtml('', ctx)[0].attrs.content;

  it("writes the console's policy, exactly as before, into the console's page", () => {
    const consolePolicy = contentSecurityPolicy({ apiAddresses: ['https://api.getkwazo.com'] });
    expect(metaFor({ path: '/index.html', filename: '/repo/apps/web/index.html' })).toBe(consolePolicy);
    // A page whose name only ends like the front page's is not the front page.
    expect(metaFor({ path: '/myhome.html', filename: '/repo/apps/web/myhome.html' })).toBe(consolePolicy);
    expect(isFrontPage({ filename: 'C:\\repo\\apps\\web\\home.html' })).toBe(true);
    expect(isFrontPage(undefined)).toBe(false);
  });

  it('gives the front page a policy that runs only its own script and lets in nothing from anywhere else', () => {
    expect(metaFor({ path: '/home.html', filename: '/repo/apps/web/home.html' })).toBe(frontPageContentSecurityPolicy());
    const built = directivesOf(frontPageContentSecurityPolicy());
    expect(built['script-src']).toEqual(["'self'"]);
    expect(built['style-src']).toEqual(["'self'"]);
    expect(built['default-src']).toEqual(["'self'"]);
    expect(built['object-src']).toEqual(["'none'"]);
    expect(built['frame-src']).toEqual(["'none'"]);
    expect(built['base-uri']).toEqual(["'self'"]);
    expect(built['form-action']).toEqual(["'self'"]);
    for (const [name, values] of Object.entries(built)) {
      for (const value of values) {
        expect(value, name).not.toMatch(/unsafe|^\*$|^https?:|^wss?:|^blob:/);
      }
    }
    expect(built['img-src']).toEqual(["'self'", 'data:']);
  });

  it("allows written-in scripts only on Vite's own development server, never in a build", () => {
    const dev = directivesOf(frontPageContentSecurityPolicy({ dev: true }));
    expect(dev['script-src']).toContain("'unsafe-inline'");
    const devPlugin = contentSecurityPolicyPlugin({});
    devPlugin.configResolved({ command: 'serve' });
    expect(devPlugin.transformIndexHtml('', { path: '/home.html' })[0].attrs.content).toBe(frontPageContentSecurityPolicy({ dev: true }));
  });

  it("holds exactly these server rules for the site, nothing added, nothing taken away", () => {
    // Pinned whole (12a's security pass, L2): one added line such as `header @front -Content-Security-Policy`
    // would let the front page be framed while every line checked below was still there. A change here is
    // deliberate, and is run with `node tools/check-web-locally.mjs <build>` before it is pinned again.
    expect(siteLines).toEqual([
      '{$WEB_DOMAIN} {',
      'root * /srv/web',
      '@notEmbed not {',
      'path_regexp ^/gyms/[^/]+/?$',
      'query embed=1',
      '}',
      'header @notEmbed Content-Security-Policy "frame-ancestors \'none\'"',
      'header {',
      'Strict-Transport-Security "max-age=31536000; includeSubDomains"',
      'X-Content-Type-Options "nosniff"',
      'Referrer-Policy "strict-origin-when-cross-origin"',
      '}',
      '@hashed {',
      'path /assets/*',
      'file',
      '}',
      'header @hashed Cache-Control "public, max-age=31536000, immutable"',
      '@missingAsset {',
      'path /assets/*',
      'not file',
      '}',
      'header @missingAsset Cache-Control "no-store"',
      '@page not path /assets/*',
      'header @page Cache-Control "no-cache"',
      'encode zstd gzip',
      'handle /assets/* {',
      'file_server',
      '}',
      'handle {',
      '@front path /',
      'rewrite @front /home.html',
      'try_files {path} /index.html',
      'file_server',
      '}',
      'log {',
      'output stdout',
      'format filter {',
      'wrap json',
      'fields {',
      'request>uri regexp "\\?.*$" ""',
      'request>headers>Referer delete',
      '}',
      '}',
      '}',
      '}',
    ]);
  });

  it("keeps the server's rules on every page, the front page's address included", () => {
    // Only a gym's page as its embed escapes "never in a frame"; the bare address is not one.
    expect(siteLines).toContain('@notEmbed not {');
    expect(siteLines).toContain('path_regexp ^/gyms/[^/]+/?$');
    expect(siteLines).toContain('header @notEmbed Content-Security-Policy "frame-ancestors \'none\'"');
    expect(siteLines).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(siteLines).toContain('X-Content-Type-Options "nosniff"');
    expect(siteLines).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
  });
});

describe('the front page keeps its own rules', () => {
  it('runs no script written into the page, and no style either', () => {
    const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, inside] of scripts) {
      if (/type="application\/ld\+json"/.test(attrs)) {
        expect(() => JSON.parse(inside)).not.toThrow();
        continue;
      }
      expect(attrs).toMatch(/\bsrc="\/src\/home\/home\.js"/);
      expect(inside.trim()).toBe('');
    }
    expect(scripts.length).toBe(2);
    expect(page).not.toMatch(/\son[a-z]+\s*=/i);
    expect(page).not.toMatch(/\sstyle\s*=/i);
    expect(page).not.toMatch(/<style\b/i);
    expect(page).not.toMatch(/javascript:/i);
    // The script never writes a whole style attribute (a policy would refuse it); it sets style properties.
    expect(script).not.toMatch(/setAttribute\(\s*['"]style['"]/);
    expect(script).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  });

  it('switches between the computer and phone layouts at the same point in its stylesheet and its script', () => {
    // A computer page needs a screen wide enough, wide in shape and tall enough for its words (12a-ii: a phone held
    // sideways, 844 x 390, ran its words 264 px below the screen); every other screen gets the phone page. The two
    // conditions must be exact opposites, or a screen would get half of each.
    expect(script).toContain("matchMedia('(min-width: 821px) and (min-aspect-ratio: 3/2) and (min-height: 540px)')");
    expect(css).toContain('@media (max-width:820px),(max-aspect-ratio:1499/1000),(max-height:539px){');
    expect(css).toContain('@media (min-width:821px) and (min-aspect-ratio:3/2) and (min-height:540px) and (max-height:760px){');
    expect(css.match(/@media[^{]*aspect-ratio/g)).toHaveLength(2);
    // On the phone page the picture always covers the width: never shorter than a 16:9 picture as wide as the screen.
    expect(css).toContain(':root{--pic:max(56svh,320px,56.25vw)}');
  });

  it('names no other site but its own address, for Google and shared links', () => {
    // An inline drawing's `xmlns` names its format and is never fetched; it is the one exception.
    const outside = [...page.matchAll(/(?<!xmlns=")https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    expect(outside.length).toBeGreaterThan(5);
    for (const address of outside) expect(address).toMatch(/^https:\/\/(getkwazo\.com\/|schema\.org$)/);
    for (const [, ns] of page.matchAll(/xmlns="([^"]+)"/g)) expect(ns).toBe('http://www.w3.org/2000/svg');
    expect(css).not.toMatch(/https?:\/\//);
    expect(script).not.toMatch(/https?:\/\//);
  });

  it("links only to the app's own pages, its own scenes and the support address", () => {
    const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const pages = new Set(['/login', ...Object.values(LEGAL_PATHS)]);
    for (const [, href] of page.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
      if (href.startsWith('#')) expect(ids.has(href.slice(1)), href).toBe(true);
      else if (href.startsWith('mailto:')) expect(href).toBe('mailto:support@getkwazo.com');
      else expect(pages.has(href), href).toBe(true);
    }
    for (const [, target] of page.matchAll(/\sdata-go="([^"]+)"/g)) expect(ids.has(target), target).toBe(true);
    // Every legal page is linked from the end of the page.
    for (const path of Object.values(LEGAL_PATHS)) expect(page).toContain(`href="${path}"`);
  });

  it('uses only files that are in the repository', () => {
    const local = [...page.matchAll(/\s(?:src|href)="(\/[^"#]+)"/g)].map((m) => m[1]).filter((p) => !pagesAndRoutes(p));
    expect(local.length).toBeGreaterThan(20);
    for (const file of local) {
      const where = file.startsWith('/src/') ? `../..${file}` : `../../public${file}`;
      expect(exists(where), file).toBe(true);
    }
    const fromCss = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]);
    // Bowlby One, Lexend in four weights (one file each: a variable file drew one thin weight in Safari's engine), eight masks.
    expect(fromCss.length).toBe(13);
    expect(fromCss.filter((f) => /^fonts\/lexend-(400|500|600|700)-latin\.woff2$/.test(f))).toHaveLength(4);
    for (const file of fromCss) expect(exists(`./${file}`), file).toBe(true);
    const fromScript = [...script.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);
    // The eight clips and the clip rule: nothing else, so the page loads no console code.
    expect(fromScript.sort()).toEqual(['clipRules.js', ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `img/w${String(n)}-clip.mp4`)]);
    expect(script).not.toMatch(/from ['"](?!\.\/)/);
    for (const file of fromScript) expect(exists(`./${file}`), file).toBe(true);
    // Each room's clip is one the script brought in.
    for (const [, n] of page.matchAll(/data-clip="(\d)"/g)) expect(script).toContain(`import clip${n} from './img/w${n}-clip.mp4'`);
    expect(exists('./fonts/OFL-bowlby-one.txt') && exists('./fonts/OFL-lexend.txt')).toBe(true);
  });

  it('tells Google the name, the words and the picture to show, and where the page lives', () => {
    expect(page).toContain('<title>KWAZO | Gym Management Software &amp; Fitness App</title>');
    const description = page.match(/<meta name="description" content="([^"]+)">/)[1];
    expect(description.length).toBeLessThanOrEqual(155);
    expect(page).toContain('<link rel="canonical" href="https://getkwazo.com/">');
    expect(page).toContain('<meta property="og:image" content="https://getkwazo.com/og-image.jpg">');
    const data = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    expect(data['@graph'].find((n) => n['@type'] === 'WebSite')).toMatchObject({ name: 'KWAZO', url: 'https://getkwazo.com/' });
    expect(read('../../public/robots.txt')).toContain('Sitemap: https://getkwazo.com/sitemap.xml');
    expect(read('../../public/sitemap.xml')).toContain('<loc>https://getkwazo.com/</loc>');
    expect(read('../../index.html')).toContain('<title>KWAZO</title>');
  });
});

describe('what the front page says', () => {
  const text = page.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');

  it("shows the app's own legal notice, word for word", () => {
    const notice = DISCLAIMER_WORDINGS.sign_up[CURRENT_DISCLAIMER_VERSION.sign_up];
    expect(notice).toMatch(/^You must be 18 or older/);
    expect(text).toContain(notice);
  });

  it('shows no price anywhere (Kd, 2026-11-14: "PRICES WILL NOT BE SHOWN")', () => {
    expect(text).not.toMatch(/[$€£₹]|\b(?:USD|INR|EUR|GBP)\b|per month|\/\s?mo(?:nth)?\b|per year|\/\s?yr\b/i);
    // A bare number by a period of time reads as a price too: "from 49 a month", "49 monthly", "79/month billed yearly".
    expect(text).not.toMatch(/\d[\d.,]*\s*(?:\/\s*|a\s+|an\s+|per\s+|each\s+)?(?:months?|monthly|years?|yearly|annual(?:ly)?|weeks?|weekly)\b/i);
    expect(text).not.toMatch(/\b(?:billed|pricing|price|plans? from|subscription)\b/i);
  });

  it('never calls KWAZO a health or medical app', () => {
    expect(text).not.toMatch(/\bhealth app\b/i);
    expect(text).toContain('Is KWAZO a medical app?');
    expect(text).toContain('It is not a medical app');
  });
});

function pagesAndRoutes(path) {
  return path === '/login' || Object.values(LEGAL_PATHS).includes(path);
}
