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
  // WCAG 2's contrast ratio. Every word is 7:1 or more on what it sits on (WCAG's AAA bar), so
  // nobody leans in to read it (Kd, 2026-11-19, V1-f's click-through); a disabled control's
  // words, which nobody needs to read to act, keep the ordinary 4.5:1.
  const BAR = 7;
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const TEXT = ['--t1', '--t2', '--t3', '--link', '--good', '--warn', '--bad', '--info'];
  const SURFACE = ['--page', '--card', '--raise', '--sheet'];
  const PAIRS = [
    ['--good', '--good-bg'],
    ['--warn', '--warn-bg'],
    ['--bad', '--bad-bg'],
    ['--soft-t', '--soft'],
    ['--on-accent', '--accent'],
    ['--on-sel', '--sel'],
    ['--info', '--info-bg'],
    ['--on-bad', '--bad'],
    ['--dis-t', '--dis-bg'],
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
      if (ratio(own[fg], own[bg]) < (fg === '--dis-t' ? 4.5 : BAR)) failing.push(`${fg} on ${bg}: ${ratio(own[fg], own[bg]).toFixed(2)}`);
    };
    for (const fg of TEXT) for (const bg of SURFACE) check(fg, bg);
    for (const [fg, bg] of PAIRS) check(fg, bg);
    expect(Object.keys(own).length).toBeGreaterThan(30);
    expect(failing).toEqual([]);
    // The menu takes the look too (spec §17.11: light in the light look).
    for (const fg of ['--rail-t1', '--rail-t2', '--rail-t3', '--rail-tab']) {
      expect(ratio(own[fg], own['--rail-bg']), fg).toBeGreaterThanOrEqual(BAR);
      expect(ratio(own[fg], own['--rail-hover']), `${fg} on hover`).toBeGreaterThanOrEqual(BAR);
    }
    expect(ratio(own['--rail-on-t'], own['--rail-on'])).toBeGreaterThanOrEqual(BAR);
    expect(ratio(own['--rail-on-gym'], own['--rail-gym'])).toBeGreaterThanOrEqual(BAR);
    // A field's edge is a thing to see, not words: 3 to 1 on the page and in a box.
    expect(ratio(own['--input-line'], own['--page'])).toBeGreaterThanOrEqual(3);
    expect(ratio(own['--input-line'], own['--card'])).toBeGreaterThanOrEqual(3);
  });

  it('the light look has a light menu, the dark look a dark one', () => {
    const railOf = (look) => {
      let found = null;
      root.walkRules((rule) => {
        if (rule.parent.type === 'root' && rule.selectors.length === 1 && rule.selectors[0] === look) {
          rule.walkDecls('--rail-bg', (d) => {
            found = d.value;
          });
        }
      });
      return found;
    };
    expect(luminance(railOf('.t-light'))).toBeGreaterThan(0.9);
    expect(luminance(railOf('.t-dark'))).toBeLessThan(0.01);
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

describe('the Review needed dot (5b-v-d-iv)', () => {
  it("is drawn in the looks' named amber, the menu's own on the menu, and keeps still", () => {
    expect(declarations('.c-glow-dot').color).toBe('var(--warn)');
    expect(declarations('.c-glow-dot').background).toBe('currentColor');
    expect(declarations('.c-rail .c-glow-dot').color).toBe('var(--rail-warn)');
    expect(declarations('.c-tabbar .c-glow-dot').color).toBe('var(--rail-warn)');
    expect(declarations('.c-glow-dot').animation).toBeUndefined();
  });
});

describe("the second look's building blocks (V1-b)", () => {
  // The worst thing: a red button that takes something away looking like an everyday one.
  it('a red button is red and outlined, unlike the outlined everyday one; solid red only in the question', () => {
    const everyday = declarations('.c-btn-s');
    const red = declarations('.c-btn-d');
    expect(red.color).toBe('var(--bad)');
    expect(red['border-color']).toBe('var(--bad-line)');
    expect(red['border-color']).not.toBe(everyday['border-color']);
    expect(declarations('.c-btn-ds')).toMatchObject({ background: 'var(--bad)', color: 'var(--on-bad)' });
  });

  it('a button not ready yet is grey, not faded', () => {
    const d = declarations('.c-btn:disabled');
    expect(d).toMatchObject({ background: 'var(--dis-bg)', color: 'var(--dis-t)' });
    expect(d.opacity).toBeUndefined();
  });

  it("the text sizes are the third look's: title 28 and the figure 32 on every screen, a box's title 17, the label 12 (Kd, 2026-11-19: nothing smaller)", () => {
    expect(declarations('.c-h1')['font-size']).toBe('28px');
    expect(declarations('.c-h1', COMPUTER)['font-size']).toBeUndefined();
    expect(declarations('.c-big')['font-size']).toBe('32px');
    expect(declarations('.c-big', COMPUTER)['font-size']).toBeUndefined();
    expect(declarations('.c-h2')['font-size']).toBe('17px');
    expect(declarations('.c-eyebrow')).toMatchObject({ 'font-size': '12px', 'text-transform': 'uppercase', color: 'var(--link)' });
    expect(declarations('.c-field').gap).toBe('8px');
  });

  it('on a phone the panel fills the screen and the other boxes rise from the bottom', () => {
    expect(declarations('.c-panel').width).toBe('100%');
    for (const box of ['.c-pop', '.c-ask']) {
      expect(declarations(box)).toMatchObject({ position: 'fixed', left: '0', right: '0', bottom: '0' });
    }
  });

  it('every box fits the window, however short, and scrolls inside itself', () => {
    for (const box of ['.c-pop', '.c-ask', '.c-panel']) {
      expect(declarations(box)['overflow-y']).toBe('auto');
    }
    expect(declarations('.c-pop')['max-height']).toBe('calc(100dvh - 48px)');
    expect(declarations('.c-ask', COMPUTER)['max-height']).toBe('calc(100dvh - 32px)');
    expect(declarations('.c-ask', COMPUTER).width).toBe('min(520px, calc(100vw - 32px))');
    expect(declarations('.c-pop', COMPUTER).width).toBe('min(380px, calc(100vw - 32px))');
    expect(declarations('.c-panel', COMPUTER).width).toBe('min(600px, 100%)');
  });

  it("the panel's Save stays at its foot, above a phone's home bar", () => {
    expect(declarations('.c-panel-f')).toMatchObject({ position: 'sticky', bottom: '0' });
    expect(declarations('.c-panel-f')['padding-bottom']).toMatch(/safe-area-inset-bottom/);
  });

  it('the side list scrolls on its own row on a narrow screen, never the page, and is thumb-sized', () => {
    expect(declarations('.c-snav')['overflow-x']).toBe('auto');
    expect(declarations('.c-snav a')['min-height']).toBe('44px');
    expect(declarations('.c-snav a', '(pointer: coarse)')['min-height']).toBe('44px');
  });
});

// The third look (V1-c; spec Part 3 §17.11): one family with the member app, flat colour.
describe('the third look', () => {
  const MOUSE = '(hover: hover) and (pointer: fine)';

  it('is flat: no gradient, no glow, no moving light anywhere in the console', () => {
    const found = [];
    root.walkDecls((d) => {
      if (/gradient|drop-shadow/.test(d.value) || d.prop === 'animation' || d.prop === 'filter') found.push(`${d.prop}: ${d.value}`);
    });
    root.walkAtRules('keyframes', (at) => found.push(`@keyframes ${at.params}`));
    expect(found).toEqual([]);
  });

  it('is drawn in Inter', () => {
    expect(declarations('.c-console')['font-family']).toMatch(/^'Inter'/);
  });

  it('every button has round ends, the small ones too', () => {
    expect(declarations('.c-btn')['border-radius']).toBe('999px');
    for (const size of ['.c-btn-sm', '.c-btn-xs', '.c-btn-lg']) expect(declarations(size)['border-radius'], size).toBeUndefined();
    expect(declarations('.c-icon-btn')['border-radius']).toBe('999px');
  });

  it('a menu line is 36 px with a mouse and 44 on touch or when the screen cannot tell', () => {
    expect(declarations('.c-nav').height).toBe('44px');
    expect(declarations('.c-nav', MOUSE).height).toBe('36px');
    expect(declarations('.c-rail-grp-btn')['min-height']).toBe('44px');
    expect(declarations('.c-rail-grp-btn', MOUSE)['min-height']).toBe('32px');
    expect(declarations('.c-utab').height).toBe('44px');
    expect(declarations('.c-utab', MOUSE).height).toBe('34px');
    expect(declarations('.c-menu-row')['min-height']).toBe('44px');
    expect(declarations('.c-rail-me')['min-height']).toBe('52px');
  });

  it('a folded group hides its pages, and only its pages', () => {
    expect(declarations('.c-rail-list[hidden]').display).toBe('none');
    expect(declarations('.c-rail-group[hidden]').display).toBeUndefined();
  });

  it('the bar across the top shows from 768 px only: a phone has its own top bar', () => {
    expect(declarations('.c-pagebar').display).toBe('none');
    expect(declarations('.c-pagebar', COMPUTER).display).toBe('flex');
  });
});

describe('read without leaning in (Kd, 2026-11-19, V1-f): no words under 14 px', () => {
  // Only these are smaller, never under 12 px: a label in small capitals, the number in a count or
  // a tag's word, initials, the names under the phone's tab icons, and Ctrl K. `.c-s12` and
  // `.c-s13` stay for pages not yet redesigned (V2a to V11 each move theirs to 14), and the
  // Leaderboard's day letters until V9b.
  const SMALLER = {
    '.c-rail-grp': 12, // the menu's group names, small capitals
    '.c-more-grp': 12,
    '.c-eyebrow': 12,
    '.c-th': 12,
    '.c-snav-t': 12,
    '.c-count': 12,
    '.c-bell-pip': 12,
    '.c-part-n': 12,
    '.c-tag': 12,
    '.c-setup-tag': 12,
    '.c-rail-av': 12,
    '.c-find-av': 12,
    '.c-tab': 11, // five tab names on a folding phone's 280 px cover
    '.c-findbar-keys': 12,
    '.c-s12': 12,
    '.c-s13': 13,
    '.c-flame-head': 10,
  };
  it('every font size in the stylesheet is 14 px or more, but the named few', () => {
    const under = [];
    root.walkDecls('font-size', (d) => {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(d.value);
      if (px === null || Number(px[1]) >= 14) return;
      const allowed = d.parent.selectors.every((s) => Object.hasOwn(SMALLER, s) && Number(px[1]) >= SMALLER[s]);
      if (!allowed) under.push(`${d.parent.selector}: ${d.value}`);
    });
    expect(under).toEqual([]);
  });

  // The pages already in the third look use no size under 14 for words. Each redesign job adds its
  // own files here.
  const REDESIGNED = [
    '../../pages/console/PaymentsOverview.jsx',
    './ConsoleLayout.jsx',
    './ConsoleSearch.jsx',
    '../../pages/console/More.jsx',
    './MenuCount.jsx',
    './SetupTag.jsx',
    // V2a-i: a member's page, and the boxes of its first and third columns.
    '../../pages/console/MemberListPerson.jsx',
    '../../pages/console/MemberNotes.jsx',
    '../../pages/console/DeskWaiver.jsx',
    '../../pages/console/MemberPurchases.jsx',
    '../../pages/console/MemberPayer.jsx',
    '../../pages/console/MemberCard.jsx',
    '../../pages/console/MealPlanGiving.jsx',
  ];
  it.each(REDESIGNED)('%s has no 12 or 13 px words', (file) => {
    const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    expect(text.match(/\bc-s1[23]\b|fontSize: '?1[0-3](px)?'?\b/g) ?? []).toEqual([]);
  });
});
