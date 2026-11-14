import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS } from '@app/shared';
import { orgService, cardRequestPeopleChanged, errorText, selectionChanged } from '../../api/orgsApi';
import { Names } from './MemberListRemove';
import { Refusal, Sheet } from './MemberListTags';
import { cardAskBoxWords, cardAskDoneLine, selectedWords } from './memberListPeople';

// ASK TO ADD CARD (ROADMAP 18d-vii). One box, as Send message's: it names who will be asked to add
// their card in the app and who won't, with the reason in one line each. Only its button asks, as
// many people as it says; if they changed meanwhile nobody is asked and the box shows them again.

/** One key for one box: pressed twice, they are asked once. */
const newKey = () => crypto.randomUUID();

/** How many names of a record two accounts share are shown as buttons. */
const SHARED_SHOWN = 5;

export default function MemberListCardAsk({ gymId, selection, picked, today = null, onSelectionChanged, onInvite, onOpenPerson, onDone = () => undefined, onClose }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const key = useRef(newKey());

  useEffect(() => {
    let live = true;
    orgService.previewCardRequest(gymId, selection).then(
      (res) => {
        if (live) setPreview(res.data.preview);
      },
      (err) => {
        if (!live) return;
        const fresh = selectionChanged(err);
        if (fresh !== null) {
          setError(MEMBER_LIST_SELECTION_CHANGED_WORDS);
          onSelectionChanged(fresh);
          return;
        }
        setError(errorText(err, "We couldn't work out who would be asked. Please try again."));
      },
    );
    return () => {
      live = false;
    };
    // The box is opened for one selection and closed before another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  const press = async () => {
    if (busy || preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.sendCardRequest(gymId, { selection, askCount: preview.askCount, askDigest: preview.askDigest, key: key.current });
      setDone(res.data.done);
      onDone();
    } catch (err) {
      const fresh = selectionChanged(err);
      const box = cardRequestPeopleChanged(err);
      if (fresh !== null) {
        setError(MEMBER_LIST_SELECTION_CHANGED_WORDS);
        onSelectionChanged(fresh);
      } else if (box !== null) {
        setPreview(box);
        setError(errorText(err, 'The people who will be asked changed. Nobody was asked.'));
      } else {
        setError(errorText(err, "We couldn't send that. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  let body;
  let footer = (
    <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg">
      Cancel
    </button>
  );
  if (done !== null) {
    body = (
      <p className="c-s16 c-w6 c-t1 flex items-center gap-2" role="status" data-testid="card-ask-done">
        <Check aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        {cardAskDoneLine(done)}
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
        <Refusal>{error}</Refusal>
      ) : (
        <p className="c-s14 c-t2 flex items-center gap-2" data-testid="card-ask-loading">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> {`${selectedWords(picked)}. Checking who can be asked…`}
        </p>
      );
  } else {
    const words = cardAskBoxWords(preview, today);
    body = (
      <>
        {words.heading !== null ? (
          <section className="flex flex-col gap-2" data-testid="card-ask-send">
            <h3 className="c-s16 c-w6 c-t1">{words.heading}</h3>
            <p className="c-s14 c-t2">{words.what}</p>
            <Names people={preview.ask} total={preview.askCount} testId="card-ask-names" />
          </section>
        ) : (
          <p className="c-s15 c-t1" data-testid="card-ask-nobody">
            {words.nobody}
          </p>
        )}
        {words.keptHeading !== null ? (
          <section className="flex flex-col gap-3" data-testid="card-ask-kept">
            <h3 className="c-s16 c-w6 c-t1">{words.keptHeading}</h3>
            {words.kept.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5" data-testid={`card-ask-kept-${group.key}`}>
                <p className="c-s14 c-t2">{`${group.count.toLocaleString('en')} · ${group.line}`}</p>
                {group.key === 'shared' ? (
                  <ul className="flex flex-col gap-1">
                    {group.people.slice(0, SHARED_SHOWN).map((one) => (
                      <li key={one.entryId}>
                        <button type="button" onClick={() => onOpenPerson(one.entryId)} aria-label={`Open ${one.name || 'No name'}'s page`} className="c-btn-link c-w6 c-s15 min-h-11 text-left">
                          {one.name || 'No name'}
                        </button>
                      </li>
                    ))}
                    {group.count > SHARED_SHOWN ? <li className="c-s14 c-t2">{`and ${(group.count - SHARED_SHOWN).toLocaleString('en')} more`}</li> : null}
                  </ul>
                ) : (
                  <Names people={group.people} total={group.count} testId={`card-ask-names-${group.key}`} />
                )}
                {group.key === 'not_in_app' && onInvite !== null ? (
                  <button type="button" onClick={onInvite} data-testid="card-ask-invite" className="c-btn c-btn-s c-btn-sm self-start">
                    {words.invite}
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {error !== null ? <Refusal>{error}</Refusal> : null}
      </>
    );
    if (words.button !== null) {
      footer = (
        <>
          <button type="button" onClick={() => void press()} disabled={busy} data-testid="card-ask-press" className="c-btn c-btn-p c-btn-lg md:order-2">
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-s c-btn-lg md:order-1">
            Cancel
          </button>
        </>
      );
    }
  }

  return (
    <Sheet title="Ask to add card" testId="card-ask-box" onClose={onClose} footer={footer}>
      {body}
    </Sheet>
  );
}
