import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, ImagePlus, Loader2, Plus, Star, Trash2, X } from 'lucide-react';
import { GYM_PAGE_MAX_ABOUT_CHARS, GYM_PAGE_MAX_OWN_FACILITY_CHARS, GYM_PAGE_MAX_PHOTOS } from '@app/shared';
import { orgService, errorStatus, errorText, gymPhotoUrl } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import { embedCode, gymPageUrl } from '../gymPublicView';
import { pickProblem, preparePagePhoto } from './gymPagePhotos';
import {
  FACILITY_CHOICES,
  addFacility,
  addPhotos,
  fieldsChanged,
  makeMainPhoto,
  orderedIds,
  pageChanged,
  pageDraft,
  pageRequest,
  photoPlan,
  photosChanged,
  removeOwnFacility,
  removePhoto,
  toggleFacility,
} from './gymPageView';

// The gym's own page (ROADMAP 20c-iv-a; spec Part 3 §16.3), opened from Leads: switch it
// on, write "About us", tick the facilities, and copy the link or the code for the
// gym's own website. Anybody with the link sees the page and its form; a person who
// sends the form is added to Leads. Only the owner changes it (the server's
// `org.manage`); other staff who keep leads see it and copy the link. A gym adds its own
// facilities to the same tick list. One Save for everything in the panel. Drawn as the lead's panel is (R3; spec Part 3 §17).

