import { useCallback, useEffect, useRef, useState } from 'react';
import { MEMBERSHIP_DESCRIPTION_MAX, MEMBERSHIP_NAME_MAX, orgWords } from '@app/shared';
import { Loader2, Plus } from 'lucide-react';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { placeFor } from '../../pages/console/consolePlaces';
import {
  ACCESS_CHOICES,
  KIND_CHOICES,
  LIMIT_PERIOD_CHOICES,
  PT_LIMIT_CHOICES,
  canLimitPt,
  draftLimitsPt,
  NOT_SAVED,
  TOO_MANY_TYPES,
  archivedNote,
  canAddType,
  classOptions,
  draftBody,
  draftFromType,
  draftIncludesPt,
  draftProblems,
  emptyDraft,
  firstProblem,
  includesLine,
  kindTag,
  packForPtOnly,
  priceExample,
  termLine,
  termUnitOptions,
  typesSummary,
  withChoice,
} from '../../pages/console/membershipTypesView';
import { formWordsFor, notSetUp, typeTies, withSetUpCount } from '../../pages/console/membershipWordsView';
import { ConfirmInline, ConsoleFailed, ConsoleLoading } from './ConsoleStates';
import BillSettingsCard from './BillSettingsCard';
import PlaceLink from './PlaceLink';
import { GiveBox, NotSetUp, TypeTies } from './MembershipFromList';
import { useListMemberships } from './useListMemberships';

// THE MEMBERSHIPS PAGE (spec Part 3 §13.1; ROADMAP 17a-i, a page of its own since 23c-i),
// on `memberships.manage` as the server gates the changes. What the gym sells: a name, a
// kind, a price in the gym's own money, how long it lasts or how many classes it holds,
// and what it includes. Nothing is deleted: a type is archived and can be put back. The
// form saves with its own button and nothing in it is saved before that.
//
// The memberships a gym's member list names are part of this one list (17a-iii;
// `MembershipFromList.jsx`): a name that is no type yet is set up here, with this same
// form, and a type the list's people should hold says so on its own row.
//
// Drawn from `console.css` (spec Part 3 §17). A new type's form opens under the title;
// a type being changed, and a list's name being set up, open their form where they are.

const TICK = { accentColor: 'var(--accent)' };
const BAD = { color: 'var(--bad)' };
const LINE = { borderTop: '1px solid var(--line)' };

function Problem({ text }) {
  if (!text) return null;
  return (
    <p className="c-s14 m-0" style={BAD}>
      {text}
    </p>
  );
}

function Field({ id, label, children, problem }) {
  return (
    <div className="c-field">
      <label htmlFor={id} className="c-label">
        {label}
      </label>
      {children}
      <Problem text={problem} />
    </div>
  );
}

/** One part of the form, under its own small heading. */
function Part({ title, children }) {
  return (
    <fieldset className="flex flex-col gap-4 pt-4" style={LINE}>
      <legend className="c-s14 c-w6 c-t2 pr-2">{title}</legend>
      {children}
    </fieldset>
  );
}

/** `inRow`: the form is inside a row of a list, under that list's own heading.
 *  `error`: why the server refused the last save, said beside the button that sent it. */
