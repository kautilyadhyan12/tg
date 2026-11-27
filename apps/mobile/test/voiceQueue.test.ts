import { describe, expect, it } from "vitest";
import { LONGEST_CLIP_MS, VoiceQueue, type VoiceDeck } from "../src/sound/voiceQueue";

// The coach's voice, one clip at a time (53b-i, round one): the queue the phone's player speaks through, with a deck
// and a timer handed in.

function rig(fails: readonly number[] = []) {
  const log: string[] = [];
  const timers: { then: () => void; ms: number; live: boolean }[] = [];
  const deck: VoiceDeck = {
    play: (file) => {
      log.push(`play ${String(file)}`);
      return fails.includes(file) ? Promise.reject(new Error("no")) : Promise.resolve();
    },
    stop: () => log.push("stop"),
    rest: () => log.push("rest"),
  };
  const queue = new VoiceQueue<number>(
    deck,
    (then, ms) => timers.push({ then, ms, live: true }) - 1,
    (t) => {
      const timer = timers[t];
      if (timer !== undefined) timer.live = false;
    },
  );
  /** The newest timer still waiting runs out. */
  const runOut = () => {
    const timer = [...timers].reverse().find((t) => t.live);
    if (timer === undefined) throw new Error("no timer waits");
    timer.live = false;
    timer.then();
  };
  return { queue, log, timers, runOut };
}

describe("one clip at a time", () => {
  it("a clip speaks at once; when it ends the voice rests", () => {
    const { queue, log } = rig();
    queue.speak(1);
    queue.ended();
    expect(log).toEqual(["play 1", "rest"]);
  });

  it("a clip asked for while another speaks waits for its end, and the newest takes the waiting one's place", () => {
    const { queue, log } = rig();
    queue.speak(1);
    queue.speak(2);
    queue.speak(3);
    expect(log).toEqual(["play 1"]);
    queue.ended();
    expect(log).toEqual(["play 1", "play 3"]);
    queue.ended();
    expect(log).toEqual(["play 1", "play 3", "rest"]);
  });

  it("a clip that never says it ended frees the voice when its time runs out, and other sound mixes again", () => {
    const { queue, log, timers, runOut } = rig();
    queue.speak(1);
    expect(timers.map((t) => t.ms)).toEqual([LONGEST_CLIP_MS]);
    runOut();
    expect(log).toEqual(["play 1", "rest"]);
    queue.speak(2);
    expect(log).toEqual(["play 1", "rest", "play 2"]);
  });

  it("a clip that ended in time leaves no timer to cut the next one short", () => {
    const { queue, timers } = rig();
    queue.speak(1);
    queue.ended();
    expect(timers.filter((t) => t.live)).toEqual([]);
  });

  it("hush drops what waits and stops what speaks; an end that comes after it starts nothing", () => {
    const { queue, log, timers } = rig();
    queue.speak(1);
    queue.speak(2);
    queue.hush();
    expect(log).toEqual(["play 1", "stop", "rest"]);
    expect(timers.filter((t) => t.live)).toEqual([]);
    queue.ended();
    expect(log).toEqual(["play 1", "stop", "rest"]);
    queue.speak(3);
    expect(log[log.length - 1]).toBe("play 3");
  });

  it("hush with nothing speaking does nothing", () => {
    const { queue, log } = rig();
    queue.hush();
    expect(log).toEqual([]);
  });

  it("a clip that could not play has ended: the waiting one speaks", async () => {
    const { queue, log } = rig([1]);
    queue.speak(1);
    queue.speak(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["play 1", "play 2"]);
  });
});
