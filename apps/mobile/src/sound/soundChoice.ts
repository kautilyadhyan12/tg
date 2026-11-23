// Sound on or off in a workout (64a-vi), kept for the person on this phone: on until they turn it off. Pure reading.

/** On, unless the file says off: a file that cannot be read never silences a workout. */
export function soundOnIn(text: string | null): boolean {
  if (text === null || text === "") return true;
  try {
    const kept: unknown = JSON.parse(text);
    return !(typeof kept === "object" && kept !== null && "on" in kept && kept.on === false);
  } catch {
    return true;
  }
}

export const soundText = (on: boolean): string => JSON.stringify({ on });
