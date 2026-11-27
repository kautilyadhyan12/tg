import { File, Paths } from "expo-file-system";
import { isForgotten } from "../session/personFiles";
import type { Sex } from "./figure";
import { myWorkoutFileName, type ListFile } from "./myWorkout";
import type { LibraryFile } from "./store";
import type { TextStore } from "../screens/food/outbox";

/** The kept Library: one file for each person on this phone, since the server gives each person their own channel's
 *  copy (beta or live), and it names them, so deleting the account removes it (`forgetPersonFiles`). Written to a
 *  second file and moved over the first, so a phone that dies between the two still reads a whole copy. */
export function libraryFile(userId: string): LibraryFile {
  const name = `library-${userId}.json`;
  return {
    read: async () => {
      const file = new File(Paths.document, name);
      if (file.exists) return await file.text();
      const next = new File(Paths.document, `${name}.next`);
      return next.exists ? await next.text() : null;
    },
    write: async (text) => {
      if (isForgotten(userId)) return;
      const next = new File(Paths.document, `${name}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(Paths.document, name), { overwrite: true });
    },
  };
}

/** The figure a person's setup answer chose (male or female), as the server last said it: kept on the phone so
 *  the Library shows their own figure with no internet. It names them, so deleting the account removes it
 *  (`forgetPersonFiles`); it is never written for an account already deleted. */
export const figureFile = {
  read: async (userId: string): Promise<Sex | null> => {
    try {
      const file = new File(Paths.document, `figure-${userId}.txt`);
      if (!file.exists) return null;
      const text = (await file.text()).trim();
      return text === "male" || text === "female" ? text : null;
    } catch {
      return null;
    }
  },
  write: (userId: string, sex: Sex): void => {
    if (isForgotten(userId)) return;
    try {
      const file = new File(Paths.document, `figure-${userId}.txt`);
      if (file.exists) file.delete();
      file.create();
      file.write(sex);
    } catch {
      // Not kept: the next open asks the server again.
    }
  },
};

/** A person's My Workout (63c), in a file that names them, so deleting the account removes it (`forgetPersonFiles`);
 *  never written for an account already deleted. Written to a second file and moved over the first, as the Library. */
export function myWorkoutFile(userId: string): ListFile {
  const name = myWorkoutFileName(userId);
  return {
    read: async () => {
      const file = new File(Paths.document, name);
      if (file.exists) return await file.text();
      const next = new File(Paths.document, `${name}.next`);
      return next.exists ? await next.text() : null;
    },
    write: async (text) => {
      if (isForgotten(userId)) return;
      const next = new File(Paths.document, `${name}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(Paths.document, name), { overwrite: true });
    },
  };
}

/** A file of a person's own in the app's documents folder, written to a second file and moved over the first, so a
 *  phone that dies between the two still reads a whole copy; never written for an account already deleted, and
 *  removed with the account (`forgetPersonFiles`), as its name names them. */
function personFile(userId: string, name: string): TextStore {
  if (userId === "") throw new Error("kept only for somebody signed in");
  return {
    read: async () => {
      const file = new File(Paths.document, name);
      if (file.exists) return await file.text();
      const next = new File(Paths.document, `${name}.next`);
      return next.exists ? await next.text() : null;
    },
    write: async (text) => {
      if (isForgotten(userId)) return;
      const next = new File(Paths.document, `${name}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(Paths.document, name), { overwrite: true });
    },
  };
}

/** The workout a person is doing (64a-ii), written at every step. */
export const workoutRunFile = (userId: string): TextStore => personFile(userId, `workout-now-${userId}.json`);

/** A person's finished workouts not yet on the server (64a-ii). */
export const workoutsWaitingFile = (userId: string): TextStore => personFile(userId, `workouts-${userId}.json`);

/** The effort stars a person gave their workouts, not yet on the server (64a-iii). */
export const effortWaitingFile = (userId: string): TextStore => personFile(userId, `workout-effort-${userId}.json`);

/** The phone's copy of a person's saved workouts (64a-iv), so the list opens with no internet. */
export const savedCopyFile = (userId: string): TextStore => personFile(userId, `saved-workouts-${userId}.json`);

/** A person's saves and deletes of saved workouts not yet on the server (64a-iv). */
export const savedWaitingFile = (userId: string): TextStore => personFile(userId, `saved-changes-${userId}.json`);

/** Whether a person's workouts play their sounds (64a-vi), `{"on":false}` once they turn them off; removed with the
 *  account (`forgetPersonFiles`), as its name names them. */
export const workoutSoundsFile = (userId: string): TextStore => personFile(userId, `workout-sounds-${userId}.json`);

/** Whether the person has been told what the camera keeps private (53a, spec Part 2 §11.8 step 7), `{"told":true}` once
 *  they have: told on the screen before the phone first asks for the camera, and never again. */
export const cameraToldFile = (userId: string): TextStore => personFile(userId, `camera-told-${userId}.json`);
