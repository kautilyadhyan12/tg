import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import {
  UNLINK_QUESTION,
  asksPaid,
  boxProblem,
  boxWords,
  doneWords,
  giveGroups,
  groupNames,
  leftOut,
  linkBody,
  linkedLine,
  packNote,
  paidQuestion,
  wordLine,
} from '../../pages/console/membershipWordsView';
import { ConfirmInline } from './ConsoleStates';

// MEMBERSHIPS FROM YOUR LIST (spec Part 3 §13.2; ROADMAP 17a-iii), inside Settings →
// Memberships. A gym that came from a file has a word beside each person ("Gold").
// Staff link the word to one of their own types once; a box then names who gets the
// membership and who does not, and nothing is given before its button is pressed.
// Drawn only where the list has such words and the person may open a member's page
// (`members.confirm`, as the server asks).

const inputStyle = { background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' };
const quietButton = { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' };
const mainButton = { background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' };
const hintStyle = { color: 'rgba(255,255,255,0.55)' };
const plainStyle = { color: 'rgba(255,255,255,0.75)' };

const ALL_TICKED = { settled: true, due: true, ask: true };

/** One group's names: a few, then "and N more" and See all. */
function Names({ preview, group }) {
  const [all, setAll] = useState(false);
  const { names, more, unnamed, canSeeAll } = groupNames(preview, group, all);
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm" style={hintStyle}>
        {names.map((n) => n.text).join(', ')}
        {!all && more > 0 ? `, and ${more.toLocaleString('en')} more` : ''}
        {all && unnamed > 0 ? `, and ${unnamed.toLocaleString('en')} more. To see everyone, filter Members by this membership.` : ''}
      </p>
      {canSeeAll ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="self-start text-sm underline min-h-11" style={plainStyle}>
          {all ? 'Show fewer' : 'See all'}
        </button>
      ) : null}
    </div>
  );
}

function LinkBox({ preview, busy, error, onGive, onCancel }) {
  const [ticks, setTicks] = useState(ALL_TICKED);
  const [paid, setPaid] = useState(null);
  const [pressed, setPressed] = useState(false);
  const words = boxWords(preview, ticks);
  const problem = boxProblem(preview, ticks, paid);
  const groups = giveGroups(preview);
  const out = leftOut(preview);
  const question = paidQuestion(preview);
  const pack = packNote(preview);
  const id = (name) => `membership-link-${name}-${preview.type.id}`;

  return (
    <div
      role="group"
      aria-label={words.heading}
      className="rounded-xl p-4 flex flex-col gap-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,138,31,0.45)' }}
    >
      <p className="text-sm font-semibold" style={{ color: '#fff' }}>
        {words.heading}
      </p>

      {groups.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide" style={hintStyle}>
            Who gets it
          </p>
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-1">
              <label className="flex items-start gap-3 min-h-11 text-sm" style={{ color: '#fff' }}>
                <input
                  type="checkbox"
                  className="w-5 h-5 mt-0.5"
                  checked={ticks[g.key]}
                  onChange={() => setTicks((t) => ({ ...t, [g.key]: !t[g.key] }))}
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{g.title}</span>
                  <span style={plainStyle}>{g.detail}</span>
                </span>
              </label>
              <div className="pl-8">
                <Names preview={preview} group={g.key} />
              </div>
              {g.key === 'ask' && asksPaid(preview, ticks) ? (
                <div role="radiogroup" aria-label={question.question} className="pl-8 flex flex-col gap-1">
                  <span className="text-sm font-medium" style={{ color: '#fff' }}>
                    {question.question}
                  </span>
                  {[
                    { value: true, label: question.yes },
                    { value: false, label: question.no },
                  ].map((choice) => (
                    <label key={String(choice.value)} className="flex items-center gap-3 min-h-11 text-sm" style={{ color: '#fff' }}>
                      <input
                        type="radio"
                        name={id('paid')}
                        className="w-5 h-5"
                        checked={paid === choice.value}
                        onChange={() => setPaid(choice.value)}
                      />
                      {choice.label}
                    </label>
                  ))}
                  {pressed && problem !== null ? (
                    <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
                      {problem}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {pack !== null ? (
            <p className="text-sm" style={plainStyle}>
              {pack}
            </p>
          ) : null}
        </div>
      ) : null}

      {out.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={hintStyle}>
            Who doesn&apos;t
          </p>
          {out.map((line) => (
            <div key={line.key} className="flex flex-col gap-1">
              <p className="text-sm" style={plainStyle}>
                {line.text}
              </p>
              {line.key === 'past' ? null : <Names preview={preview} group={line.key} />}
            </div>
          ))}
        </div>
      ) : null}

      {words.nobody !== null ? (
        <p className="text-sm" style={plainStyle}>
          {words.nobody}
        </p>
      ) : (
        <p className="text-sm" style={hintStyle}>
          No money is taken and nobody is emailed. You can change or cancel a membership on each person&apos;s page.
        </p>
      )}

      {error !== null ? (
        <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPressed(true);
            if (problem === null) onGive(linkBody(preview, ticks, paid));
          }}
          className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40"
          style={mainButton}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
          {words.button}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-4 py-3 text-sm min-h-11 disabled:opacity-40" style={quietButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function WordRow({ gymId, word, types, readOnly, busy, open, onOpen, onUnlink }) {
  const [typeId, setTypeId] = useState('');
  const [asking, setAsking] = useState(false);
  const linked = linkedLine(word);
  const selectId = `membership-word-${gymId}-${word.word}`;

  return (
    <li className="py-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="text-sm font-semibold" style={{ color: '#fff' }}>
        {wordLine(word)}
      </span>
      {linked !== null ? (
        <>
          <p className="text-sm" style={plainStyle}>
            {linked.text}
          </p>
          {asking ? (
            <ConfirmInline
              question={UNLINK_QUESTION(word)}
              confirmLabel="Remove link"
              cancelLabel="Keep it"
              busy={busy}
              onConfirm={() => {
                setAsking(false);
                onUnlink(word);
              }}
              onCancel={() => setAsking(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {linked.canGive ? (
                <button
                  type="button"
                  disabled={readOnly || busy || open}
                  onClick={() => onOpen(word, word.link.typeId)}
                  aria-label={`Give ${word.link.typeName} to the people with ${word.word} who don't have it`}
                  className="rounded-xl px-4 py-2 text-sm font-semibold min-h-11 disabled:opacity-40"
                  style={mainButton}
                >
                  Give it to them
                </button>
              ) : null}
              <button
                type="button"
                disabled={readOnly || busy || open}
                onClick={() => setAsking(true)}
                aria-label={`Remove the link for ${word.word}`}
                className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
                style={quietButton}
              >
                Remove link
              </button>
            </div>
          )}
        </>
      ) : types.length === 0 ? (
        <p className="text-sm" style={hintStyle}>
          Add a membership type above first, then link {word.word} to it.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 flex-grow min-w-0" style={{ maxWidth: '22rem' }}>
            <label htmlFor={selectId} className="text-sm" style={plainStyle}>
              Which of your membership types is {word.word}?
            </label>
            <select
              id={selectId}
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
              disabled={readOnly || busy || open}
              className="w-full rounded-xl px-4 py-3 text-base sm:text-sm"
              style={inputStyle}
            >
              <option value="">Choose a membership type</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={readOnly || busy || open || typeId === ''}
            onClick={() => onOpen(word, typeId)}
            aria-label={`Link ${word.word}`}
            className="rounded-xl px-5 py-3 text-sm font-semibold min-h-11 disabled:opacity-40"
            style={mainButton}
          >
            Link
          </button>
        </div>
      )}
    </li>
  );
}

/** `types` is the price list as the panel above holds it: the words are read again
 *  whenever it changes, so a renamed or archived type is never shown as it was. */
export default function MembershipWordsBox({ gymId, readOnly, types }) {
  const [list, setList] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getMembershipWords(gymId)
        .then((res) => {
          if (isLive()) setList(res.data);
        })
        // Somebody without the tick to open a member's page sees no box.
        .catch(() => {
          if (isLive()) setList(null);
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load, types]);

  const open = async (word, typeId) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await orgService.previewMembershipLink(gymId, { word: word.word, typeId });
      setPreview(res.data);
    } catch (err) {
      setError(errorText(err, "We couldn't work out who would get that membership. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const give = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.linkMembershipWord(gymId, body);
      setList(res.data.list);
      setDone(doneWords(res.data.given, preview.word, preview.type.name));
      setPreview(null);
    } catch (err) {
      setError(errorText(err, "We couldn't link that. Nobody was given a membership. Please try again."));
      if (errorCode(err) === 'membership_link_changed') {
        // The box holds an older list: show the people as they are now.
        try {
          const again = await orgService.previewMembershipLink(gymId, { word: body.word, typeId: body.typeId });
          setPreview(again.data);
        } catch {
          setPreview(null);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (word) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await orgService.unlinkMembershipWord(gymId, { word: word.word });
      setList(res.data);
      setDone(`The link for ${word.word} was removed. Nobody's membership changed.`);
    } catch (err) {
      setError(errorText(err, "We couldn't remove that link. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (list === null || list.words.length === 0) return null;

  return (
    <section
      aria-label="Memberships from your list"
      className="flex flex-col gap-2 pt-4"
      style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <p className="text-sm font-semibold" style={{ color: '#fff' }}>
        Memberships from your list
      </p>
      <p className="text-sm" style={hintStyle}>
        Your member list says which membership each person has. Link each one to a membership type above, once, and
        the people who have it get that membership, with the renewal or end date from your list.
      </p>
      <ul className="flex flex-col">
        {list.words.map((word) => (
          <WordRow
            key={word.word}
            gymId={gymId}
            word={word}
            types={types}
            readOnly={readOnly}
            busy={busy}
            open={preview !== null}
            onOpen={(w, typeId) => void open(w, typeId)}
            onUnlink={(w) => void unlink(w)}
          />
        ))}
      </ul>
      {preview !== null ? (
        <LinkBox
          key={`${preview.word}-${preview.type.id}-${JSON.stringify(preview.counts)}`}
          preview={preview}
          busy={busy}
          error={error}
          onGive={(body) => void give(body)}
          onCancel={() => {
            setPreview(null);
            setError(null);
          }}
        />
      ) : error !== null ? (
        <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
          {error}
        </p>
      ) : null}
      {done !== null ? (
        <p className="text-sm" style={{ color: '#34d399' }} role="status">
          {done}
        </p>
      ) : null}
    </section>
  );
}