function TypeForm({ gymId, currency, options, draft, setDraft, problems, refused, busy, forWord, error, inRow, onSave, onCancel }) {
  const editing = draft.id !== null;
  const title = editing ? 'Change membership type' : (forWord?.heading ?? 'Add a membership type');
  const id = (name) => `membership-${name}-${gymId}`;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const text = (key) => (event) => set({ [key]: event.target.value });
  const choice = draft.choice;
  const hasTerm = choice === 'recurring' || choice === 'one_time' || choice === 'trial';
  const picksClasses = !(hasTerm && draft.access === 'gym_only') && options.length > 0;
  const toggleClass = (classId) =>
    set({ classIds: draft.classIds.includes(classId) ? draft.classIds.filter((c) => c !== classId) : [...draft.classIds, classId] });
  const first = firstProblem(problems);
  const formRef = useRef(null);
  const Heading = inRow ? 'h3' : 'h2';

  // A refused save shows its first wrong box: the button is at the bottom of a long form,
  // and a sentence under a box that has scrolled away is a sentence nobody reads. Once a
  // press, never while the person types.
  useEffect(() => {
    if (refused === 0) return;
    const box = formRef.current?.querySelector('[aria-invalid="true"]');
    if (!box) return;
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'center' });
    box.focus({ preventScroll: true });
  }, [refused]);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className="flex flex-col gap-5"
      aria-label={title}
    >
      <div className="flex flex-col gap-1">
        <Heading className={inRow ? 'c-h3' : 'c-h2'}>{title}</Heading>
        <p className="c-s14 c-t2 m-0">
          {forWord?.hint ?? 'Make it your own: give it your name and price, then say how it is paid and what it includes.'}
        </p>
      </div>

      <Field id={id('name')} label="Name" problem={problems?.name}>
        <input
          id={id('name')}
          aria-invalid={problems?.name ? 'true' : undefined}
          value={draft.name}
          maxLength={MEMBERSHIP_NAME_MAX}
          onChange={text('name')}
          placeholder="For example: Gold Monthly"
          className="c-input"
        />
      </Field>

      <Field id={id('description')} label="Description (optional)" problem={problems?.description}>
        <input
          id={id('description')}
          aria-invalid={problems?.description ? 'true' : undefined}
          value={draft.description}
          maxLength={MEMBERSHIP_DESCRIPTION_MAX}
          onChange={text('description')}
          placeholder="For example: All classes and open gym"
          className="c-input"
        />
      </Field>

      <Part title="Price and payment">
        <div role="radiogroup" aria-label="How is it paid?" className="flex flex-col gap-2">
          <span className="c-label">How is it paid?</span>
          {KIND_CHOICES.map((k) => {
            const picked = choice === k.value;
            return (
              <label
                key={k.value}
                className="flex items-start gap-3 rounded-[10px] px-3 py-2.5 min-h-11"
                style={{
                  background: picked ? 'var(--soft)' : 'transparent',
                  border: `1px solid ${picked ? 'var(--accent)' : 'var(--ctl-line)'}`,
                  opacity: editing && !picked ? 0.5 : 1,
                }}
              >
                <input
                  type="radio"
                  name={id('kind')}
                  className="w-[18px] h-[18px] mt-0.5 flex-shrink-0"
                  style={TICK}
                  value={k.value}
                  checked={picked}
                  disabled={editing}
                  onChange={() => setDraft((d) => withChoice(d, k.value))}
                />
                <span className="flex flex-col">
                  <span className="c-s15 c-w6 c-t1">{k.label}</span>
                  <span className="c-s14 c-t2">{k.hint}</span>
                </span>
              </label>
            );
          })}
          {/* Said while adding too, when there is still a choice to make (Kd's click-through). */}
          <p className="c-s14 c-t2 m-0">
            {editing
              ? "How it is paid can't be changed once it is saved. To sell it another way, archive this one and add a new one."
              : "How it is paid can't be changed once it is saved. To sell it another way later, archive this one and add a new one."}
          </p>
        </div>

        <Field id={id('price')} label={`Price (${currency})`} problem={problems?.price}>
          <input
            id={id('price')}
            aria-invalid={problems?.price ? 'true' : undefined}
            value={draft.price}
            inputMode="decimal"
            onChange={text('price')}
            placeholder={`For example: ${priceExample(currency)}`}
            className="c-input"
            style={{ maxWidth: 240 }}
          />
        </Field>

        {hasTerm ? (
          <Field
            id={id('term-count')}
            label={choice === 'recurring' ? 'Charged every' : 'How long it lasts'}
            problem={problems?.termCount}
          >
            <div className="flex gap-2" style={{ maxWidth: 360 }}>
              <input
                id={id('term-count')}
                aria-invalid={problems?.termCount ? 'true' : undefined}
                value={draft.termCount}
                inputMode="numeric"
                onChange={text('termCount')}
                className="c-input"
                style={{ width: 104, flexShrink: 0 }}
              />
              <select
                aria-label={choice === 'recurring' ? 'Charged every: weeks, months or years' : 'How long it lasts: days, weeks, months or years'}
                value={draft.termUnit}
                onChange={text('termUnit')}
                className="c-input"
              >
                {termUnitOptions(choice).map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        ) : null}

        {choice === 'pack' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ maxWidth: 480 }}>
            <Field id={id('pack-classes')} label="Classes in the pack" problem={problems?.packClasses}>
              <input id={id('pack-classes')} aria-invalid={problems?.packClasses ? 'true' : undefined} value={draft.packClasses} inputMode="numeric" onChange={text('packClasses')} className="c-input" />
            </Field>
            <Field id={id('pack-days')} label="Days to use them in" problem={problems?.packDays}>
              <input id={id('pack-days')} aria-invalid={problems?.packDays ? 'true' : undefined} value={draft.packDays} inputMode="numeric" onChange={text('packDays')} className="c-input" />
            </Field>
          </div>
        ) : null}
      </Part>

      {hasTerm || picksClasses || choice === 'pack' ? (
        <Part title="What it includes">
          {hasTerm ? (
            <Field id={id('access')} label="Classes">
              <select id={id('access')} value={draft.access} onChange={text('access')} className="c-input">
                {ACCESS_CHOICES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {hasTerm && draft.access === 'limited' ? (
            <Field id={id('limit')} label="How many classes" problem={problems?.bookingsLimit}>
              <div className="flex gap-2" style={{ maxWidth: 360 }}>
                <input
                  id={id('limit')}
                  aria-invalid={problems?.bookingsLimit ? 'true' : undefined}
                  value={draft.bookingsLimit}
                  inputMode="numeric"
                  onChange={text('bookingsLimit')}
                  className="c-input"
                  style={{ width: 104, flexShrink: 0 }}
                />
                <select aria-label="How many classes: a week or a month" value={draft.bookingsPeriod} onChange={text('bookingsPeriod')} className="c-input">
                  {LIMIT_PERIOD_CHOICES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          ) : null}

          {picksClasses ? (
            <Field id={id('scope')} label="Which classes" problem={problems?.classes}>
              <select id={id('scope')} aria-invalid={problems?.classes ? 'true' : undefined} value={draft.classScope} onChange={text('classScope')} className="c-input">
                <option value="all">Every class</option>
                <option value="some">Only the classes I tick</option>
                {choice === 'pack' ? <option value="none">No classes: personal training only</option> : null}
              </select>
              {draft.classScope === 'some' ? (
                <div className="flex flex-col mt-1">
                  {options.map((option) => (
                    <label key={option.id} className="flex items-center gap-3 min-h-11 c-s15 c-t1">
                      <input
                        type="checkbox"
                        className="w-[18px] h-[18px] flex-shrink-0"
                        style={TICK}
                        checked={draft.classIds.includes(option.id)}
                        onChange={() => toggleClass(option.id)}
                      />
                      {option.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </Field>
          ) : null}

          {choice !== 'day_pass' ? (
            <label className="flex items-start gap-3 min-h-11 c-s15 c-t1">
              <input
                type="checkbox"
                className="w-[18px] h-[18px] mt-0.5 flex-shrink-0"
                style={TICK}
                checked={draftIncludesPt(draft)}
                disabled={packForPtOnly(draft)}
                onChange={(event) => set({ includesPt: event.target.checked })}
              />
              <span className="flex flex-col gap-0.5">
                <span>Includes personal training</span>
                <span className="c-s14 c-t2">
                  {choice === 'pack'
                    ? 'Each session booked with a trainer uses one from the pack.'
                    : 'Sessions with a trainer can be booked on this membership.'}
                </span>
              </span>
            </label>
          ) : null}

          {canLimitPt(draft) ? (
            <Field id={id('pt-access')} label="Personal training sessions">
              <select id={id('pt-access')} value={draft.ptAccess} onChange={text('ptAccess')} className="c-input">
                {PT_LIMIT_CHOICES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {draftLimitsPt(draft) ? (
            <Field id={id('pt-limit')} label="How many sessions" problem={problems?.ptLimit}>
              <div className="flex gap-2" style={{ maxWidth: 360 }}>
                <input
                  id={id('pt-limit')}
                  aria-invalid={problems?.ptLimit ? 'true' : undefined}
                  value={draft.ptLimit}
                  inputMode="numeric"
                  onChange={text('ptLimit')}
                  className="c-input"
                  style={{ width: 104, flexShrink: 0 }}
                />
                <select aria-label="How many sessions: a week or a month" value={draft.ptPeriod} onChange={text('ptPeriod')} className="c-input">
                  {LIMIT_PERIOD_CHOICES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="c-s14 c-t2">
                A week is Monday to Sunday; a month is the calendar month. Sessions not used are not carried over. Past the limit, a pack pays if the person has one.
              </span>
            </Field>
          ) : null}
        </Part>
      ) : null}

      <div className="flex flex-col gap-3">
        {first !== null ? (
          <p className="c-s14 c-w6 m-0" style={BAD} role="alert">
            {NOT_SAVED}
          </p>
        ) : null}
        {error ? (
          <p className="c-s14 m-0" style={BAD} role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="c-btn c-btn-p">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {editing ? 'Save changes' : 'Add membership type'}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className="c-btn c-btn-s">
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

/** `form`: this type's own form while it is being changed, or null. */
function TypeRow({ type, readOnly, busy, formOpen, ties, form, onEdit, onArchive, onGive, onUndo }) {
  const [asking, setAsking] = useState(false);
  return (
    <li className="px-5 py-4 md:px-6 flex flex-col gap-3" style={LINE}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="c-s15 c-w6 c-t1 break-words min-w-0">{type.name}</span>
            <span className="c-tag c-tag-plain">{kindTag(type)}</span>
          </div>
          {type.description ? <p className="c-s14 c-t2 m-0 break-words">{type.description}</p> : null}
          <p className="c-s14 c-t1 m-0">{termLine(type)}</p>
          <p className="c-s14 c-t2 m-0">{includesLine(type)}</p>
        </div>
        {asking ? null : (
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={readOnly || busy || formOpen}
              onClick={() => onEdit(type)}
              aria-label={`Change ${type.name}`}
              className="c-btn c-btn-s c-btn-sm"
            >
              Change
            </button>
            <button
              type="button"
              disabled={readOnly || busy || formOpen}
              onClick={() => setAsking(true)}
              aria-label={`Archive ${type.name}`}
              className="c-btn c-btn-s c-btn-sm"
            >
              Archive
            </button>
          </div>
        )}
      </div>
      <TypeTies type={type} ties={ties} off={readOnly || busy || formOpen} busy={busy} onGive={onGive} onUndo={onUndo} />
      {asking ? (
        <ConfirmInline
          question={`Archive ${type.name}? It leaves your list of what you sell. Nothing is deleted, and you can put it back.`}
          confirmLabel="Archive"
          busy={busy}
          onConfirm={() => {
            setAsking(false);
            onArchive(type);
          }}
          onCancel={() => setAsking(false)}
          newLook
        />
      ) : null}
      {form}
    </li>
  );
}

/** What the last press did, or why it failed, brought into view: the row that was pressed
 *  may be a long way up the page. */
function Notes({ error, listError, done }) {
  const ref = useRef(null);
  const shown = error ?? listError ?? done;
  useEffect(() => {
    const box = ref.current;
    if (shown && box && typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
  }, [shown]);
  if (!shown) return null;
  return (
    <div ref={ref} className="flex flex-col gap-2">
      {error ? (
        <p className="c-s15 m-0" style={BAD} role="alert">
          {error}
        </p>
      ) : null}
      {listError ? (
        <p className="c-s15 m-0" style={BAD} role="alert">
          {listError}
        </p>
      ) : null}
      {done ? (
        <p className="c-s15 m-0" style={{ color: 'var(--good)' }} role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}

export default function MembershipTypesPanel({ org, readOnly }) {
  const gymId = org.id;
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [showProblems, setShowProblems] = useState(false);
  const [refused, setRefused] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  // The name from the member list the form was opened for, and the name whose
  // "Set up" question is open.
  const [draftWord, setDraftWord] = useState(null);
  const [choosing, setChoosing] = useState(null);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getMembershipTypes(gymId)
        .then((res) => {
          if (!isLive()) return;
          setList(res.data);
          setLoadError(null);
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your membership types."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const run = async (request, fallback) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await request();
      setList(res.data);
      return res.data;
    } catch (err) {
      setActionError(errorText(err, fallback));
      if (errorCode(err) === 'membership_type_changed') {
        // The form holds an older version: show the list as it is now, the form closed.
        setDraft(null);
        setDraftWord(null);
        setShowProblems(false);
        setRefused(0);
        void load();
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const editing = draft !== null && draft.id !== null ? (list?.types ?? []).find((t) => t.id === draft.id) : undefined;
  // A type is changed in the money it was made in; a new one is in the gym's.
  const draftCurrency = editing?.currency ?? list?.currency ?? null;
  const problems = draft !== null && draftCurrency !== null ? draftProblems(draft, draftCurrency) : null;

  const closeForm = () => {
    setDraft(null);
    setDraftWord(null);
    setShowProblems(false);
    setRefused(0);
    setActionError(null);
  };

  const fromList = useListMemberships(gymId, list?.types);
  const anyBusy = busy || fromList.busy;
  // One thing at a time: a form, a "Set up" question or the box of who gets it.
  const locked = draft !== null || choosing !== null || fromList.preview !== null;

  const save = async () => {
    setShowProblems(true);
    if (draft !== null && problems !== null) setRefused((n) => n + 1);
    if (draft === null || draftCurrency === null || problems !== null || readOnly || busy) return;
    const body = draftBody(draft, draftCurrency);
    const had = new Set((list?.types ?? []).map((t) => t.id));
    const forWord = draftWord;
    const saved =
      draft.id === null
        ? await run(() => orgService.createMembershipType(gymId, body), "We couldn't add that membership type. Please try again.")
        : await run(() => orgService.updateMembershipType(gymId, draft.id, body), "We couldn't save that change. Please try again.");
    if (saved === null) return;
    closeForm();
    // Added for a name from the member list: next, who gets it.
    const made = forWord === null ? undefined : saved.types.find((t) => !had.has(t.id));
    if (forWord !== null && made !== undefined) void fromList.open(forWord.word, made.id);
  };

  /** "Set up" on a name from the member list: the form with its name filled in. */
  const setUpAsNew = (word) => {
    setChoosing(null);
    setActionError(null);
    setShowProblems(false);
    setDraftWord(word);
    setDraft({ ...emptyDraft(), name: word.word });
  };

  const startDraft = (next) => {
    setActionError(null);
    setShowProblems(false);
    setDraft(next);
  };

  const formOpen = draft !== null && draftCurrency !== null;
  // Where the open form is drawn: under the title for a new type, in its own row for a
  // type being changed, in the name's row for a name from the member list.
  // A row that has gone from the list (archived by somebody else, a name that became a
  // type) cannot hold it, so it is drawn under the title: a form is never open and unseen.
  const hasRow = formOpen && draft.id !== null && (list?.types ?? []).some((t) => t.id === draft.id);
  const hasWord = formOpen && draftWord !== null && notSetUp(fromList.words).some((w) => w.word === draftWord.word);
  const formAt = !formOpen ? null : hasRow ? 'row' : draft.id === null && hasWord ? 'word' : 'top';
  const form = formOpen ? (
    <TypeForm
      gymId={gymId}
      currency={draftCurrency}
      options={classOptions(list, editing)}
      draft={draft}
      setDraft={setDraft}
      problems={showProblems ? problems : null}
      refused={refused}
      busy={busy}
      forWord={draftWord === null ? null : formWordsFor(draftWord)}
      error={actionError}
      inRow={formAt !== 'top'}
      onSave={() => void save()}
      onCancel={closeForm}
    />
  ) : null;
  const inRow = (node) => (
    <div className="rounded-[14px] p-4 md:p-5" style={{ background: 'var(--raise)' }}>
      {node}
    </div>
  );
  const summary = withSetUpCount(typesSummary(list), fromList.words);
  // The country is a box in Settings' details section ("Gym details", "Studio details"),
  // for whoever may change them: its button opens Settings there, at that box.
  const countryTo = placeFor(org.slug, viewerPrivileges(org), 'country');
  const canSetCountry = countryTo !== null;
  const details = `${orgWords(org.orgType).itCap} details`;

  return (
    <div className="c-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Memberships</h1>
          {org.name ? <p className="c-sub">{org.name}</p> : null}
          <p className="c-s15 c-t2 m-0" style={{ maxWidth: 640 }}>
            Your own list of what you sell. You name each one, set its price, and choose how it is paid and what it
            includes.
            {list?.currency ? ` New prices are in ${list.currency}.` : ''}
          </p>
        </div>
        {list !== null && loadError === null && !formOpen && list.currency !== null && canAddType(list) ? (
          <button
            type="button"
            disabled={readOnly || anyBusy || locked}
            onClick={() => startDraft(emptyDraft())}
            className="c-btn c-btn-p w-full md:w-auto flex-shrink-0"
          >
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add a membership type
          </button>
        ) : null}
      </header>

      {/* A gym with no live plan sees everything and changes nothing (§4.2). */}
      {readOnly ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2 m-0">{readOnlyNote(org.orgType)}</p>
        </section>
      ) : null}

      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={() => void load()} newLook />
      ) : list === null ? (
        <ConsoleLoading label="Loading your membership types…" newLook />
      ) : (
        <>
          {formOpen ? null : list.currency === null ? (
            <div className="c-callout flex-col items-start">
              <p className="c-s15 m-0">
                {canSetCountry
                  ? `Set your country in ${details} before adding a membership type. Prices are in your country's own money.`
                  : `Your country isn't set yet, so a membership type can't be added. Ask the owner to set it in ${details}. Prices are in your country's own money.`}
              </p>
              <PlaceLink to={countryTo} className="c-btn c-btn-s">
                Set your country
              </PlaceLink>
            </div>
          ) : canAddType(list) ? null : (
            <p className="c-s15 c-t2 m-0">{TOO_MANY_TYPES}</p>
          )}

          {formAt === 'top' ? <section className="c-card c-narrow p-5 md:p-6">{form}</section> : null}

          <section className="c-card overflow-hidden" aria-label="What you sell">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5 pb-4 md:px-6">
              <h2 className="c-h2">What you sell</h2>
              {summary ? <span className="c-s14 c-t3">{summary}</span> : null}
            </div>
            {list.types.length > 0 ? (
              <ul className="flex flex-col m-0 p-0 list-none">
                {list.types.map((type) => (
                  <TypeRow
                    key={type.id}
                    type={type}
                    readOnly={readOnly}
                    busy={anyBusy}
                    formOpen={locked}
                    ties={typeTies(type, fromList.words)}
                    form={formAt === 'row' && draft.id === type.id ? inRow(form) : null}
                    onGive={(word, t) => void fromList.open(word.word, t.id)}
                    onUndo={(word) => void fromList.undo(word)}
                    onEdit={(t) => startDraft(draftFromType(t))}
                    onArchive={(t) => {
                      if (draft?.id === t.id) closeForm();
                      void run(() => orgService.archiveMembershipType(gymId, t.id), "We couldn't archive that. Please try again.");
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="c-s15 c-t2 m-0 px-5 pb-5 md:px-6 md:pb-6" style={{ maxWidth: 640 }}>
                You haven&apos;t added anything yet. Add each thing you sell, with your own name and price: a monthly
                membership, a 10-class pack, a day pass, a free trial week.
              </p>
            )}
          </section>

          <NotSetUp
            rows={notSetUp(fromList.words)}
            types={list.types}
            canCreate={list.currency !== null && canAddType(list)}
            off={readOnly || anyBusy || locked}
            busy={anyBusy}
            choosing={choosing}
            formFor={formAt === 'word' ? draftWord.word : null}
            form={formAt === 'word' ? inRow(form) : null}
            // With nothing for sale yet there is nothing to choose between: straight to the form.
            onChoose={(word) => (word !== null && list.types.length === 0 ? setUpAsNew(word) : setChoosing(word === null ? null : word.word))}
            onExisting={(word, typeId) => {
              setChoosing(null);
              void fromList.open(word.word, typeId);
            }}
            onNew={setUpAsNew}
            onUndo={(word) => void fromList.undo(word)}
          />

          {fromList.preview !== null ? (
            <GiveBox
              key={`${fromList.preview.word}-${fromList.preview.type.id}-${JSON.stringify(fromList.preview.counts)}`}
              preview={fromList.preview}
              counted={fromList.words.some((w) => w.word === fromList.preview.word && w.link !== null && w.link.typeId === fromList.preview.type.id)}
              busy={fromList.busy}
              error={fromList.error}
              onGive={(body) => void fromList.give(body)}
              onCancel={fromList.closeBox}
            />
          ) : null}

          {/* A refused save is said in the form, beside its button. */}
          <Notes
            error={formOpen ? null : actionError}
            listError={fromList.preview === null ? fromList.error : null}
            done={fromList.done}
          />

          {list.archivedTotal > 0 ? (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="c-btn c-btn-s self-start"
              >
                {showArchived ? 'Hide archived' : `Show archived (${String(list.archivedTotal)})`}
              </button>
              {showArchived ? (
                <>
                  <section className="c-card overflow-hidden" aria-label="Archived">
                    <ul className="flex flex-col m-0 p-0 list-none">
                      {list.archived.map((type, i) => (
                        <li key={type.id} className="px-5 py-3 md:px-6 flex flex-wrap items-center gap-3" style={i > 0 ? LINE : undefined}>
                          <div className="flex flex-col flex-grow min-w-0">
                            <span className="c-s15 c-w6 c-t2 break-words">{type.name}</span>
                            <span className="c-s14 c-t3">
                              {kindTag(type)} · {termLine(type)}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={readOnly || anyBusy || locked}
                            onClick={() => void run(() => orgService.restoreMembershipType(gymId, type.id), "We couldn't put that back. Please try again.")}
                            aria-label={`Put back ${type.name}`}
                            className="c-btn c-btn-s c-btn-sm"
                          >
                            Put back
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                  {archivedNote(list) !== null ? <p className="c-s14 c-t2 m-0">{archivedNote(list)}</p> : null}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {/* The gym's one setting for bills (18a-i), under the price list they are made from. */}
      {formOpen ? null : <BillSettingsCard gymId={gymId} readOnly={readOnly} readOnlyLine={readOnlyNote(org.orgType)} />}
    </div>
  );
}
