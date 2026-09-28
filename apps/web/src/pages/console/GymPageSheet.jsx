import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Plus, X } from 'lucide-react';
import { GYM_PAGE_MAX_ABOUT_CHARS, GYM_PAGE_MAX_OWN_FACILITY_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import { embedCode, gymPageUrl } from '../gymPublicView';
import { FACILITY_CHOICES, addFacility, pageChanged, pageDraft, pageRequest, removeOwnFacility, toggleFacility } from './gymPageView';

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
  const off = busy || !mayChange;
  const changed = page !== null && pageChanged(draft, page);
  const link = page === null ? '' : gymPageUrl(origin, page.slug);
  const code = page === null ? '' : embedCode(origin, page.slug, gym?.name ?? '');
  const title = `Your ${words.it} page`;

  const edit = (next) => {
    setDone(null);
    setError(null);
    setDraft(next);
  };

  const save = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.setGymPage(gymId, pageRequest(draft));
      setPage(res.data.page);
      setDraft(pageDraft(res.data.page));
      setDone(res.data.page.shown ? 'Saved. Your page is on.' : 'Saved. Your page is off.');
    } catch (err) {
      setError(errorText(err, "We couldn't save your page. Please try again."));
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
