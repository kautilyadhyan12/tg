// The gym page's panel in the console (ROADMAP 20c-iv-a): what staff typed, whether it
// changed, and the request that saves it. Everything in the panel waits for Save.
import { GYM_FACILITIES, GYM_FACILITY_WORDS, GYM_PAGE_MAX_OWN_FACILITIES, GYM_PAGE_MAX_OWN_FACILITY_CHARS, typedFacility } from '@app/shared';

export const FACILITY_CHOICES = GYM_FACILITIES.map((key) => ({ key, label: GYM_FACILITY_WORDS[key] }));

export function pageDraft(page) {
  return {
    shown: page?.shown === true,
    about: page?.about ?? '',
    facilities: [...(page?.facilities ?? [])],
    ownFacilities: [...(page?.ownFacilities ?? [])],
  };
}

/** The facilities in the list's own order, so a draft ticked in any order compares equal. */
const inOrder = (facilities) => GYM_FACILITIES.filter((key) => facilities.includes(key));

export function toggleFacility(draft, key) {
  const has = draft.facilities.includes(key);
  return { ...draft, facilities: inOrder(has ? draft.facilities.filter((f) => f !== key) : [...draft.facilities, key]) };
}

/** "Add a facility": the list's own tick when the words are the list's, else one of the
 *  gym's own, never twice. `{ draft, problem }`; `problem` is what to say instead. */
export function addFacility(draft, typed) {
  const read = typedFacility(typed);
  if (read === null) return { draft, problem: null };
  if (read.kind === 'listed') {
    const facilities = draft.facilities.includes(read.facility) ? draft.facilities : inOrder([...draft.facilities, read.facility]);
    return { draft: { ...draft, facilities }, problem: null };
  }
  if (draft.ownFacilities.some((name) => name.toLowerCase() === read.name.toLowerCase())) return { draft, problem: null };
  if (read.name.length > GYM_PAGE_MAX_OWN_FACILITY_CHARS) {
    return { draft, problem: `Keep it to ${GYM_PAGE_MAX_OWN_FACILITY_CHARS} characters.` };
  }
  if (draft.ownFacilities.length >= GYM_PAGE_MAX_OWN_FACILITIES) {
    return { draft, problem: `You can add up to ${GYM_PAGE_MAX_OWN_FACILITIES} of your own. Untick one to add another.` };
  }
  return { draft: { ...draft, ownFacilities: [...draft.ownFacilities, read.name] }, problem: null };
}

export function removeOwnFacility(draft, name) {
  return { ...draft, ownFacilities: draft.ownFacilities.filter((own) => own !== name) };
}

export function pageRequest(draft) {
  return {
    shown: draft.shown,
    about: draft.about.trim(),
    facilities: inOrder(draft.facilities),
    ownFacilities: [...draft.ownFacilities],
  };
}

export function pageChanged(draft, page) {
  return JSON.stringify(pageRequest(draft)) !== JSON.stringify(pageRequest(pageDraft(page)));
}
