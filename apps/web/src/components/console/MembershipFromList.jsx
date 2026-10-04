import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  againWords,
  archivedLine,
  asksPaid,
  boxProblem,
  boxWords,
  chooserWords,
  giveGroups,
  groupNames,
  leftOut,
  linkBody,
  nameLine,
  packNote,
  paidQuestion,
  startTicks,
  tieButton,
  undoWords,
} from '../../pages/console/membershipWordsView';
import { ConfirmInline } from './ConsoleStates';

// THE MEMBER LIST'S MEMBERSHIPS, inside Settings → Memberships (spec Part 3 §13.2;
// ROADMAP 17a-iii). A gym's member list says which membership each person has ("Gold").
// Such a name is a membership like any the gym adds by hand, so it is drawn in the
// gym's ONE list of memberships, never as a second list beside it:
//   - a name that is no type yet sits under "On your member list, not set up yet", and
//     Set up either adds it (the usual form, its name filled in) or says it is one of
//     the types above;
//   - a type the list's people should hold says so on its own row.
// Either way a box then names who gets the membership and who does not, and nothing is
// given before its button is pressed. All of it needs `members.confirm`, as the server
// asks: without it the list of memberships is drawn as it always was.

const inputStyle = { background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' };
const quietButton = { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' };
const mainButton = { background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' };
const hintStyle = { color: 'rgba(255,255,255,0.55)' };
const plainStyle = { color: 'rgba(255,255,255,0.75)' };

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

/** Who gets the membership and who does not, before anybody is given it. `counted` is
 *  whether the list's name already counts as this type. */
export function GiveBox({ preview, counted, busy, error, onGive, onCancel }) {
  const [ticks, setTicks] = useState(() => startTicks(preview));
  const [paid, setPaid] = useState(null);
  const [pressed, setPressed] = useState(false);
  const words = boxWords(preview, ticks, counted);
  const problem = boxProblem(preview, ticks, paid);
  const groups = giveGroups(preview);
  const out = leftOut(preview);
  const question = paidQuestion(preview);
  const pack = packNote(preview);
  const id = (name) => `membership-give-${name}-${preview.type.id}`;
  const boxRef = useRef(null);

  // The box opens under the whole list of memberships: bring it to whoever opened it.
  useEffect(() => {
    const box = boxRef.current;
    if (box && typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <div
      ref={boxRef}
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
        {words.button !== null ? (
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
        ) : null}
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-4 py-3 text-sm min-h-11 disabled:opacity-40" style={quietButton}>
          {words.button === null ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

/** Under one type's row: what it has to do with the member list. `ties` come from
 *  `typeTies`. */
export function TypeTies({ type, ties, off, busy, onGive, onUndo }) {
  const [asking, setAsking] = useState(null);
  if (ties.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {ties.map((tie) => {
        const undo = undoWords(tie.word);
        const open = tieButton(type, tie);
        return (
          <div key={tie.word.word} className="flex flex-col gap-2">
            <p className="text-sm" style={plainStyle}>
              {tie.text}
            </p>
            {asking === tie.word.word ? (
              <ConfirmInline
                question={undo.question}
                confirmLabel={undo.confirm}
                cancelLabel="Keep it"
                busy={busy}
                onConfirm={() => {
                  setAsking(null);
                  onUndo(tie.word);
                }}
                onCancel={() => setAsking(null)}
              />
            ) : tie.give || tie.undo ? (
              <div className="flex flex-wrap gap-2">
                {tie.give ? (
                  <button
                    type="button"
                    disabled={off}
                    onClick={() => onGive(tie.word, type)}
                    aria-label={open.aria}
                    className={`rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40 ${open.main ? 'font-semibold' : ''}`}
                    style={open.main ? mainButton : quietButton}
                  >
                    {open.label}
                  </button>
                ) : null}
                {tie.undo ? (
                  <button
                    type="button"
                    disabled={off}
                    onClick={() => setAsking(tie.word.word)}
                    className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
                    style={quietButton}
                  >
                    {undo.button}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** "Set up" on a name, in a gym that already has types: is it one of them, or new? */
function SetUpChooser({ word, types, canCreate, busy, onExisting, onNew, onCancel }) {
  const [choice, setChoice] = useState(null);
  const [typeId, setTypeId] = useState('');
  const text = chooserWords(word);
  const radio = `set-up-${word.word}`;
  const ready = choice === 'new' || (choice === 'existing' && typeId !== '');

  return (
    <div
      role="group"
      aria-label={text.question}
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <p className="text-sm font-semibold" style={{ color: '#fff' }}>
        {text.question}
      </p>
      <label className="flex items-center gap-3 min-h-11 text-sm" style={{ color: '#fff' }}>
        <input type="radio" name={radio} className="w-5 h-5" checked={choice === 'existing'} onChange={() => setChoice('existing')} />
        {text.existing}
      </label>
      {choice === 'existing' ? (
        <div className="pl-8" style={{ maxWidth: '24rem' }}>
          <select
            aria-label={`Which membership ${word.word} is`}
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            className="w-full rounded-xl px-4 py-3 text-base sm:text-sm"
            style={inputStyle}
          >
            <option value="">{text.pick}</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <label className="flex items-center gap-3 min-h-11 text-sm" style={{ color: '#fff', opacity: canCreate ? 1 : 0.45 }}>
        <input type="radio" name={radio} className="w-5 h-5" checked={choice === 'new'} disabled={!canCreate} onChange={() => setChoice('new')} />
        {text.fresh}
      </label>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => (choice === 'new' ? onNew() : onExisting(typeId))}
          className="rounded-xl px-5 py-3 text-sm font-semibold min-h-11 disabled:opacity-40"
          style={mainButton}
        >
          Continue
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-4 py-3 text-sm min-h-11 disabled:opacity-40" style={quietButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The list's names that are no type yet, each with Set up. `rows` come from
 *  `notSetUp`; `choosing` is the name whose question is open. */
export function NotSetUp({ rows, types, canCreate, off, busy, choosing, onChoose, onExisting, onNew, onUndo }) {
  const [asking, setAsking] = useState(null);
  if (rows.length === 0) return null;
  return (
    <section
      aria-label="On your member list, not set up yet"
      className="flex flex-col gap-2 pt-4"
      style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide" style={hintStyle}>
        On your member list, not set up yet
      </p>
      <p className="text-sm" style={hintStyle}>
        Your member list says people have these memberships, but they have no price here yet. Set each one up once, and
        the people who have it get it, with the renewal or end date from your list.
      </p>
      <ul className="flex flex-col">
        {rows.map((word) => {
          const archived = archivedLine(word);
          const again = againWords(word);
          return (
            <li key={word.word} className="py-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold flex-grow min-w-0" style={{ color: '#fff' }}>
                  {nameLine(word)}
                </span>
                {choosing === word.word || asking === word.word ? null : (
                  <button
                    type="button"
                    // With nothing for sale and no way to add (no country set, the list full), there is nothing to set it up as.
                    disabled={off || (archived === null && types.length === 0 && !canCreate)}
                    onClick={() => (archived === null ? onChoose(word) : setAsking(word.word))}
                    aria-label={archived === null ? `Set up ${word.word}` : `Set up ${word.word} again`}
                    className="rounded-xl px-5 py-2 text-sm font-semibold min-h-11 disabled:opacity-40"
                    style={mainButton}
                  >
                    {archived === null ? 'Set up' : 'Set up again'}
                  </button>
                )}
              </div>
              {archived !== null ? (
                <p className="text-sm" style={plainStyle}>
                  {archived}
                </p>
              ) : null}
              {asking === word.word ? (
                <ConfirmInline
                  question={again.question}
                  confirmLabel={again.confirm}
                  cancelLabel="Keep it"
                  busy={busy}
                  onConfirm={() => {
                    setAsking(null);
                    onUndo(word);
                  }}
                  onCancel={() => setAsking(null)}
                />
              ) : null}
              {choosing === word.word ? (
                <SetUpChooser
                  word={word}
                  types={types}
                  canCreate={canCreate}
                  busy={busy}
                  onExisting={(typeId) => onExisting(word, typeId)}
                  onNew={() => onNew(word)}
                  onCancel={() => onChoose(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
