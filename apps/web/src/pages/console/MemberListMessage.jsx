import { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { GYM_GROUP_MESSAGE_PROBLEM_WORDS, GYM_MESSAGE_BODY_MAX, MEMBER_LIST_SELECTION_CHANGED_WORDS, groupMessageProblem, tidyGroupMessage } from '@app/shared';
import { orgService, errorText, groupMessagePeopleChanged, selectionChanged } from '../../api/orgsApi';
import { Names } from './MemberListRemove';
import { Refusal, Sheet } from './MemberListTags';
import { messageBoxWords, messageCount, messageDoneLine, selectedWords } from './memberListPeople';

// A MESSAGE TO THE PEOPLE SELECTED (spec Part 3 §16.8; ROADMAP 20f-i). One box, in the
// middle on a computer and from the bottom on a phone: it names who will get the message
// and who won't and why, then takes the words. Only its button sends, to as many people as
// the button says; if they changed meanwhile nothing goes and the box shows them again.

/** One key for one box: pressed twice, the message is sent once. */
const newKey = () => crypto.randomUUID();

export default function MemberListMessage({ gymId, selection, picked, onSelectionChanged, onClose }) {
  const [preview, setPreview] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const fieldId = useId();

  // Who would get it, asked once for the box; a "Select all" that moved closes nothing and
  // says so, as the Tags box does.
  useEffect(() => {
    let live = true;
    orgService.previewGroupMessage(gymId, selection).then(
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
        setError(errorText(err, "We couldn't work out who would get it. Please try again."));
      },
    );
    return () => {
      live = false;
    };
    // The box is opened for one selection and closed before another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  const tidied = tidyGroupMessage(typed);
  const over = tidied.length > GYM_MESSAGE_BODY_MAX;

  const press = async () => {
    if (busy || preview === null) return;
    const problem = groupMessageProblem(tidied);
    if (problem !== null) {
      setError(GYM_GROUP_MESSAGE_PROBLEM_WORDS[problem]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.sendGroupMessage(gymId, { selection, body: tidied, sendCount: preview.sendCount, key: key.current });
      setDone(res.data.done);
    } catch (err) {
      const fresh = selectionChanged(err);
      const box = groupMessagePeopleChanged(err);
      if (fresh !== null) {
        setError(MEMBER_LIST_SELECTION_CHANGED_WORDS);
        onSelectionChanged(fresh);
      } else if (box !== null) {
        // Nothing was sent: the people as they now stand, and the words kept as typed.
        setPreview(box);
        setError(errorText(err, 'The people who will get this changed. Nothing was sent.'));
      } else {
        setError(errorText(err, "We couldn't send that message. Please try again."));
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
      <p className="c-s16 c-w6 c-t1 flex items-center gap-2" role="status" data-testid="message-done">
        <Check aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        {messageDoneLine(done)}
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
        <p className="c-s14 c-t2 flex items-center gap-2" data-testid="message-loading">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> {`${selectedWords(picked)}. Checking who can get a message…`}
        </p>
      );
  } else {
    const words = messageBoxWords(preview);
    body = (
      <>
        {words.heading !== null ? (
          <section className="flex flex-col gap-2" data-testid="message-send">
            <h3 className="c-s16 c-w6 c-t1">{words.heading}</h3>
            <Names people={preview.send} total={preview.sendCount} testId="message-names-send" />
          </section>
        ) : (
          <p className="c-s15 c-t1" data-testid="message-nobody">
            {words.nobody}
          </p>
        )}
        {words.keptHeading !== null ? (
          <section className="flex flex-col gap-3" data-testid="message-kept">
            <h3 className="c-s16 c-w6 c-t1">{words.keptHeading}</h3>
            {words.kept.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5" data-testid={`message-kept-${group.key}`}>
                <p className="c-s14 c-t2">{`${group.count.toLocaleString('en')} · ${group.line}`}</p>
                <Names people={group.people} total={group.count} testId={`message-names-${group.key}`} />
              </div>
            ))}
          </section>
        ) : null}
        {words.heading !== null && !words.full ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="c-s16 c-w6 c-t1">
              Your message
            </label>
            <textarea
              id={fieldId}
              value={typed}
              rows={5}
              onChange={(event) => {
                setTyped(event.target.value);
                setError(null);
              }}
              placeholder="For example: We're closed on Monday for the holiday. Back on Tuesday at 6am."
              aria-describedby={`${fieldId}-help`}
              className="c-area"
              data-testid="message-words"
            />
            <p id={`${fieldId}-help`} className="c-s14 c-t2 flex flex-wrap justify-between gap-x-4 gap-y-1">
              <span>They read it in their inbox in the app. They can't reply, and it can't have a web address or an @ in it.</span>
              <span data-testid="message-count" style={over ? { color: 'var(--bad)' } : undefined}>
                {messageCount(tidied)}
              </span>
            </p>
          </div>
        ) : null}
        <p className="c-s14 c-t2" data-testid="message-today">
          {words.today}
        </p>
        {error !== null ? <Refusal>{error}</Refusal> : null}
      </>
    );
    if (words.button !== null) {
      footer = (
        <>
          <button
            type="button"
            onClick={() => void press()}
            disabled={busy || tidied === '' || over}
            data-testid="message-press"
            className="c-btn c-btn-p c-btn-lg md:order-2"
          >
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
    <Sheet title="Send message" testId="message-box" onClose={onClose} footer={footer}>
      {body}
    </Sheet>
  );
}
