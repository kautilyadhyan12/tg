import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS } from '@app/shared';
import { deleteRefused, errorText, selectionChanged } from '../../api/orgsApi';
import PlaceLink from '../../components/console/PlaceLink';
import { Names } from './MemberListRemove';
import { DELETE_WHAT_HAPPENS, SQUARE_OWNER_ONLY, deleteButton, deleteDoneLine, deleteKeptLine, deleteNobodyLine, deleteQuestion, deleteSquareGroups } from './memberListDeleteView';

// The Delete permanently box for the past members selected (5e-ii; Kd's click-through,
// 2026-10-16). Before anyone is deleted it names who, and who ticked is not and why; the
// press sends back the box's digest, and if anyone changed since, the server deletes nobody
// and answers with the new box, shown here instead. Laid out as the Remove box is. It also says how many of them have a
// customer in the gym's Square that the app added, which is deleted from Square too (18d-iii-b-ii-b-ii-b-ii); `squareTo` opens
// Connect Square for whoever may, for the customers the app cannot reach.
export default function MemberListDelete({ words, load, press, onSelectionChanged, onDeleted, onClose, squareTo = null }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => load())
      .then(
        (got) => {
          if (!live) return;
          setPreview(got);
          setError(null);
        },
        (err) => {
          if (!live) return;
          const fresh = selectionChanged(err);
          if (fresh !== null) {
            setNote(MEMBER_LIST_SELECTION_CHANGED_WORDS);
            onSelectionChanged(fresh);
            return;
          }
          setError(errorText(err, "We couldn't work out who would be deleted. Please try again."));
        },
      );
    return () => {
      live = false;
    };
  }, [load, onSelectionChanged]);

  const remove = async () => {
    if (preview === null || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const answer = await press(preview.digest);
      setDone(answer);
      onDeleted(answer);
    } catch (err) {
      const refused = deleteRefused(err);
      const fresh = selectionChanged(err);
      if (refused !== null) {
        setPreview(refused.preview);
        setNote(refused.message);
      } else if (fresh !== null) {
        setPreview(null);
        setNote(MEMBER_LIST_SELECTION_CHANGED_WORDS);
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
        {deleteDoneLine(done, words)}
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
    const question = deleteQuestion(preview, words);
    const nobody = deleteNobodyLine(preview, words);
    const kept = deleteKeptLine(preview, words);
    const squareGroups = question !== null ? deleteSquareGroups(preview) : [];
    body = (
      <>
        {question !== null ? (
          <section className="flex flex-col gap-2" data-testid="delete-who">
            <h3 className="c-s16 c-w6 c-t1">{question}</h3>
            <Names people={preview.names.map((name, i) => ({ id: String(i), name }))} total={preview.count} testId="delete-names" />
            <p className="c-s14 c-t2">{DELETE_WHAT_HAPPENS}</p>
          </section>
        ) : null}
        {squareGroups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2" data-testid={`delete-square-${group.key}`}>
            <h3 className="c-s16 c-w6 c-t1">{group.title}</h3>
            <Names people={group.people} total={group.total} testId={`delete-square-${group.key}-names`} />
            <p className="c-s14 c-t2">{group.why}</p>
            {group.key === 'notReached' ? (
              squareTo !== null ? (
                <PlaceLink to={squareTo} data-testid="delete-square-connect">
                  Connect Square
                </PlaceLink>
              ) : (
                <p className="c-s14 c-t2" data-testid="delete-square-owner">
                  {SQUARE_OWNER_ONLY}
                </p>
              )
            ) : null}
          </section>
        ))}
        {nobody !== null ? <p className="c-s15 c-t1" data-testid="delete-nobody">{nobody}</p> : null}
        {kept !== null ? (
          <p className="c-s14 c-t2" data-testid="delete-kept">
            {kept}
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
          {question !== null ? (
            <button type="button" onClick={() => void remove()} disabled={deleting} data-testid="delete-confirm" className="c-btn c-btn-danger c-btn-lg md:order-2">
              {deleting ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {deleteButton(preview)}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg md:order-1">
            {question !== null ? "Don't delete" : 'Close'}
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
        aria-label="Delete permanently"
        data-testid="delete-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            Delete permanently
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
