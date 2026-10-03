import { DESK_SOUNDS } from './deskView';

// THE DESK'S SOUNDS (ROADMAP 16f), made by the browser itself: no sound files. One audio
// context for the page; a browser lets it sound only after somebody has touched the page
// or a key was pressed, and a scanner's typing counts.

let context = null;

function audio() {
  const Maker = window.AudioContext ?? window.webkitAudioContext;
  if (Maker === undefined) return null;
  if (context === null || context.state === 'closed') context = new Maker();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

/** Called on the page's first touch or key, so the first answer already has its sound. */
export function wakeDeskSound() {
  try {
    audio();
  } catch {
    // No sound on this browser: the screen still answers.
  }
}

export function playDeskSound(kind) {
  const notes = DESK_SOUNDS[kind];
  if (notes === undefined) return;
  try {
    const ctx = audio();
    if (ctx === null) return;
    for (const note of notes) {
      const from = ctx.currentTime + note.at / 1000;
      const to = from + note.ms / 1000;
      const tone = ctx.createOscillator();
      const loudness = ctx.createGain();
      tone.type = note.wave;
      tone.frequency.value = note.hz;
      // A square wave is far louder to the ear than a sine at the same level.
      const peak = note.wave === 'square' ? 0.12 : 0.35;
      loudness.gain.setValueAtTime(0.0001, from);
      loudness.gain.exponentialRampToValueAtTime(peak, from + 0.01);
      loudness.gain.setValueAtTime(peak, to - 0.03);
      loudness.gain.exponentialRampToValueAtTime(0.0001, to);
      tone.connect(loudness);
      loudness.connect(ctx.destination);
      tone.start(from);
      tone.stop(to);
      tone.onended = () => {
        tone.disconnect();
        loudness.disconnect();
      };
    }
  } catch {
    // No sound on this browser: the screen still answers.
  }
}
