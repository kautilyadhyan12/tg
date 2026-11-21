import * as Crypto from "expo-crypto";

/** A workout's own id, from the phone's proper random source (spec Part 2 §13.6: never `Math.random`): the server
 *  keeps one workout for it however often it is sent. */
export const newWorkoutId = (): string => Crypto.randomUUID();
