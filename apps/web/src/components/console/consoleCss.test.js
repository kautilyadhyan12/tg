// WHAT EACH SCREEN WIDTH SHOWS lives in console.css, which jsdom never applies: the render
// tests find the computer menu, the phone's bars and More in the page at once. This reads
// the stylesheet itself, so deleting the rule that shows the menu from 768 px, or hiding
// the phone's tabs, turns a test red.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

// Read from disk: vitest hands a test an empty string for a stylesheet, `?raw` included.
const root = postcss.parse(readFileSync(fileURLToPath(new URL('./console.css', import.meta.url)), 'utf8'));

it('reads the stylesheet at all (the control)', () => {
  let rules = 0;
  root.walkRules(() => {
    rules += 1;
  });
  expect(rules).toBeGreaterThan(40);
});

/** The declarations for `selector` at the top level, or inside the @media rule whose
 *  params are `media`. A rule listing several selectors counts for each of them. */
function declarations(selector, media = null) {
  const found = {};
  root.walkRules((rule) => {
    const parent = rule.parent;
    const inMedia = parent.type === 'atrule' && parent.name === 'media' ? parent.params : null;
    if (inMedia !== media) return;
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((d) => {
      found[d.prop] = d.value;
    });
  });
  return found;
}

const COMPUTER = '(min-width: 768px)';
const PHONE = '(max-width: 767px)';

describe('what each width shows', () => {
  it('a phone: no menu on the left; the top bar and the tabs are not hidden', () => {
    expect(declarations('.c-rail').display).toBe('none');
    expect(declarations('.c-tabbar').display).not.toBe('none');
    expect(declarations('.c-topbar').display).not.toBe('none');
    expect(declarations('.c-tabbar').position).toBe('fixed');
  });

  it('a computer, from 768 px: the menu on the left, no top bar and no tabs', () => {
    expect(declarations('.c-rail', COMPUTER).display).toBe('flex');
    expect(declarations('.c-topbar', COMPUTER).display).toBe('none');
    expect(declarations('.c-tabbar', COMPUTER).display).toBe('none');
    expect(declarations('.c-main', COMPUTER)['margin-left']).toBe(declarations('.c-rail', COMPUTER).width);
  });
});

describe('the banner above every page reads in both looks', () => {
  // Its colours are the looks' named ones, so the light look's pale page cannot swallow
  // pale text (the finding of R1's review).
  it.each([
    ['.c-banner-danger', 'var(--bad-bg)', 'var(--bad)'],
    ['.c-banner-warn', 'var(--warn-bg)', 'var(--warn)'],
    ['.c-banner-info', 'var(--raise)', 'var(--t2)'],
  ])('%s', (selector, background, color) => {
    expect(declarations(selector)).toMatchObject({ background, color });
  });
});

describe('every text colour is readable on every surface, in both looks', () => {
  // WCAG 2's contrast ratio; 4.5:1 is the bar for ordinary text.
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const menu = declarations('.t-dark');
  const TEXT = ['--t1', '--t2', '--t3', '--link', '--good', '--warn', '--bad'];
  const SURFACE = ['--page', '--card', '--raise', '--sheet'];
  const PAIRS = [
    ['--good', '--good-bg'],
    ['--warn', '--warn-bg'],
    ['--bad', '--bad-bg'],
    ['--soft-t', '--soft'],
    ['--on-accent', '--accent'],
    ['--on-sel', '--sel'],
  ];

  it.each(['.t-dark', '.t-light'])('%s', (look) => {
    // `.t-dark` alone is its own rule; the menu's names sit in the rule shared by both.
    const own = {};
    root.walkRules((rule) => {
      if (rule.parent.type === 'root' && rule.selectors.length === 1 && rule.selectors[0] === look) {
        rule.walkDecls((d) => {
          own[d.prop] = d.value;
        });
      }
    });
    const failing = [];
    const check = (fg, bg) => {
      if (ratio(own[fg], own[bg]) < 4.5) failing.push(`${fg} on ${bg}: ${ratio(own[fg], own[bg]).toFixed(2)}`);
    };
    for (const fg of TEXT) for (const bg of SURFACE) check(fg, bg);
    for (const [fg, bg] of PAIRS) check(fg, bg);
    expect(Object.keys(own).length).toBeGreaterThan(30);
    expect(failing).toEqual([]);
    for (const fg of ['--rail-t1', '--rail-t2', '--rail-t3', '--rail-tab']) {
      expect(ratio(menu[fg], menu['--rail-bg'])).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(menu['--rail-on-t'], menu['--rail-on'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('big enough for a thumb (rule 8)', () => {
  it.each(['.c-btn', '.c-icon-btn', '.c-chip'])('%s is at least 44 px tall on a phone', (selector) => {
    expect(declarations(selector, PHONE)['min-height']).toBe('44px');
  });

  it('an icon button is at least 44 px wide on a phone', () => {
    expect(declarations('.c-icon-btn', PHONE)['min-width']).toBe('44px');
  });

  it.each(['.c-nav', '.c-row', '.c-input', '.c-utab'])('%s is 44 px or more everywhere', (selector) => {
    const d = declarations(selector);
    expect(parseInt(d.height ?? d['min-height'], 10)).toBeGreaterThanOrEqual(44);
  });
});
