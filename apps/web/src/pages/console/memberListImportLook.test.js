// The Import box in the console's look (ROADMAP 5b-v-d-ii; spec Part 3 §17.3): a page names
// a colour and never writes one, so the light look can never put white words on a white
// box. jsdom applies no stylesheet, so this reads the files themselves.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const FILES = ['MemberListUpload.jsx', 'MemberListMissing.jsx', 'MemberListImportLeavers.jsx'];
const source = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

it.each(FILES)('%s writes no colour of its own', (name) => {
  const text = source(name);
  expect(text.length).toBeGreaterThan(1000);
  expect(text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  expect(text.match(/\brgba?\(/g) ?? []).toEqual([]);
  // Tailwind's own colours (text-white, bg-gray-900…) are written colours too.
  expect(text.match(/\b(?:text|bg|border|ring)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|green|emerald)\b/g) ?? []).toEqual([]);
});

it('the box and its pieces are drawn with the console look', () => {
  const upload = source('MemberListUpload.jsx');
  for (const piece of ['c-sheet', 'c-card', 'c-btn-p', 'c-check', 'c-tag', 'c-input']) expect(upload).toContain(piece);
  expect(source('MemberListMissing.jsx')).toContain('c-check');
});
