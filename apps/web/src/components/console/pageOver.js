// A page drawn over the page it was opened from (spec Part 3 §17.11, a member's page, V2a): it
// takes the page's place under the bar across the top, beside the menu, while the page under it
// stays as it was, hidden, and comes back as it was when this one closes. The console's shell
// gives the place (`slot`) and the name of the page it is opened from (`label`, for "← Members &
// staff"); outside the shell there is none, and the page draws over the whole window instead.
import { createContext, useContext } from 'react';

export const PageOverContext = createContext(null);

export const usePageOver = () => useContext(PageOverContext);

/** The menu's name for the page at `pathname`: the line whose address it is, or starts with. */
export function pageLabelFor(pages, pathname) {
  let best = null;
  for (const page of pages) {
    const to = typeof page.to === 'string' ? page.to.split(/[?#]/)[0] : '';
    if (to === '') continue;
    const fits = pathname === to || (page.end !== true && pathname.startsWith(`${to}/`));
    if (fits && (best === null || to.length > best.to.length)) best = { to, label: page.label };
  }
  return best === null ? null : best.label;
}