function Tick({ checked, label, hint = null, disabled, onChange }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 min-h-11 text-left disabled:opacity-60"
    >
      <span className={checked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
        {checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="c-s15 c-w5 c-t1">{label}</span>
        {hint !== null ? <span className="c-hint">{hint}</span> : null}
      </span>
    </button>
  );
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: the text is on screen to copy by hand.
    }
  };
  return (
    <button type="button" onClick={copy} className="c-btn c-btn-sm c-btn-s">
      {copied ? <Check aria-hidden="true" className="w-4 h-4" /> : <Copy aria-hidden="true" className="w-4 h-4" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function GymPageSheet({ gymId, gym, words, readOnly, onClose }) {
  const [page, setPage] = useState(null);
  const [draft, setDraft] = useState(pageDraft(null));
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /** What is typed in "Add a facility", and why it could not be added. */
  const [typedOwn, setTypedOwn] = useState('');
  const [ownProblem, setOwnProblem] = useState(null);
  /** Photos being made ready, and why some could not be added. */
  const [preparing, setPreparing] = useState(false);
  const [photoProblem, setPhotoProblem] = useState(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    let gone = false;
    orgService.getGymPage(gymId).then(
      (res) => {
        if (gone) return;
        setPage(res.data.page);
        setDraft(pageDraft(res.data.page));
      },
      (err) => {
        if (!gone) setLoadError(errorText(err, `We couldn't load your ${words.it} page.`));
      },
    );
    return () => {
      gone = true;
    };
  }, [gymId, words.it]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const mayChange = page?.mayChange === true && !readOnly;
  const off = busy || preparing || !mayChange;
  const changed = page !== null && pageChanged(draft, page);
  const link = page === null ? '' : gymPageUrl(origin, page.slug);
  const code = page === null ? '' : embedCode(origin, page.slug, gym?.name ?? '');
  const title = `Your ${words.it} page`;

  const edit = (next) => {
    setDone(null);
    setError(null);
    setDraft(next);
  };

  /** Photos picked from the device, shrunk and added to the draft (they go on Save). */
  const pickPhotos = async (files) => {
    setPhotoProblem(null);
    setPreparing(true);
    const prepared = [];
    const unreadable = [];
    const tooBig = [];
    for (const file of files) {
      try {
        prepared.push(await preparePagePhoto(file));
      } catch (err) {
        (err.message === 'too_big' ? tooBig : unreadable).push(file.name);
      }
    }
    setPreparing(false);
    const added = addPhotos(draft, prepared);
    for (const unused of prepared.slice(prepared.length - added.left)) URL.revokeObjectURL?.(unused.preview);
    edit(added.draft);
    setPhotoProblem(pickProblem({ unreadable, tooBig, left: added.left }));
  };

  /** Save: the words and ticks, then the photos removed, added and ordered. A photo
   *  refused part way leaves the page as the server has it, with the photos not yet
   *  sent still in the panel to try again. */
  const save = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setError(null);
    let fresh = page;
    const idsByKey = {};
    try {
      if (fieldsChanged(draft, page)) fresh = (await orgService.setGymPage(gymId, pageRequest(draft))).data.page;
      const plan = photoPlan(draft, page);
      for (const id of plan.remove) {
        try {
          await orgService.removeGymPagePhoto(gymId, id);
        } catch (err) {
          // Removed already, in another window: what Save wanted.
          if (errorStatus(err) !== 404) throw err;
        }
      }
      for (const photo of plan.add) {
        idsByKey[photo.key] = (await orgService.addGymPagePhoto(gymId, photo.base64)).data.photo.id;
      }
      if (plan.reorder) await orgService.orderGymPagePhotos(gymId, orderedIds(draft, idsByKey));
      if (photosChanged(draft, page)) fresh = (await orgService.getGymPage(gymId)).data.page;
      for (const photo of plan.add) URL.revokeObjectURL?.(photo.preview);
      setPage(fresh);
      setDraft(pageDraft(fresh));
      setDone(fresh.shown ? 'Saved. Your page is on.' : 'Saved. Your page is off.');
    } catch (err) {
      setError(errorText(err, "We couldn't save your page. Please try again."));
      try {
        fresh = (await orgService.getGymPage(gymId)).data.page;
        const unsent = draft.photos.filter((p) => p.id === null && idsByKey[p.key] === undefined);
        const kept = fieldsChanged(draft, fresh) ? draft : pageDraft(fresh);
        setPage(fresh);
        setDraft({ ...kept, photos: [...pageDraft(fresh).photos, ...unsent] });
      } catch {
        // The page could not be read again: the panel stays as it was, and Save tries all of it.
      }
    } finally {
      setBusy(false);
    }
  };

  const tryClose = () => (changed ? setLeaving(true) : onClose());

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="c-sheet absolute inset-0 md:left-auto md:w-[540px] md:border-l flex flex-col overflow-y-auto md:overflow-hidden"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex flex-col gap-4 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1 flex-grow min-w-0">
              <h2 className="c-h1 c-ell" style={{ fontSize: 28, lineHeight: '34px' }}>
                {title}
              </h2>
              <span className="c-s14 c-t2">
                A page anyone can open from your link. People who send its form are added to your leads.
              </span>
            </div>
            <button type="button" aria-label="Close" onClick={tryClose} className="c-icon-btn">
              <X aria-hidden="true" className="w-5 h-5" />
            </button>
          </div>
          {leaving ? (
            <ConfirmInline
              question="Your changes to your page are not saved."
              confirmLabel="Discard changes"
              cancelLabel="Keep editing"
              onConfirm={onClose}
              onCancel={() => setLeaving(false)}
              newLook
            />
          ) : null}
        </div>

        <div className="md:flex-grow md:overflow-y-auto flex flex-col gap-5 px-4 py-5 md:px-7">
          {loadError !== null ? <p className="c-s15 c-t2">{loadError}</p> : null}
          {page === null && loadError === null ? (
            <p className="c-s14 c-t3 flex items-center gap-2">
              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
            </p>
          ) : null}

          {page !== null ? (
            <>
              {!page.mayChange ? <p className="c-s14 c-t2">Only the owner can change this page. You can copy its link.</p> : null}

              <Tick
                checked={draft.shown}
                label="Show my page"
                hint={draft.shown ? 'Anyone with the link can see it and send you a message.' : 'While it is off, the link shows "This page isn\'t available."'}
                disabled={off}
                onChange={(shown) => edit({ ...draft, shown })}
              />

              <div className="c-field">
                <span className="c-label">Link to your page</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="Link to your page" readOnly value={link} className="c-input flex-grow min-w-0" onFocus={(e) => e.target.select()} />
                  <CopyButton text={link} label="Copy link" />
                  {page.shown ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="c-btn c-btn-sm c-btn-s">
                      <ExternalLink aria-hidden="true" className="w-4 h-4" /> Open
                    </a>
                  ) : null}
                </div>
                <span className="c-hint">Put it in your Instagram bio, a WhatsApp message or on your website.</span>
              </div>

              <label className="c-field">
                <span className="c-label">About us</span>
                <textarea
                  aria-label="About us"
                  rows={5}
                  maxLength={GYM_PAGE_MAX_ABOUT_CHARS}
                  value={draft.about}
                  disabled={off}
                  onChange={(e) => edit({ ...draft, about: e.target.value })}
                  placeholder="What your members like about you: the space, the coaches, the classes."
                  className="c-area"
                />
                <span className="c-hint">
                  {draft.about.length.toLocaleString('en')} of {GYM_PAGE_MAX_ABOUT_CHARS.toLocaleString('en')} characters
                </span>
              </label>

              <div className="c-field">
                <span className="c-label">Photos</span>
                <span className="c-hint">
                  Show people your gym: the floor, the equipment, the changing rooms. The main photo is the big one at the top of your page.
                </span>
                {draft.photos.length > 0 ? (
                  <ul className="grid grid-cols-2 gap-3 pt-1" aria-label="Photos">
                    {draft.photos.map((photo, index) => {
                      const label = `Photo ${index + 1} of ${draft.photos.length}`;
                      return (
                        <li key={photo.key} className="flex flex-col gap-1.5">
                          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '4 / 3', background: 'var(--raise)' }}>
                            <img
                              src={photo.id === null ? photo.preview : gymPhotoUrl({ gymId, photoId: photo.id })}
                              alt={index === 0 ? `${label}, the main photo` : label}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                            {index === 0 ? <span className="c-tag c-tag-soft absolute left-2 top-2">Main photo</span> : null}
                            {photo.id === null ? <span className="c-tag c-tag-plain absolute right-2 top-2">Not saved</span> : null}
                          </div>
                          {mayChange ? (
                            <div className="flex flex-col items-start gap-1.5">
                              {/* Every tile two rows, so the grid stays even: the main photo says so where the others have the button. */}
                              {index > 0 ? (
                                <button type="button" disabled={off} onClick={() => edit(makeMainPhoto(draft, photo.key))} className="c-btn c-btn-sm c-btn-s" aria-label={`Make photo ${index + 1} the main photo`}>
                                  <Star aria-hidden="true" className="w-4 h-4" /> Make main photo
                                </button>
                              ) : (
                                <span className="c-s14 c-t2 flex items-center gap-1.5 h-8">
                                  <Star aria-hidden="true" className="w-4 h-4" /> The main photo
                                </span>
                              )}
                              <button type="button" disabled={off} onClick={() => edit(removePhoto(draft, photo.key))} className="c-btn c-btn-sm c-btn-s" aria-label={`Remove photo ${index + 1}`}>
                                <Trash2 aria-hidden="true" className="w-4 h-4" /> Remove
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="c-s14 c-t3">No photos yet.</p>
                )}
                {mayChange ? (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <input
                      ref={pickerRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      multiple
                      hidden
                      aria-label="Choose photos"
                      onChange={(e) => {
                        const files = [...(e.target.files ?? [])];
                        e.target.value = '';
                        if (files.length > 0) void pickPhotos(files);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => pickerRef.current?.click()}
                      disabled={off || preparing || draft.photos.length >= GYM_PAGE_MAX_PHOTOS}
                      className="c-btn c-btn-sm c-btn-s"
                    >
                      {preparing ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <ImagePlus aria-hidden="true" className="w-4 h-4" />}
                      {preparing ? 'Getting photos ready…' : 'Add photos'}
                    </button>
                    <span className="c-hint">
                      {draft.photos.length} of {GYM_PAGE_MAX_PHOTOS} photos
                    </span>
                  </div>
                ) : null}
                {photoProblem !== null ? (
                  <span className="c-hint" role="alert" style={{ color: 'var(--bad)' }}>
                    {photoProblem}
                  </span>
                ) : null}
              </div>

              <div className="c-field">
                <span className="c-label">Facilities</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4" role="group" aria-label="Facilities">
                  {FACILITY_CHOICES.map((choice) => (
                    <Tick
                      key={choice.key}
                      checked={draft.facilities.includes(choice.key)}
                      label={choice.label}
                      disabled={off}
                      onChange={() => edit(toggleFacility(draft, choice.key))}
                    />
                  ))}
                  {/* The gym's own: ticked while they are on the page; untick takes one off. */}
                  {draft.ownFacilities.map((name) => (
                    <Tick key={`own-${name}`} checked label={name} disabled={off} onChange={() => edit(removeOwnFacility(draft, name))} />
                  ))}
                </div>
                {mayChange ? (
                  <form
                    className="flex flex-wrap items-center gap-2 pt-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const added = addFacility(draft, typedOwn);
                      setOwnProblem(added.problem);
                      if (added.problem === null) {
                        edit(added.draft);
                        setTypedOwn('');
                      }
                    }}
                  >
                    <input
                      aria-label="Add a facility"
                      value={typedOwn}
                      maxLength={GYM_PAGE_MAX_OWN_FACILITY_CHARS}
                      disabled={off}
                      onChange={(e) => {
                        setTypedOwn(e.target.value);
                        setOwnProblem(null);
                      }}
                      placeholder="Add a facility, e.g. Boxing ring"
                      className="c-input flex-grow min-w-0"
                      style={{ width: 'auto' }}
                    />
                    <button type="submit" disabled={off || typedOwn.trim() === ''} className="c-btn c-btn-sm c-btn-s">
                      <Plus aria-hidden="true" className="w-4 h-4" /> Add
                    </button>
                  </form>
                ) : null}
                {ownProblem !== null ? (
                  <span className="c-hint" role="alert" style={{ color: 'var(--bad)' }}>
                    {ownProblem}
                  </span>
                ) : null}
              </div>

              <p className="c-s14 c-t2">Your page also shows your opening hours from Settings, and on a day you close, that day's closure note.</p>

              <div className="c-field pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
                <span className="c-label">Show the form on your own website</span>
                <textarea aria-label="Code for your website" readOnly rows={4} value={code} className="c-area" onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 13 }} />
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton text={code} label="Copy code" />
                </div>
                <span className="c-hint">
                  Paste it into your website where the form should appear. Website builders such as Wix, Squarespace and WordPress have an
                  &ldquo;Embed&rdquo; or &ldquo;HTML&rdquo; block for this. The form works only while your page is on.
                </span>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 md:px-7 border-t" style={{ borderColor: 'var(--line)' }}>
          {error !== null ? (
            <p className="c-s14 c-w5" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          ) : null}
          {done !== null ? (
            <p className="c-s14 c-w5" role="status" style={{ color: 'var(--good)' }}>
              {done}
            </p>
          ) : null}
          {page !== null && page.mayChange ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={save} disabled={off || !changed} className="c-btn c-btn-p">
                {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                Save
              </button>
              {changed ? (
                <button type="button" onClick={() => edit(pageDraft(page))} disabled={busy} className="c-btn c-btn-s">
                  Cancel
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
