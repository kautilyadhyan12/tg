import { createContext, useContext } from "react";

/** Room every page keeps free at its foot for what stands over the tabs there: a run's own bar while
 *  its screen is put away (37b-i), so the last of a page can still be seen and pressed under it. */
export const BottomRoom = createContext(0);

export const useBottomRoom = (): number => useContext(BottomRoom);
