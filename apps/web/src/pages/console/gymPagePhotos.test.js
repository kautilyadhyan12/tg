// The gym page's photos in the console (ROADMAP 20c-iv-b): what the draft does, what
// Save sends, and how a picked photo is made ready. Pure, with a fake window for the
// drawing, as `utils/shrinkPhoto.test.js` does.
import { describe, expect, it } from 'vitest';
import { GYM_PAGE_MAX_PHOTOS, GYM_PAGE_PHOTO_MAX_BYTES } from '@app/shared';
import { addPhotos, makeMainPhoto, orderedIds, pageChanged, pageDraft, photoPlan, photosChanged, removePhoto, unsentPhotos } from './gymPageView';
import { pickProblem, preparePagePhoto } from './gymPagePhotos';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const page = (ids) => ({ shown: true, about: '', facilities: [], ownFacilities: [], photos: ids.map((id) => ({ id, width: 800, height: 600 })), slug: 's', mayChange: true });
const fresh = (key) => ({ key, base64: `b64-${key}`, preview: `blob:${key}` });

describe('the draft', () => {
  it('adds new photos after the page\'s own, up to ten, and says how many did not fit', () => {
    const nine = page(Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`));
    const added = addPhotos(pageDraft(nine), [fresh('new-1'), fresh('new-2'), fresh('new-3')]);
    expect(added.draft.photos).toHaveLength(GYM_PAGE_MAX_PHOTOS);
    expect(added.draft.photos.at(-1)).toEqual({ key: 'new-1', id: null, base64: 'b64-new-1', preview: 'blob:new-1' });
    expect(added.left).toBe(2);
  });

  it('removing and making main change only the draft, and count as a change to save', () => {
    const saved = page([A, B, C]);
    let draft = pageDraft(saved);
    expect(pageChanged(draft, saved)).toBe(false);
    draft = makeMainPhoto(draft, C);
    expect(draft.photos.map((p) => p.key)).toEqual([C, A, B]);
    expect(photosChanged(draft, saved)).toBe(true);
    draft = removePhoto(draft, A);
    expect(draft.photos.map((p) => p.key)).toEqual([C, B]);
    expect(pageChanged(draft, saved)).toBe(true);
    expect(pageChanged(pageDraft(saved), saved)).toBe(false);
  });
});

describe('after a Save that stopped part way', () => {
  it('a new photo the server kept (its reply lost) is known by its upload key and not listed again', () => {
    const saved = page([A]);
    const draft = addPhotos(pageDraft(saved), [
      { ...fresh('new-1'), uploadKey: 'k-1' },
      { ...fresh('new-2'), uploadKey: 'k-2' },
    ]).draft;
    const server = { ...saved, photos: [...saved.photos, { id: B, width: 800, height: 600, uploadKey: 'k-1' }] };
    expect(unsentPhotos(draft, server).map((p) => p.key)).toEqual(['new-2']);
    expect(unsentPhotos(draft, saved).map((p) => p.key)).toEqual(['new-1', 'new-2']);
  });
});

describe('what Save sends', () => {
  it('nothing, when nothing changed', () => {
    expect(photoPlan(pageDraft(page([A, B])), page([A, B]))).toEqual({ remove: [], add: [], reorder: false });
  });

  it('a removal alone needs no new order: the rest close up as they were', () => {
    const saved = page([A, B, C]);
    expect(photoPlan(removePhoto(pageDraft(saved), B), saved)).toEqual({ remove: [B], add: [], reorder: false });
  });

  it('new photos at the end need no new order; a new one made main does', () => {
    const saved = page([A]);
    const withNew = addPhotos(pageDraft(saved), [fresh('new-1')]).draft;
    expect(photoPlan(withNew, saved)).toMatchObject({ remove: [], reorder: false });
    const newMain = makeMainPhoto(withNew, 'new-1');
    const plan = photoPlan(newMain, saved);
    expect(plan.add.map((p) => p.key)).toEqual(['new-1']);
    expect(plan.reorder).toBe(true);
    expect(orderedIds(newMain, { 'new-1': C })).toEqual([C, A]);
  });

  it('a full page can swap photos: the removals go first, so ten never becomes eleven', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
    const saved = page(ids);
    const swapped = addPhotos(removePhoto(pageDraft(saved), ids[3]), [fresh('new-1')]).draft;
    const plan = photoPlan(swapped, saved);
    expect(plan.remove).toEqual([ids[3]]);
    expect(plan.add.map((p) => p.key)).toEqual(['new-1']);
    expect(plan.reorder).toBe(false);
  });

  it('a reorder of photos the page already has', () => {
    const saved = page([A, B, C]);
    const plan = photoPlan(makeMainPhoto(pageDraft(saved), B), saved);
    expect(plan).toEqual({ remove: [], add: [], reorder: true });
  });
});

/** A window whose picture decodes and whose canvas hands back a JPEG of the sizes given,
 *  one per quality tried. */
function fakeDom({ decodes = true, sizes = [1000] } = {}) {
  const qualities = [];
  const made = [];
  let n = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ set fillStyle(_v) {}, fillRect: () => undefined, drawImage: () => undefined }),
    toBlob: (cb, _type, quality) => {
      qualities.push(quality);
      const size = sizes[Math.min(n, sizes.length - 1)];
      n += 1;
      cb(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    },
  };
  class Image {
    decode() {
      if (!decodes) return Promise.reject(new Error('EncodingError'));
      this.naturalWidth = 4032;
      this.naturalHeight = 3024;
      return Promise.resolve();
    }
  }
  const dom = {
    Image,
    document: { createElement: () => canvas },
    URL: { createObjectURL: () => { made.push('blob'); return `blob:${made.length}`; }, revokeObjectURL: () => undefined },
    crypto: { randomUUID: () => `11111111-1111-4111-8111-${String(made.length).padStart(12, '0')}` },
  };
  return { dom, canvas, qualities };
}

describe('a picked photo made ready', () => {
  it('a phone photo is drawn at most 2,000 px on its longest side and sent as base64', async () => {
    const { dom, canvas, qualities } = fakeDom({ sizes: [900_000] });
    const ready = await preparePagePhoto(new Blob(['raw']), dom);
    expect([canvas.width, canvas.height]).toEqual([2000, 1500]);
    expect(qualities).toEqual([0.85]);
    expect(atob(ready.base64)).toHaveLength(900_000);
    expect(ready.preview).toMatch(/^blob:/);
    expect(ready.key).toMatch(/^new-\d+$/);
    // Its own key for the server, so a lost reply never makes a second copy.
    expect(ready.uploadKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a photo still over 2 MB is drawn again at lower quality, and refused after the third', async () => {
    const fits = fakeDom({ sizes: [GYM_PAGE_PHOTO_MAX_BYTES + 1, GYM_PAGE_PHOTO_MAX_BYTES] });
    await preparePagePhoto(new Blob(['raw']), fits.dom);
    expect(fits.qualities).toEqual([0.85, 0.7]);
    const never = fakeDom({ sizes: [GYM_PAGE_PHOTO_MAX_BYTES + 1] });
    await expect(preparePagePhoto(new Blob(['raw']), never.dom)).rejects.toThrow('too_big');
    expect(never.qualities).toEqual([0.85, 0.7, 0.55]);
  });

  it('a photo the browser cannot open (a HEIC on Windows, a renamed file) is unreadable', async () => {
    await expect(preparePagePhoto(new Blob(['raw']), fakeDom({ decodes: false }).dom)).rejects.toThrow('unreadable');
  });

  it('says which photos were not added and why, by name', () => {
    expect(pickProblem({ unreadable: [], tooBig: [], left: 0 })).toBeNull();
    expect(pickProblem({ unreadable: ['IMG_2041.HEIC'], tooBig: [], left: 0 })).toBe('We couldn\'t open “IMG_2041.HEIC”. Choose a JPEG, PNG or WebP photo.');
    expect(pickProblem({ unreadable: ['a.heic', 'b.heic', 'c.heic', 'd.heic'], tooBig: ['pano.jpg'], left: 2 })).toBe(
      'We couldn\'t open “a.heic”, “b.heic”, “c.heic” and 1 more. Choose a JPEG, PNG or WebP photo. “pano.jpg” is too large even made smaller. Choose a smaller photo. Your page shows up to 10 photos, so 2 photos were not added.',
    );
    expect(pickProblem({ unreadable: ['a.heic', 'b.heic'], tooBig: [], left: 1 })).toBe(
      'We couldn\'t open “a.heic” and “b.heic”. Choose a JPEG, PNG or WebP photo. Your page shows up to 10 photos, so 1 photo was not added.',
    );
  });
});
