// The gym page's panel in the console (ROADMAP 20c-iv-a): what staff typed, whether it
// changed, and the request that saves it. Everything in the panel waits for Save.
import { GYM_FACILITIES, GYM_FACILITY_WORDS } from '@app/shared';

export const FACILITY_CHOICES = GYM_FACILITIES.map((key) => ({ key, label: GYM_FACILITY_WORDS[key] }));

export function pageDraft(page) {
  return {
    shown: page?.shown === true,
    about: page?.about ?? '',
    facilities: [...(page?.facilities ?? [])],
    otherFacilities: page?.otherFacilities ?? '',
  };
}

/** The facilities in the list's own order, so a draft ticked in any order compares equal. */
const inOrder = (facilities) => GYM_FACILITIES.filter((key) => facilities.includes(key));

export function toggleFacility(draft, key) {
  const has = draft.facilities.includes(key);
  return { ...draft, facilities: inOrder(has ? draft.facilities.filter((f) => f !== key) : [...draft.facilities, key]) };
}

export function pageRequest(draft) {
  return {
    shown: draft.shown,
    about: draft.about.trim(),
    facilities: inOrder(draft.facilities),
    otherFacilities: draft.otherFacilities.trim(),
  };
}

export function pageChanged(draft, page) {
  return JSON.stringify(pageRequest(draft)) !== JSON.stringify(pageRequest(pageDraft(page)));
}
