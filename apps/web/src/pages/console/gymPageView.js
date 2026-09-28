// The gym page's panel in the console (ROADMAP 20c-iv-a): what staff typed, whether it
// changed, and the request that saves it. Everything in the panel waits for Save.
import {
  GYM_FACILITIES,
  GYM_FACILITY_WORDS,
  GYM_PAGE_MAX_OWN_FACILITIES,
  GYM_PAGE_MAX_OWN_FACILITY_CHARS,
  GYM_PAGE_MAX_PHOTOS,
  typedFacility,
} from '@app/shared';

export const FACILITY_CHOICES = GYM_FACILITIES.map((key) => ({ key, label: GYM_FACILITY_WORDS[key] }));

export function pageDraft(page) {
  return {
    shown: page?.shown === true,
    about: page?.about ?? '',
    facilities: [...(page?.facilities ?? [])],
    ownFacilities: [...(page?.ownFacilities ?? [])],
    // A photo the page has is `{ key: its id, id }`; one added here and not yet saved
    // is `{ key, id: null, base64, preview }` (20c-iv-b).
    photos: (page?.photos ?? []).map((photo) => ({ key: photo.id, id: photo.id })),
  };
}

// ── PHOTOS (20c-iv-b) ─────────────────────────────────────────────────────────

/** Adds photos the browser has shrunk, up to the page's ten. `{ draft, left }`: how
 *  many did not fit. */
export function addPhotos(draft, prepared) {
  const room = Math.max(0, GYM_PAGE_MAX_PHOTOS - draft.photos.length);
  const taken = prepared
    .slice(0, room)
    .map((photo) => ({ key: photo.key, id: null, uploadKey: photo.uploadKey, base64: photo.base64, preview: photo.preview }));
  return { draft: { ...draft, photos: [...draft.photos, ...taken] }, left: prepared.length - taken.length };
}

export function removePhoto(draft, key) {
  return { ...draft, photos: draft.photos.filter((photo) => photo.key !== key) };
}

/** The photo made the page's main one: first in the list. */
export function makeMainPhoto(draft, key) {
  const photo = draft.photos.find((p) => p.key === key);
  return photo === undefined ? draft : { ...draft, photos: [photo, ...draft.photos.filter((p) => p.key !== key)] };
}

/** What Save sends for the photos, in this order: the removals first (so ten on the page
 *  can be swapped for others), then the new ones, then the order, when the page's own
 *  order after the adds (kept ones as they were, new ones at the end) is not the draft's. */
export function photoPlan(draft, page) {
  const keep = new Set(draft.photos.filter((p) => p.id !== null).map((p) => p.id));
  const remove = (page?.photos ?? []).map((p) => p.id).filter((id) => !keep.has(id));
  const add = draft.photos.filter((p) => p.id === null);
  const kept = (page?.photos ?? []).map((p) => p.id).filter((id) => keep.has(id));
  const serverOrder = [...kept, ...add.map((p) => p.key)];
  const wanted = draft.photos.map((p) => p.key);
  return { remove, add, reorder: serverOrder.join() !== wanted.join() };
}

/** After a Save that stopped part way: the new photos the server does not have yet. One
 *  it kept whose reply was lost is known by its upload key, so it is not listed twice. */
export function unsentPhotos(draft, serverPage) {
  const kept = new Set((serverPage?.photos ?? []).map((p) => p.uploadKey));
  return draft.photos.filter((p) => p.id === null && !kept.has(p.uploadKey));
}

/** The draft's order, with each new photo's key replaced by the id the server gave it. */
export function orderedIds(draft, idsByKey) {
  return draft.photos.map((p) => p.id ?? idsByKey[p.key]);
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

/** Whether the page's words, ticks or switch changed (what `setGymPage` saves). */
export function fieldsChanged(draft, page) {
  return JSON.stringify(pageRequest(draft)) !== JSON.stringify(pageRequest(pageDraft(page)));
}

export function photosChanged(draft, page) {
  return draft.photos.map((p) => p.key).join() !== (page?.photos ?? []).map((p) => p.id).join();
}

export function pageChanged(draft, page) {
  return fieldsChanged(draft, page) || photosChanged(draft, page);
}
