import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  NAMES_PAGE,
  NAMES_SHOWN,
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

// THE MEMBER LIST'S MEMBERSHIPS, on the Memberships page (spec Part 3 §13.2; ROADMAP
// 17a-iii). A gym's member list says which membership each person has ("Gold").
// Such a name is a membership like any the gym adds by hand, so it is drawn in the
// gym's ONE list of memberships, never as a second list beside it:
//   - a name that is no type yet sits under "On your member list, not set up yet", and
//     Set up either adds it (the usual form, its name filled in) or says it is one of
//     the types above;
//   - a type the list's people should hold says so on its own row.
// Either way a box then names who gets the membership and who does not, and nothing is
// given before its button is pressed. All of it needs `members.confirm`, as the server
// asks: without it the list of memberships is drawn as it always was.
//
// Drawn from `console.css` (spec Part 3 §17).

const TICK = { accentColor: 'var(--accent)' };
const BAD = { color: 'var(--bad)' };
const LINE = { borderTop: '1px solid var(--line)' };

/** One group's people as a list, a row each with the day they will read: the first few,
 *  "and N more · See all", then a page at a time. The list sits in a frame of its own;
 *  opened, a long group scrolls inside it, so the box keeps its buttons in reach. */
function Names({ preview, group }) {
  const [shown, setShown] = useState(NAMES_SHOWN);
  const { rows, more, waiting } = groupNames(preview, group, shown);
  if (rows.length === 0) return null;
  const opened = shown > NAMES_SHOWN;
  return (
    <div className="flex flex-col gap-1">
      <ul
        data-testid={`give-names-${group}`}
        className="flex flex-col rounded-[10px] m-0 p-0 list-none"
        style={{ border: '1px solid var(--line)', ...(opened ? { maxHeight: '18rem', overflowY: 'auto' } : {}) }}
      >
        {rows.map((row, i) => (
          <li
            key={row.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-2 c-s14"
            style={i > 0 ? LINE : undefined}
          >
            <span className="c-t1">{row.name}</span>
            {row.note !== '' ? <span className="c-t2">{row.note}</span> : null}
          </li>
        ))}
      </ul>
      {more > 0 || opened ? (
        <p className="c-s14 c-t2 m-0 flex flex-wrap items-center gap-x-3">
          {more > 0 ? <span>{`and ${more.toLocaleString('en')} more`}</span> : null}
          {waiting > 0 ? (
            <button
              type="button"
              onClick={() => setShown((n) => (n <= NAMES_SHOWN ? NAMES_PAGE : n + NAMES_PAGE))}
              className="c-btn c-btn-link"
            >
              {opened ? 'Show more' : 'See all'}
            </button>
          ) : null}
          {more > 0 && waiting === 0 ? <span>To see everyone, filter Members by this membership.</span> : null}
          {opened ? (
            <button type="button" onClick={() => setShown(NAMES_SHOWN)} className="c-btn c-btn-link">
              Show fewer
            </button>
          ) : null}
        </p>
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
      className="c-card p-5 md:p-6 flex flex-col gap-5"
      style={{ borderColor: 'var(--accent)' }}
    >
      <h2 className="c-h2">{words.heading}</h2>

      {groups.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="c-th m-0">Who gets it</p>
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-1">
              <label className="flex items-start gap-3 min-h-11 c-s15 c-t1">
                <input
                  type="checkbox"
                  className="w-[18px] h-[18px] mt-0.5 flex-shrink-0"
                  style={TICK}
                  checked={ticks[g.key]}
                  onChange={() => setTicks((t) => ({ ...t, [g.key]: !t[g.key] }))}
                />
                <span className="flex flex-col">
                  <span className="c-w6">{g.title}</span>
                  <span className="c-s14 c-t2">{g.detail}</span>
                </span>
              </label>
              <div className="pl-[30px]">
                <Names preview={preview} group={g.key} />
              </div>
              {g.key === 'ask' && asksPaid(preview, ticks) ? (
                <div role="radiogroup" aria-label={question.question} className="pl-[30px] flex flex-col gap-1">
                  <span className="c-label">{question.question}</span>
                  {[
                    { value: true, label: question.yes },
                    { value: false, label: question.no },
                  ].map((choice) => (
                    <label key={String(choice.value)} className="flex items-center gap-3 min-h-11 c-s15 c-t1">
                      <input
                        type="radio"
                        name={id('paid')}
                        className="w-[18px] h-[18px] flex-shrink-0"
                        style={TICK}
                        checked={paid === choice.value}
                        onChange={() => setPaid(choice.value)}
                      />
                      {choice.label}
                    </label>
                  ))}
                  {pressed && problem !== null ? (
                    <p className="c-s14 m-0" style={BAD} role="alert">
                      {problem}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {pack !== null ? <p className="c-s14 c-t2 m-0">{pack}</p> : null}
        </div>
      ) : null}

      {out.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="c-th m-0">Who doesn&apos;t</p>
          {out.map((line) => (
            <div key={line.key} className="flex flex-col gap-1">
              <p className="c-s14 c-t2 m-0">{line.text}</p>
              {line.key === 'past' ? null : <Names preview={preview} group={line.key} />}
            </div>
          ))}
        </div>
      ) : null}

      {words.nobody !== null ? (
        <p className="c-s14 c-t2 m-0">{words.nobody}</p>
      ) : (
        <p className="c-s14 c-t3 m-0">
          No money is taken and nobody is emailed. You can change or cancel a membership on each person&apos;s page.
        </p>
      )}

      {error !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
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
            className="c-btn c-btn-p"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {words.button}
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={onCancel} className="c-btn c-btn-s">
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
            <p className="c-s14 c-t2 m-0">{tie.text}</p>
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
                newLook
              />
            ) : tie.give || tie.undo ? (
              <div className="flex flex-wrap gap-2">
                {tie.give ? (
                  <button
                    type="button"
                    disabled={off}
                    onClick={() => onGive(tie.word, type)}
                    aria-label={open.aria}
                    className={open.main ? 'c-btn c-btn-soft c-btn-sm' : 'c-btn c-btn-s c-btn-sm'}
                  >
                    {open.label}
                  </button>
                ) : null}
                {tie.undo ? (
                  <button
                    type="button"
                    disabled={off}
                    onClick={() => setAsking(tie.word.word)}
                    className="c-btn c-btn-s c-btn-sm"
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
      className="rounded-[14px] p-4 md:p-5 flex flex-col gap-2"
      style={{ background: 'var(--raise)' }}
    >
      <p className="c-s15 c-w6 c-t1 m-0">{text.question}</p>
      <label className="flex items-center gap-3 min-h-11 c-s15 c-t1">
        <input type="radio" name={radio} className="w-[18px] h-[18px] flex-shrink-0" style={TICK} checked={choice === 'existing'} onChange={() => setChoice('existing')} />
        {text.existing}
      </label>
      {choice === 'existing' ? (
        <div className="pl-[30px]" style={{ maxWidth: '24rem' }}>
          <select
            aria-label={`Which membership ${word.word} is`}
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            className="c-input"
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
      <label className="flex items-center gap-3 min-h-11 c-s15 c-t1" style={{ opacity: canCreate ? 1 : 0.5 }}>
        <input type="radio" name={radio} className="w-[18px] h-[18px] flex-shrink-0" style={TICK} checked={choice === 'new'} disabled={!canCreate} onChange={() => setChoice('new')} />
        {text.fresh}
      </label>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => (choice === 'new' ? onNew() : onExisting(typeId))}
          className="c-btn c-btn-p"
        >
          Continue
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="c-btn c-btn-s">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The list's names that are no type yet, each with Set up. `rows` come from
 *  `notSetUp`; `choosing` is the name whose question is open; `formFor` is the name being
 *  added as a new type, and `form` its form, drawn in that name's row. */
export function NotSetUp({ rows, types, canCreate, off, busy, choosing, formFor = null, form = null, onChoose, onExisting, onNew, onUndo }) {
  const [asking, setAsking] = useState(null);
  if (rows.length === 0) return null;
  return (
    <section aria-label="On your member list, not set up yet" className="c-card overflow-hidden">
      <div className="flex flex-col gap-1 px-5 pt-5 pb-4 md:px-6">
        <h2 className="c-h2">On your member list, not set up yet</h2>
        <p className="c-s14 c-t2 m-0" style={{ maxWidth: 640 }}>
          Your member list says people have these memberships, but they have no price here yet. Set each one up once,
          and the people who have it get it, with the renewal or end date from your list.
        </p>
      </div>
      <ul className="flex flex-col m-0 p-0 list-none">
        {rows.map((word) => {
          const archived = archivedLine(word);
          const again = againWords(word);
          return (
            <li key={word.word} className="px-5 py-4 md:px-6 flex flex-col gap-3" style={LINE}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="c-s15 c-w6 c-t1 flex-grow min-w-0 break-words">{nameLine(word)}</span>
                {choosing === word.word || asking === word.word || formFor === word.word ? null : (
                  <button
                    type="button"
                    // With nothing for sale and no way to add (no country set, the list full), there is nothing to set it up as.
                    disabled={off || (archived === null && types.length === 0 && !canCreate)}
                    onClick={() => (archived === null ? onChoose(word) : setAsking(word.word))}
                    aria-label={archived === null ? `Set up ${word.word}` : `Set up ${word.word} again`}
                    className="c-btn c-btn-soft c-btn-sm"
                  >
                    {archived === null ? 'Set up' : 'Set up again'}
                  </button>
                )}
              </div>
              {archived !== null ? <p className="c-s14 c-t2 m-0">{archived}</p> : null}
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
                  newLook
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
              {formFor === word.word ? form : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
