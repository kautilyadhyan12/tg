import { createContext, useCallback, useContext } from "react";

// The look before setup (14d): what the tabs need to know while setup is still to come.

/** While the person is looking, what opens setup at once. Null otherwise. */
export const LookContext = createContext<(() => void) | null>(null);

/** The tabs are drawn while setup is still to come (the look, or setup over them). */
export const SetupComingContext = createContext(false);

/** What asks the person something of its own, the notifications box, waits for setup, as before 14d. */
export const useSetupComing = (): boolean => useContext(SetupComingContext);

/** While the person is looking, what opens setup at once instead of a run, a meal or a plan; null otherwise. */
export const useLookOpen = (): (() => void) | null => useContext(LookContext);

/** Round what starts a run, logs a meal or makes a plan: while the person is looking, setup opens
 *  instead, so the health question and the age come first; otherwise it goes ahead. */
export function useSetupFirst(): <A extends unknown[]>(then: (...args: A) => unknown) => (...args: A) => void {
  const openSetup = useContext(LookContext);
  return useCallback(
    <A extends unknown[]>(then: (...args: A) => unknown) =>
      (...args: A) => {
        if (openSetup !== null) {
          openSetup();
          return;
        }
        void then(...args);
      },
    [openSetup],
  );
}
