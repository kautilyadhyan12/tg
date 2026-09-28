// A photo picked for the gym's page, made ready to send (ROADMAP 20c-iv-b): redrawn by
// the browser at most 2,000 px on its longest side as a JPEG, so a phone's 5 MB photo
// fits the page's 2 MB and its location tags stay on the phone. The server cleans every
// photo again whatever the browser did. The drawing takes its window, so a test can
// hand it a fake one.
import { GYM_PAGE_PHOTO_MAX_BYTES, GYM_PAGE_PHOTO_SEND_SIDE } from '@app/shared';
import { shrinkPhoto } from '../../utils/shrinkPhoto';
import { bytesToBase64 } from './memberListView';

/** Tried in turn until the photo fits in 2 MB. */
const QUALITIES = [0.85, 0.7, 0.55];

let made = 0;

/** file → `{ key, base64, preview }`, or throws `unreadable` / `too_big`. */
export async function preparePagePhoto(file, dom = globalThis) {
  for (const quality of QUALITIES) {
    let blob;
    try {
      blob = await shrinkPhoto(file, dom, { maxEdge: GYM_PAGE_PHOTO_SEND_SIDE, quality });
    } catch {
      throw new Error('unreadable');
    }
    if (blob.size <= GYM_PAGE_PHOTO_MAX_BYTES) {
      made += 1;
      return {
        key: `new-${made}`,
        base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
        preview: dom.URL.createObjectURL(blob),
      };
    }
  }
  throw new Error('too_big');
}

/** What staff read about photos that could not be added, by name. */
export function pickProblem({ unreadable, tooBig, left }) {
  const lines = [];
  if (unreadable.length > 0) {
    lines.push(`We couldn't open ${namesOf(unreadable)}. Choose a JPEG, PNG or WebP photo.`);
  }
  if (tooBig.length > 0) lines.push(`${namesOf(tooBig)} ${tooBig.length === 1 ? 'is' : 'are'} too large even made smaller. Choose a smaller photo.`);
  if (left > 0) lines.push(`Your page shows up to 10 photos, so ${left === 1 ? '1 photo was' : `${left} photos were`} not added.`);
  return lines.length === 0 ? null : lines.join(' ');
}

function namesOf(names) {
  const shown = names.slice(0, 3).map((name) => `“${name}”`);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}
