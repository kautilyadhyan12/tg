import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { LEADS_DELETE_WORDS } from '@app/shared';
import { orgService, errorText, leadsDeleteChanged, leadsSelectionChanged } from '../../api/orgsApi';
import { Names } from './MemberListRemove';
import { deleteGoneLine, deleteLine, deleteTitle, deletedLine } from './leadsView';

// The Delete box for the leads selected (ROADMAP 20c-vii): before anything goes, it names
// every lead that will be deleted — a few names, "and N more", See all — and says what goes
// with them. The press sends back the box's digest; if any lead selected changed since, the
// server deletes nothing and answers with the new box, which is shown here instead. In the
// middle on a computer, from the bottom on a phone, as Members' Remove box.

export default function LeadsDelete({ gymId, selection, words, onSelectionChanged, onDeleted, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  /** Why the box changed under staff. */
  const [note, setNote] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(null);

  // The page behind holds still while the box is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // A "Select all" that moved gives a new selection, and so a new read.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => orgService.previewDeleteLeads(gymId, selection))
      .then(
        (res) => {
          if (!live) return;
          setPreview(res.data.preview);
          setError(null);
        },
        (err) => {
          if (!live) return;
          const fresh = leadsSelectionChanged(err);
          if (fresh !== null) {
            setNote(LEADS_DELETE_WORDS.selection_changed);
            onSelectionChanged(fresh);
            return;
          }
          setError(errorText(err, "We couldn't work out which leads would be deleted. Please try again."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, selection, onSelectionChanged]);

  const press = async () => {
    if (preview === null || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await orgService.deleteSelectedLeads(gymId, selection, preview.digest);
      setDone(res.data.deleted);
      onDeleted(res.data.deleted);
    } catch (err) {
      const changed = leadsDeleteChanged(err);
      const fresh = leadsSelectionChanged(err);
      if (changed !== null) {
        // Nothing was deleted: the box as it is now.
        setPreview(changed.preview);
        setNote(changed.message);
      } else if (fresh !== null) {
        setPreview(null);
        setNote(LEADS_DELETE_WORDS.selection_changed);
        onSelectionChanged(fresh);
      } else {
        setError(errorText(err, "We couldn't delete them. Please try again."));
      }
    } finally {
      setDeleting(false);
    }
  };

  let body;
  let footer;
  if (done !== null) {
    body = (
      <p className="c-s16 c-w6 c-t1 flex items-center gap-2" role="status" data-testid="delete-done">
        <Check aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        {deletedLine(done)}
      </p>
    );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
        Done
      </button>
    );
  } else if (preview === null) {
    body =
      error !== null ? (
        <p className="c-s14 c-t1" role="alert">
          {error}
        </p>
      ) : (
        <p className="c-s14 c-t2 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
        </p>
      );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg">
        Cancel
      </button>
    );
  } else {
    const gone = deleteGoneLine(preview.gone);
    const any = preview.leads.length > 0;
    body = (
      <>
        {any ? (
          <section className="flex flex-col gap-2" data-testid="delete-leads">
            <h3 className="c-s16 c-w6 c-t1">Will be deleted</h3>
            <Names people={preview.leads} testId="delete-names" />
            <p className="c-s14 c-t2">{deleteLine(words)}</p>
          </section>
        ) : (
          <p className="c-s15 c-t1">None of the leads you selected are here any more.</p>
        )}
        {gone !== null ? (
          <p className="c-s14 c-t2" data-testid="delete-gone">
            {gone}
          </p>
        ) : null}
      </>
    );
    footer = (
      <div className="flex flex-col gap-3 w-full">
        {note !== null ? (
          <p className="c-s14 c-t1 flex gap-2" role="alert" data-testid="delete-note">
            <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
            {note}
          </p>
        ) : null}
        {error !== null ? (
          <p className="c-s14 c-t1" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3">
          {any ? (
            <button type="button" onClick={() => void press()} disabled={deleting} data-testid="delete-press" className="c-btn c-btn-danger c-btn-lg md:order-2">
              {deleting ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {preview.leads.length === 1 ? 'Delete 1 lead' : `Delete ${preview.leads.length.toLocaleString('en')} leads`}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg md:order-1">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={deleteTitle(preview)}
        data-testid="delete-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            {done !== null ? 'Leads deleted' : deleteTitle(preview)}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0">
          <div className="flex flex-col gap-5">{body}</div>
        </div>
        <div className="flex px-4 pt-3 pb-5 md:px-7 md:py-4 border-t md:justify-end" style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
