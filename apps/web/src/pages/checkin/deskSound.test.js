// The desk's sounds as the browser is asked to play them (ROADMAP 16f). The rule that
// picks the sound is deskView's; this is the last link: the notes actually started.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESK_SOUNDS } from './deskView';

/** A browser's audio, recording every note started on it. */
function fakeAudio(state = 'running') {
  const started = [];
  class FakeAudioContext {
    constructor() {
      this.state = state;
      this.currentTime = 10;
      this.destination = {};
      FakeAudioContext.made += 1;
    }
    resume() {
      FakeAudioContext.resumed += 1;
      return Promise.resolve();
    }
    createOscillator() {
      const tone = {
        type: 'sine',
        frequency: { value: 0 },
        connect() {},
        disconnect() {},
        start: (at) => started.push({ wave: tone.type, hz: tone.frequency.value, at: Math.round((at - 10) * 1000) }),
        stop() {},
      };
      return tone;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  }
  FakeAudioContext.made = 0;
  FakeAudioContext.resumed = 0;
  return { FakeAudioContext, started };
}

const asNotes = (kind) => DESK_SOUNDS[kind].map((note) => ({ wave: note.wave, hz: note.hz, at: note.at }));

describe('the notes the browser is asked to play', () => {
  let audio;
  let sound;

  const load = async (state) => {
    audio = fakeAudio(state);
    vi.stubGlobal('window', { AudioContext: audio.FakeAudioContext });
    vi.resetModules();
    sound = await import('./deskSound');
  };

  beforeEach(() => load('running'));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['in', 'in_warn', 'out', 'on'])('"%s" starts its own notes, each wave and pitch, and no others', (kind) => {
    sound.playDeskSound(kind);
    expect(audio.started).toEqual(asNotes(kind));
  });

  it('"out" never starts a note of "let in", and "let in" never the buzz', () => {
    sound.playDeskSound('out');
    expect(audio.started.map((note) => note.hz)).toEqual([196]);
    audio.started.length = 0;
    sound.playDeskSound('in');
    expect(audio.started.map((note) => note.hz)).toEqual([880, 1320]);
  });

  it.each([undefined, null, 'IN', 'checked_in', 'toString'])('an unknown kind (%j) plays nothing', (kind) => {
    sound.playDeskSound(kind);
    expect(audio.started).toEqual([]);
  });

  it('one audio for the page, however many sounds', () => {
    sound.playDeskSound('in');
    sound.playDeskSound('out');
    sound.wakeDeskSound();
    expect(audio.FakeAudioContext.made).toBe(1);
  });

  it('audio the browser is holding plays nothing now, so nothing sounds later for somebody else; it is asked to wake', async () => {
    await load('suspended');
    sound.playDeskSound('in');
    expect(audio.started).toEqual([]);
    expect(audio.FakeAudioContext.resumed).toBe(1);
  });

  it('a browser with no audio at all does not break the page', async () => {
    vi.stubGlobal('window', {});
    vi.resetModules();
    const quiet = await import('./deskSound');
    expect(() => quiet.playDeskSound('in')).not.toThrow();
    expect(() => quiet.wakeDeskSound()).not.toThrow();
  });
});
