import { describe, expect, it } from 'vitest';
import { railScroller, scrollToShow } from './railScroll';

const rect = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) });

describe('the lit page is on screen in the menu', () => {
  it('a line under the bottom of the list (Settings, opened from Overview at 1366×768): the list scrolls down to it', () => {
    const box = { ...rect(90, 593), scrollTop: 0 };
    scrollToShow(box, rect(1073, 1117));
    expect(box.scrollTop).toBe(1117 - 593 + 8);
  });

  it('a line above the top: the list scrolls up to it', () => {
    const box = { ...rect(90, 593), scrollTop: 524 };
    scrollToShow(box, rect(40, 84));
    expect(box.scrollTop).toBe(524 - (90 - 40 + 8));
  });

  it('a line already in view (pressed in the menu itself): the list keeps its place', () => {
    const box = { ...rect(90, 593), scrollTop: 524 };
    scrollToShow(box, rect(300, 344));
    expect(box.scrollTop).toBe(524);
  });

  it('no lit line (Your organisations): nothing moves', () => {
    const box = { ...rect(90, 593), scrollTop: 10 };
    scrollToShow(box, null);
    expect(box.scrollTop).toBe(10);
  });

  it('the list scrolls when it is taller than its window, the whole menu otherwise', () => {
    const rail = { scrollHeight: 900, clientHeight: 500 };
    expect(railScroller(rail, { scrollHeight: 1117, clientHeight: 503 })).not.toBe(rail);
    expect(railScroller(rail, { scrollHeight: 1117, clientHeight: 1117 })).toBe(rail);
  });
});
