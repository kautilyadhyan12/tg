import { useCallback, useEffect, useRef, useState } from 'react';
import { MEMBERSHIP_DESCRIPTION_MAX, MEMBERSHIP_NAME_MAX } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  ACCESS_CHOICES,
  KIND_CHOICES,
  LIMIT_PERIOD_CHOICES,
  NOT_SAVED,
  TOO_MANY_TYPES,
  archivedNote,
  canAddType,
  classOptions,
  draftBody,
  draftFromType,
  draftProblems,
  emptyDraft,
  firstProblem,
  includesLine,
  kindTag,
  priceExample,
  termLine,
  termUnitOptions,
  typesSummary,
  withChoice,
} from '../../pages/console/membershipTypesView';
import { ConfirmInline, ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// SETTINGS → MEMBERSHIPS (spec Part 3 §13.1; ROADMAP 17a-i), on `memberships.manage` as
// the server gates the changes. What the gym sells: a name, a kind, a price in the gym's
// own money, how long it lasts or how many classes it holds, and what it includes.
// Nothing is deleted: a type is archived and can be put back. The form saves with its
// own button and nothing in it is saved before that.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};
const quietButton = { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' };
const mainButton = { background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' };
const labelStyle = { color: 'rgba(255,255,255,0.75)' };
const hintStyle = { color: 'rgba(255,255,255,0.55)' };
const inputClass = 'w-full rounded-xl px-4 py-3 text-base sm:text-sm';

function Problem({ text }) {
  if (!text) return null;
  return (
    <p className="text-sm" style={{ color: '#ef4444' }}>
      {text}
    </p>
  );
}

function Field({ id, label, children, problem }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium" style={labelStyle}>
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
    <fieldset className="flex flex-col gap-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <legend className="text-xs font-semibold uppercase tracking-wide pr-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function TypeForm({ gymId, currency, options, draft, setDraft, problems, refused, busy, onSave, onCancel }) {
  const editing = draft.id !== null;
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
      className="rounded-xl p-4 flex flex-col gap-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      aria-label={editing ? 'Change membership type' : 'Add a membership type'}
    >
      <div>
        <p className="text-sm font-semibold" style={{ color: '#fff' }}>
          {editing ? 'Change membership type' : 'Add a membership type'}
        </p>
        <p className="text-sm mt-1" style={hintStyle}>
          Make it your own: give it your name and price, then say how it is paid and what it includes.
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
          className={inputClass}
          style={inputStyle}
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
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      <Part title="Price and payment">
        <div role="radiogroup" aria-label="How is it paid?" className="flex flex-col gap-1">
          <span className="text-sm font-medium" style={labelStyle}>
            How is it paid?
          </span>
          {KIND_CHOICES.map((k) => (
            <label
              key={k.value}
              className="flex items-start gap-3 rounded-xl px-3 py-2 min-h-11"
              style={{
                background: choice === k.value ? 'rgba(255,138,31,0.10)' : 'transparent',
                border: `1px solid ${choice === k.value ? 'rgba(255,138,31,0.45)' : 'rgba(255,255,255,0.08)'}`,
                opacity: editing && choice !== k.value ? 0.45 : 1,
              }}
            >
              <input
                type="radio"
                name={id('kind')}
                className="w-5 h-5 mt-0.5"
                value={k.value}
                checked={choice === k.value}
                disabled={editing}
                onChange={() => setDraft((d) => withChoice(d, k.value))}
              />
              <span className="flex flex-col">
                <span className="text-sm font-semibold" style={{ color: '#fff' }}>
                  {k.label}
                </span>
                <span className="text-sm" style={hintStyle}>
                  {k.hint}
                </span>
              </span>
            </label>
          ))}
          {editing ? (
            <p className="text-sm" style={hintStyle}>
              How it is paid can&apos;t be changed once it is saved. To sell it another way, archive this one and add a new one.
            </p>
          ) : null}
        </div>

        <Field id={id('price')} label={`Price (${currency})`} problem={problems?.price}>
          <input
            id={id('price')}
            aria-invalid={problems?.price ? 'true' : undefined}
            value={draft.price}
            inputMode="decimal"
            onChange={text('price')}
            placeholder={`For example: ${priceExample(currency)}`}
            className={inputClass}
            style={inputStyle}
          />
        </Field>

        {hasTerm ? (
          <Field
            id={id('term-count')}
            label={choice === 'recurring' ? 'Charged every' : 'How long it lasts'}
            problem={problems?.termCount}
          >
            <div className="flex gap-2">
              <input
                id={id('term-count')}
                aria-invalid={problems?.termCount ? 'true' : undefined}
                value={draft.termCount}
                inputMode="numeric"
                onChange={text('termCount')}
                className={inputClass}
                style={inputStyle}
              />
              <select
                aria-label={choice === 'recurring' ? 'Charged every: weeks, months or years' : 'How long it lasts: days, weeks, months or years'}
                value={draft.termUnit}
                onChange={text('termUnit')}
                className={inputClass}
                style={inputStyle}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id={id('pack-classes')} label="Classes in the pack" problem={problems?.packClasses}>
              <input id={id('pack-classes')} aria-invalid={problems?.packClasses ? 'true' : undefined} value={draft.packClasses} inputMode="numeric" onChange={text('packClasses')} className={inputClass} style={inputStyle} />
            </Field>
            <Field id={id('pack-days')} label="Days to use them in" problem={problems?.packDays}>
              <input id={id('pack-days')} aria-invalid={problems?.packDays ? 'true' : undefined} value={draft.packDays} inputMode="numeric" onChange={text('packDays')} className={inputClass} style={inputStyle} />
            </Field>
          </div>
        ) : null}
      </Part>

      {hasTerm || picksClasses ? (
        <Part title="What it includes">
          {hasTerm ? (
            <Field id={id('access')} label="Classes">
              <select id={id('access')} value={draft.access} onChange={text('access')} className={inputClass} style={inputStyle}>
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
              <div className="flex gap-2">
                <input
                  id={id('limit')}
                  aria-invalid={problems?.bookingsLimit ? 'true' : undefined}
                  value={draft.bookingsLimit}
                  inputMode="numeric"
                  onChange={text('bookingsLimit')}
                  className={inputClass}
                  style={inputStyle}
                />
                <select aria-label="How many classes: a week or a month" value={draft.bookingsPeriod} onChange={text('bookingsPeriod')} className={inputClass} style={inputStyle}>
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
              <select id={id('scope')} aria-invalid={problems?.classes ? 'true' : undefined} value={draft.classScope} onChange={text('classScope')} className={inputClass} style={inputStyle}>
                <option value="all">Every class</option>
                <option value="some">Only the classes I tick</option>
              </select>
              {draft.classScope === 'some' ? (
                <div className="flex flex-col mt-1">
                  {options.map((option) => (
                    <label key={option.id} className="flex items-center gap-3 min-h-11 text-sm" style={{ color: '#fff' }}>
                      <input
                        type="checkbox"
                        className="w-5 h-5"
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
        </Part>
      ) : null}

      <div className="flex flex-col gap-2">
        {first !== null ? (
          <p className="text-sm font-semibold" style={{ color: '#ef4444' }} role="alert">
            {NOT_SAVED}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40"
            style={mainButton}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {editing ? 'Save changes' : 'Add membership type'}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-4 py-3 text-sm min-h-11 disabled:opacity-40" style={quietButton}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function TypeRow({ type, readOnly, busy, onEdit, onArchive }) {
  const [asking, setAsking] = useState(false);
  return (
    <li className="py-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: '#fff' }}>
          {type.name}
        </span>
        <span className="text-xs rounded-full px-2 py-0.5 font-semibold" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}>
          {kindTag(type)}
        </span>
      </div>
      {type.description ? (
        <p className="text-sm" style={hintStyle}>
          {type.description}
        </p>
      ) : null}
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {termLine(type)}
      </p>
      <p className="text-sm" style={hintStyle}>
        {includesLine(type)}
      </p>
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
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => onEdit(type)}
            aria-label={`Change ${type.name}`}
            className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
            style={quietButton}
          >
            Change
          </button>
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => setAsking(true)}
            aria-label={`Archive ${type.name}`}
            className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
            style={quietButton}
          >
            Archive
          </button>
        </div>
      )}
    </li>
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
      return true;
    } catch (err) {
      setActionError(errorText(err, fallback));
      return false;
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
    setShowProblems(false);
    setRefused(0);
  };

  const save = async () => {
    setShowProblems(true);
    if (draft !== null && problems !== null) setRefused((n) => n + 1);
    if (draft === null || draftCurrency === null || problems !== null || readOnly || busy) return;
    const body = draftBody(draft, draftCurrency);
    const done =
      draft.id === null
        ? await run(() => orgService.createMembershipType(gymId, body), "We couldn't add that membership type. Please try again.")
        : await run(() => orgService.updateMembershipType(gymId, draft.id, body), "We couldn't save that change. Please try again.");
    if (done) closeForm();
  };

  const startDraft = (next) => {
    setActionError(null);
    setShowProblems(false);
    setDraft(next);
  };

  return (
    <ConsoleSection title="Memberships" summary={typesSummary(list)} forceOpen={loadError !== null}>
      {readOnly ? (
        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      <p className="text-sm" style={hintStyle}>
        Your own list of what you sell. You name each one, set its price, and choose how it is paid and what it
        includes.
        {list?.currency ? ` Prices are in ${list.currency}.` : ''}
      </p>

      {loadError !== null ? (
        <div className="mt-3">
          <ConsoleFailed message={loadError} onRetry={() => void load()} />
        </div>
      ) : list === null ? (
        <div className="mt-3">
          <ConsoleLoading label="Loading your membership types…" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 mt-4">
          {list.types.length > 0 ? (
            <ul className="flex flex-col">
              {list.types.map((type) => (
                <TypeRow
                  key={type.id}
                  type={type}
                  readOnly={readOnly}
                  busy={busy}
                  onEdit={(t) => startDraft(draftFromType(t))}
                  onArchive={(t) => {
                    if (draft?.id === t.id) closeForm();
                    void run(() => orgService.archiveMembershipType(gymId, t.id), "We couldn't archive that. Please try again.");
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              You haven&apos;t added anything yet. Add each thing you sell, with your own name and price: a monthly
              membership, a 10-class pack, a day pass, a free trial week.
            </p>
          )}

          {draft !== null && draftCurrency !== null ? (
            <TypeForm
              gymId={gymId}
              currency={draftCurrency}
              options={classOptions(list, editing)}
              draft={draft}
              setDraft={setDraft}
              problems={showProblems ? problems : null}
              refused={refused}
              busy={busy}
              onSave={() => void save()}
              onCancel={closeForm}
            />
          ) : list.currency === null ? (
            <p className="text-sm" style={{ color: '#F2C35B' }}>
              Set your country in your details, at the top of Settings, before adding a membership type. Prices are in
              your country&apos;s own money.
            </p>
          ) : canAddType(list) ? (
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => startDraft(emptyDraft())}
              className="self-start rounded-xl px-5 py-3 text-sm font-semibold min-h-11 disabled:opacity-40"
              style={mainButton}
            >
              Add a membership type
            </button>
          ) : (
            <p className="text-sm" style={hintStyle}>
              {TOO_MANY_TYPES}
            </p>
          )}

          {actionError !== null ? (
            <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
              {actionError}
            </p>
          ) : null}

          {list.archivedTotal > 0 ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="self-start rounded-xl px-4 py-2 text-sm min-h-11"
                style={quietButton}
              >
                {showArchived ? 'Hide archived' : `Show archived (${String(list.archivedTotal)})`}
              </button>
              {showArchived ? (
                <>
                  <ul className="flex flex-col">
                    {list.archived.map((type) => (
                      <li key={type.id} className="py-3 flex flex-wrap items-center gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="flex flex-col flex-grow min-w-0">
                          <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                            {type.name}
                          </span>
                          <span className="text-sm" style={hintStyle}>
                            {kindTag(type)} · {termLine(type)}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={readOnly || busy}
                          onClick={() => void run(() => orgService.restoreMembershipType(gymId, type.id), "We couldn't put that back. Please try again.")}
                          aria-label={`Put back ${type.name}`}
                          className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
                          style={quietButton}
                        >
                          Put back
                        </button>
                      </li>
                    ))}
                  </ul>
                  {archivedNote(list) !== null ? (
                    <p className="text-sm" style={hintStyle}>
                      {archivedNote(list)}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </ConsoleSection>
  );
}
