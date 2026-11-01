import { describe, expect, it } from 'vitest';
import { commentsButton } from './commentsConsoleView.js';

describe('the Comments button on a post in the console', () => {
  it.each([[0, 'Comments'], [1, 'Comments (1)'], [99, 'Comments (99)'], [100, 'Comments (99+)']])('%i comments', (count, label) => {
    expect(commentsButton(count)).toBe(label);
  });
});
