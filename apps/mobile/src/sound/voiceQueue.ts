// The coach's voice, one clip at a time (ROADMAP Stage 5 53b-i): a clip asked for while another speaks waits for it to
// end, and a newer one takes the waiting one's place, so lines never talk over each other or pile up. A clip that never
// says it ended frees the voice when its time runs out, and other sound goes back to mixing (round one, L4). `hush`
// drops what waits and stops what speaks: Sound off, Pause, the count taken by hand, the screen closed (L1). Pure but
// for its timer, which a test hands in.

export interface VoiceDeck {
  /** Lowers other sound and plays the clip from its start. */
  play(file: number): Promise<void>;
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
    this.clear();
    this.waiting = null;
    if (!this.speaking) return;
    this.speaking = false;
    this.deck.stop();
    this.deck.rest();
  }

  private start(file: number): void {
    this.speaking = true;
    this.clear();
    this.timer = this.wait(() => {
      this.timer = null;
      this.ended();
    }, this.longest);
    // A clip that could not play has ended.
    this.deck.play(file).catch(() => {
      this.ended();
    });
  }

  private clear(): void {
    if (this.timer !== null) this.unwait(this.timer);
    this.timer = null;
  }
}
