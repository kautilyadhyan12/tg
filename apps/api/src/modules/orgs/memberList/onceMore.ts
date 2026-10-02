// Removing people closes the memberships the rule chose under the gym's lock. Account
// deletion takes no gym lock, so a member deleting their account at that instant closes
// their own membership first and the press closes one fewer than it chose. The press then
// throws this, rolling back everything it wrote, and runs once more: the second run reads
// the list as it now is and answers as any press does (the box again, or the removal).
export class ChosenPeopleMovedError extends Error {}

export async function onceMoreIfMoved<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ChosenPeopleMovedError) return await run();
    throw error;
  }
}
