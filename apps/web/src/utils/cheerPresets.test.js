// The four lines a gym can send, proved without a browser.
//
// **THIS FILE EXISTS FOR ONE RULE THAT LIVES NOWHERE ELSE**: no preset may ever
// contain a number. The shared contract states it in a docblock and
// `cheerPresets.js` restates it — and a comment that states a guarantee is not
// the guarantee (:19960). The assertion below is the guarantee.
import { describe, expect, it } from 'vitest';
import { GYM_CHEER_PRESETS } from '@app/shared';
import { CHEER_CHOICES, cheerLine } from './cheerPresets';

describe('the words a cheer carries', () => {
  // **THE RULE, AND IT IS :7298's CLASS: A STORED SENTENCE OUTLIVES THE
  // CONDITION THAT RAISED IT.** A line reading "4 weeks!" is true the minute it
  // is sent and false the week after, because the cheer is kept and read later
  // — possibly much later, since nothing pushes it. The streak figure is drawn
  // LIVE beside the member's name on the owner's screen and is never baked into
  // the message.
  it('never puts a number in a line, because the line is stored and the number moves', () => {
    for (const choice of CHEER_CHOICES) {
      expect(choice.text, `preset ${choice.preset}`).not.toMatch(/\d/);
    }
  });

  // A POSITIVE CONTROL FOR THE CASE ABOVE. An empty `CHEER_CHOICES` would
  // satisfy "no line contains a digit" perfectly — :28976's vacuity class, where
  // an absence assertion passes because the thing it is about is not there.
  it('has a line for every preset the server can store, and no extras', () => {
    expect(CHEER_CHOICES.length).toBe(GYM_CHEER_PRESETS.length);
    expect(CHEER_CHOICES.map((c) => c.preset)).toEqual([...GYM_CHEER_PRESETS]);
    for (const choice of CHEER_CHOICES) {
      expect(choice.text.length).toBeGreaterThan(0);
      expect(choice.emoji.length).toBeGreaterThan(0);
    }
  });

  it('gives the words for a preset it knows', () => {
    expect(cheerLine('keep_going')).toEqual({
      preset: 'keep_going',
      emoji: '💪',
      text: 'Great week — keep it going.',
    });
  });

  // NULL AND NOT A PLACEHOLDER. The member's card draws nothing at all for a
  // preset this bundle has no words for; an invented line would put words in a
  // gym's mouth.
  it('says nothing at all about a preset it does not know', () => {
    expect(cheerLine('brand_new_thing')).toBeNull();
    expect(cheerLine(null)).toBeNull();
    expect(cheerLine(undefined)).toBeNull();
    expect(cheerLine(42)).toBeNull();
  });

  // THE LOOKUP IS KEYED BY A STRING OFF THE WIRE, so the prototype is reachable
  // by anything that can choose that string. `LINES['constructor']` is a
  // function, and a "line" spread out of one would draw a row with no words in
  // it rather than nothing at all.
  it('does not answer with something off the prototype', () => {
    expect(cheerLine('constructor')).toBeNull();
    expect(cheerLine('toString')).toBeNull();
    expect(cheerLine('__proto__')).toBeNull();
  });
});
