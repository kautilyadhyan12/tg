// The Import box in the console's look (ROADMAP 5b-v-d-ii; spec Part 3 §17.3): a page names
// a colour and never writes one, so the light look can never put white words on a white
// box. jsdom applies no stylesheet, so this reads the files themselves.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FILES = ['MemberListUpload.jsx', 'MemberListMissing.jsx', 'MemberListImportLeavers.jsx'];
const source = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/** Every way a colour gets written into a page (round one, Low-4): a hex, rgb or hsl value;
 *  a style whose colour is anything but one of console.css's names; Tailwind's own colours. */
const WRITTEN = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /\b(?:rgba?|hsla?)\(/g,
  /\b(?:color|background|backgroundColor|borderColor|outlineColor|fill|stroke)\s*:\s*['"`](?!var\(--)/g,
  /\b(?:text|bg|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|accent|caret|decoration|shadow)-(?:white|black)\b/g,
  /\b(?:text|bg|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|accent|caret|decoration|shadow)-[a-z]+-\d{2,3}\b/g,
];
const writtenColours = (text) => WRITTEN.flatMap((pattern) => text.match(pattern) ?? []);

describe('the guard itself catches each way of writing a colour', () => {
  it.each([
    ["style={{ color: '#fff' }}"],
    ["style={{ background: 'rgba(0,0,0,0.5)' }}"],
    ["style={{ color: 'hsl(20 90% 50%)' }}"],
    ["style={{ color: 'white' }}"],
    ["style={{ borderColor: 'orange' }}"],
    ['className="text-white"'],
    ['className="bg-blue-500"'],
    ['className="border-indigo-300 p-2"'],
    ['className="text-yellow-400"'],
    ['className="ring-rose-600"'],
  ])('%s', (snippet) => {
    expect(writtenColours(snippet)).not.toEqual([]);
  });

  it.each([
    ["style={{ color: 'var(--warn)' }}"],
    ["style={{ background: on ? undefined : 'var(--card)' }}"],
    ['className="c-s14 c-t2 border-t text-center"'],
    ['className="grid-cols-2 sm:grid-cols-4 max-h-[360px]"'],
  ])('lets a named colour through: %s', (snippet) => {
    expect(writtenColours(snippet)).toEqual([]);
  });
});

it.each(FILES)('%s writes no colour of its own', (name) => {
  const text = source(name);
  expect(text.length).toBeGreaterThan(1000);
  expect(writtenColours(text)).toEqual([]);
});

it('the box and its pieces are drawn with the console look', () => {
  const upload = source('MemberListUpload.jsx');
  for (const piece of ['c-sheet', 'c-card', 'c-btn-p', 'c-check', 'c-tag', 'c-input']) expect(upload).toContain(piece);
  expect(source('MemberListMissing.jsx')).toContain('c-check');
});
