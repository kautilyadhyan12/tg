// The coach's voice, one clip at a time (ROADMAP Stage 5 53b-i): a clip asked for while another speaks waits for it to
// end, and a newer one takes the waiting one's place, so lines never talk over each other or pile up. A clip that never
// says it ended frees the voice when its time runs out, and other sound goes back to mixing (round one, L4). `hush`
// drops what waits and stops what speaks: Sound off, Pause, the count taken by hand, the screen closed (L1), the app
// sent to the background (the re-check's B: expo-audio plays again, on return, a player it paused itself). Each clip has
// its turn: a clip still starting up when the voice is hushed, or replaced, never plays, and its failure ends nobody
// else's clip (the re-check's A). Pure but for its timer and the app's state, which a test hands in.

export interface VoiceDeck {
  /** Lowers other sound and plays the clip from its start, unless `current` says, after each wait, that its turn has
   *  passed. */
  play(file: number, current: () => boolean): Promise<void>;
  /** Stops the clip that is speaking. */
  stop(): void;
  /** Other sound back to mixing. */
  rest(): void;
}

/** The longest clip is about 2.5 s: a clip that never said it ended frees the voice after this long, ms. */
export const LONGEST_CLIP_MS = 6000;

export class VoiceQueue<Timer = ReturnType<typeof setTimeout>> {
  private speaking = false;
  private waiting: number | null = null;
  private timer: Timer | null = null;
  /** The turn of the clip that speaks: raised for each clip started and at each hush. */
  private turn = 0;

  constructor(
    private readonly deck: VoiceDeck,
    private readonly wait: (then: () => void, ms: number) => Timer,
    private readonly unwait: (timer: Timer) => void,
    private readonly longest: number = LONGEST_CLIP_MS,
  ) {}

  speak(file: number): void {
    if (this.speaking) this.waiting = file;
    else this.start(file);
  }

  /** The clip that speaks has ended, or its time ran out: the waiting one speaks, or the voice rests. */
  ended(): void {
    this.clear();
    const next = this.waiting;
    this.waiting = null;
    if (next !== null) {
      this.start(next);
      return;
    }
    if (this.speaking) this.deck.rest();
    this.speaking = false;
  }

  hush(): void {
    this.turn += 1;
    this.clear();
    this.waiting = null;
    if (!this.speaking) return;
    this.speaking = false;
    this.deck.stop();
    this.deck.rest();
  }

  private start(file: number): void {
    this.turn += 1;
    const mine = this.turn;
    this.speaking = true;
    this.clear();
    this.timer = this.wait(() => {
      this.timer = null;
      this.ended();
    }, this.longest);
    // A clip that could not play has ended, if it is still the one speaking.
    this.deck
      .play(file, () => mine === this.turn)
      .catch(() => {
        if (mine === this.turn) this.ended();
      });
  }

  /** Hushes the voice whenever the app leaves the foreground (`AppState`'s own words), for as long as it lives. */
  hushWhenAway(watch: (listener: (state: string) => void) => unknown): void {
    watch((state) => {
      if (state !== "active") this.hush();
    });
  }

  private clear(): void {
    if (this.timer !== null) this.unwait(this.timer);
    this.timer = null;
  }
}
