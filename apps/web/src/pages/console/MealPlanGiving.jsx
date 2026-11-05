import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, UserPlus } from 'lucide-react';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS } from '@app/shared';
import { errorText, selectionChanged } from '../../api/orgsApi';
import { mealPlansService } from '../../api/mealPlansApi';
import { Names } from './MemberListRemove';
import { Refusal, Sheet } from './MemberListTags';
import { GIVE_WORDS, groupLabel, peopleCount, throughLine, toLabel } from './mealPlansView';

// WHO GETS A MEAL PLAN (ROADMAP Stage 2 24a-ii; spec Part 6 §16.6). On a plan's page: who it is
// given to, Give to members (everybody, a membership, a tag, or members chosen on Members), and Stop.
// On Members and a person's page: the box that gives a plan to the people ticked. Each box first
// names who will get it and what it changes for them; nothing happens before its button.

const asGroup = (g) => ({ kind: g.kind, name: g.name });

/** The box before a press: who will get the plan, and what changes for them. */
function PreviewLines({ preview, words, kind }) {
  const to = kind === null ? null : toLabel({ kind, name: preview.groupName });
  return (
    <div className="flex flex-col gap-2" data-testid="give-preview">
      <p className="c-s15 c-t1">{GIVE_WORDS.willGet(preview.count, preview.plan.name, words)}</p>
      {preview.count > 0 ? <Names people={preview.people} total={preview.count} testId="give-names" /> : null}
      {preview.count > 0 && preview.already === preview.count ? <p className="c-s14 c-t2">{GIVE_WORDS.already(preview.plan.name)}</p> : null}
      {preview.switching > 0 ? <p className="c-s14 c-t2">{GIVE_WORDS.switching(preview.switching, preview.plan.name)}</p> : null}
      {preview.replaces !== null && to !== null ? <p className="c-s14 c-t2">{GIVE_WORDS.replaces(to, preview.replaces, preview.plan.name)}</p> : null}
      {preview.gone > 0 ? <p className="c-s14 c-t2">{GIVE_WORDS.gone(preview.gone)}</p> : null}
      {kind !== null ? <p className="c-s14 c-t2">{GIVE_WORDS.later(kind)}</p> : null}
    </div>
  );
}

/** Give to members, under its button: a group, then who it reaches, then Give. */
function GiveBox({ gymId, plan, words, membersTo, membershipsTo, onGiven, onClose }) {
  const [choices, setChoices] = useState(null);
  const [kind, setKind] = useState('everyone');
  const [typeId, setTypeId] = useState('');
  const [tagId, setTagId] = useState('');
  /** The answer for one choice: shown only while that choice is picked. */
  const [answered, setAnswered] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const name = useId();

  useEffect(() => {
    let live = true;
    mealPlansService.groups(gymId).then(
      (c) => {
        if (!live) return;
        setChoices(c);
        setTypeId(c.membershipTypes[0]?.id ?? '');
        setTagId(c.tags[0]?.id ?? '');
      },
      (err) => {
        if (live) setError(errorText(err, "We couldn't load your memberships and tags. Please try again."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId]);

  const to =
    kind === 'everyone'
      ? { kind: 'everyone' }
      : kind === 'membership_type' && typeId !== ''
        ? { kind: 'membership_type', membershipTypeId: typeId }
        : kind === 'tag' && tagId !== ''
          ? { kind: 'tag', tagId }
          : null;
  const toKey = to === null ? '' : JSON.stringify(to);
  const preview = answered !== null && answered.key === toKey ? answered.preview : null;

  useEffect(() => {
    if (toKey === '') return undefined;
    let live = true;
    mealPlansService.givePreview(gymId, plan.id, JSON.parse(toKey)).then(
      (p) => {
        if (live) setAnswered({ key: toKey, preview: p });
      },
      (err) => {
        if (live) setError(errorText(err, "We couldn't work out who would get it. Please try again."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, plan.id, toKey]);

  const give = async () => {
    if (to === null || preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const given = await mealPlansService.give(gymId, plan.id, to);
      onGiven(given, GIVE_WORDS.given(plan.name, toLabel({ kind: to.kind, name: preview.groupName })));
    } catch (err) {
      setError(errorText(err, "We couldn't give this plan. Please try again."));
      setBusy(false);
    }
  };

  const option = (value, label) => (
    <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={kind === value}
        disabled={busy}
        onChange={() => {
          setKind(value);
          setError(null);
        }}
      />
      {label}
    </label>
  );

  return (
    <section className="c-card p-5 flex flex-col gap-4" data-testid="give-box" aria-label={GIVE_WORDS.choose(plan.name)}>
      <h3 className="c-s16 c-w6 c-t1">{GIVE_WORDS.choose(plan.name)}</h3>
      {choices === null && error === null ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
      {choices !== null ? (
        <div className="flex flex-col">
          {option('everyone', GIVE_WORDS.everyone)}
          {option('membership_type', GIVE_WORDS.membership)}
          {kind === 'membership_type' ? (
            choices.membershipTypes.length === 0 ? (
              <div className="flex flex-col gap-2 pl-7 pb-2">
                <p className="c-s14 c-t2">{GIVE_WORDS.noMemberships}</p>
                {membershipsTo !== null ? (
                  <Link to={membershipsTo} className="c-btn c-btn-s c-btn-sm self-start">
                    Open Memberships
                  </Link>
                ) : (
                  <p className="c-s14 c-t2">{GIVE_WORDS.noMembershipsAsk}</p>
                )}
              </div>
            ) : (
              <label className="c-field pl-7 pb-2">
                <span className="c-label">{GIVE_WORDS.pickMembership}</span>
                <select className="c-input" style={{ maxWidth: 320 }} value={typeId} disabled={busy} onChange={(e) => setTypeId(e.target.value)}>
                  {choices.membershipTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : null}
          {option('tag', GIVE_WORDS.tag)}
          {kind === 'tag' ? (
            choices.tags.length === 0 ? (
              <div className="flex flex-col gap-2 pl-7 pb-2">
                <p className="c-s14 c-t2">{GIVE_WORDS.noTags}</p>
                {membersTo !== null ? (
                  <Link to={membersTo} className="c-btn c-btn-s c-btn-sm self-start">
                    Open Members
                  </Link>
                ) : null}
              </div>
            ) : (
              <label className="c-field pl-7 pb-2">
                <span className="c-label">{GIVE_WORDS.pickTag}</span>
                <select className="c-input" style={{ maxWidth: 320 }} value={tagId} disabled={busy} onChange={(e) => setTagId(e.target.value)}>
                  {choices.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : null}
          {option('members', GIVE_WORDS.members)}
          {kind === 'members' ? (
            <div className="flex flex-col gap-2 pl-7 pb-2">
              <p className="c-s14 c-t2">{GIVE_WORDS.chooseHow}</p>
              {membersTo !== null ? (
                <Link to={membersTo} className="c-btn c-btn-s c-btn-sm self-start">
                  {GIVE_WORDS.chooseButton}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {to !== null && preview === null && error === null ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
      {to !== null && preview !== null ? <PreviewLines preview={preview} words={words} kind={to.kind} /> : null}
      {error !== null ? <Refusal>{error}</Refusal> : null}
      <div className="flex flex-wrap gap-2">
        {to !== null ? (
          <button type="button" onClick={give} disabled={busy || preview === null} className="c-btn c-btn-p" data-testid="give-press">
            {busy ? 'Giving…' : GIVE_WORDS.press(preview?.count ?? 0, words)}
          </button>
        ) : null}
        <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-quiet">
          Cancel
        </button>
      </div>
    </section>
  );
}

/** Stop giving, asked first in the place it was pressed. */
function StopAsk({ question, busy, onStop, onKeep }) {
  return (
    <div className="flex flex-col gap-2 pt-2" role="group" aria-label={question}>
      <p className="c-s15 c-w6 c-t1">{question}</p>
      <p className="c-s14 c-t2">{GIVE_WORDS.stopWhy}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onStop} disabled={busy} className="c-btn c-btn-danger c-btn-sm">
          Stop giving
        </button>
        <button type="button" onClick={onKeep} disabled={busy} className="c-btn c-btn-quiet c-btn-sm">
          Keep it
        </button>
      </div>
    </div>
  );
}

/** A plan's Who gets it: its groups, its chosen members, Give to members and Stop. */
export function GivenSection({ gymId, plan, given, readOnly, words, membersTo, membershipsTo, onGiven, onOpenBox, boxOpen, onCloseBox }) {
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const stop = async (audienceIds, to) => {
    setBusy(true);
    setError(null);
    try {
      onGiven(await mealPlansService.stop(gymId, plan.id, audienceIds));
      setAsking(null);
      setNotice(GIVE_WORDS.stopped(plan.name, to));
    } catch (err) {
      setError(errorText(err, "We couldn't stop giving this plan. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const nothing = given !== null && given.groups.length === 0 && given.members.length === 0;
  return (
    <section className="c-card p-5 md:p-6 flex flex-col gap-4" aria-label={GIVE_WORDS.heading} data-testid="given">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="c-h2">{GIVE_WORDS.heading}</h2>
          {given !== null && !nothing ? <p className="c-s14 c-t2">{`${peopleCount(given.gets, words)} get it now`}</p> : null}
        </div>
        {!readOnly && !boxOpen ? (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setAsking(null);
              onOpenBox();
            }}
            className="c-btn c-btn-p self-start md:self-auto"
          >
            <UserPlus aria-hidden="true" className="w-[18px] h-[18px]" />
            {GIVE_WORDS.give}
          </button>
        ) : null}
      </div>
      {boxOpen ? (
        <GiveBox
          gymId={gymId}
          plan={plan}
          words={words}
          membersTo={membersTo}
          membershipsTo={membershipsTo}
          onClose={onCloseBox}
          onGiven={(next, line) => {
            onGiven(next);
            onCloseBox();
            setNotice(line);
          }}
        />
      ) : null}
      {notice !== null ? (
        <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
          {notice}
        </p>
      ) : null}
      {error !== null ? <Refusal>{error}</Refusal> : null}
      {given === null ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
      {nothing ? <p className="c-s15 c-t2">{GIVE_WORDS.none}</p> : null}
      {given !== null && given.groups.length > 0 ? (
        <ul className="flex flex-col gap-3" data-testid="given-groups">
          {given.groups.map((g) => {
            const to = toLabel(asGroup(g));
            return (
              <li key={g.audienceId} className="flex flex-col gap-1 pb-3 border-b" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="c-s15 c-w6 c-t1">{groupLabel(asGroup(g))}</p>
                    <p className="c-s14 c-t2">{GIVE_WORDS.groupSize(g, words)}</p>
                    {g.gets < g.size ? <p className="c-s14 c-t2">{GIVE_WORDS.newer(g)}</p> : null}
                  </div>
                  {!readOnly && asking !== g.audienceId ? (
                    <button type="button" onClick={() => setAsking(g.audienceId)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm">
                      {GIVE_WORDS.stop}
                    </button>
                  ) : null}
                </div>
                {asking === g.audienceId ? (
                  <StopAsk question={GIVE_WORDS.stopAsk(plan.name, to)} busy={busy} onStop={() => void stop([g.audienceId], to)} onKeep={() => setAsking(null)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {given !== null && given.members.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="given-members">
          <div className="flex items-center justify-between gap-3">
            <h3 className="c-s15 c-w6 c-t1">{GIVE_WORDS.chosen(given.members.length)}</h3>
            {!readOnly && given.members.length > 1 && asking !== 'members' ? (
              <button type="button" onClick={() => setAsking('members')} disabled={busy} className="c-btn c-btn-quiet c-btn-sm">
                {GIVE_WORDS.stopAll}
              </button>
            ) : null}
          </div>
          {asking === 'members' ? (
            <StopAsk
              question={GIVE_WORDS.stopAsk(plan.name, peopleCount(given.members.length, words))}
              busy={busy}
              onStop={() => void stop(given.members.map((m) => m.audienceId), peopleCount(given.members.length, words))}
              onKeep={() => setAsking(null)}
            />
          ) : null}
          <ul className="flex flex-col gap-2">
            {given.members.map((m) => (
              <li key={m.audienceId} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="c-s15 c-t1 c-ell">{m.name || 'No name'}</p>
                    {m.instead !== null ? <p className="c-s13 c-t2">{GIVE_WORDS.instead(m.instead)}</p> : null}
                  </div>
                  {!readOnly && asking !== m.audienceId ? (
                    <button type="button" onClick={() => setAsking(m.audienceId)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm">
                      {GIVE_WORDS.stop}
                    </button>
                  ) : null}
                </div>
                {asking === m.audienceId ? (
                  <StopAsk question={GIVE_WORDS.stopAsk(plan.name, m.name || 'this member')} busy={busy} onStop={() => void stop([m.audienceId], m.name || 'this member')} onKeep={() => setAsking(null)} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Give a meal plan to the people selected on Members, or to one person from their page. */
export function GiveMealPlanSheet({ gymId, gymSlug, selection, words, onSelectionChanged, onClose, onGiven = () => {} }) {
  const [plans, setPlans] = useState(null);
  const [planId, setPlanId] = useState('');
  const [answered, setAnswered] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const fieldId = useId();

  useEffect(() => {
    let live = true;
    mealPlansService.list(gymId).then(
      (list) => {
        if (live) setPlans(list.plans);
      },
      (err) => {
        if (live) setError(errorText(err, "We couldn't load your meal plans. Please try again."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId]);

  const preview = answered !== null && answered.planId === planId ? answered.preview : null;

  useEffect(() => {
    if (planId === '') return undefined;
    let live = true;
    mealPlansService.previewSelected(gymId, planId, selection).then(
      (p) => {
        if (live) setAnswered({ planId, preview: p });
      },
      (err) => {
        if (!live) return;
        const fresh = selectionChanged(err);
        if (fresh !== null) {
          setError(MEMBER_LIST_SELECTION_CHANGED_WORDS);
          onSelectionChanged?.(fresh);
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
  }, [gymId, planId]);

  const give = async () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const given = await mealPlansService.giveSelected(gymId, planId, selection);
      setDone({ ...given, planId });
      onGiven(given);
    } catch (err) {
      const fresh = selectionChanged(err);
      if (fresh !== null) {
        setError(MEMBER_LIST_SELECTION_CHANGED_WORDS);
        onSelectionChanged?.(fresh);
      } else {
        setError(errorText(err, "We couldn't give this plan. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  const plansTo = `/console/${gymSlug}/plans`;
  const footer =
    done !== null ? (
      <button type="button" onClick={onClose} className="c-btn c-btn-p col-span-2">
        Done
      </button>
    ) : (
      <>
        <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-quiet">
          Cancel
        </button>
        {plans !== null && plans.length > 0 ? (
          <button type="button" onClick={give} disabled={busy || preview === null || preview.count === 0} className="c-btn c-btn-p" data-testid="give-selected-press">
            {busy ? 'Giving…' : GIVE_WORDS.press(preview?.count ?? 0, words)}
          </button>
        ) : null}
      </>
    );

  return (
    <Sheet title={GIVE_WORDS.sheetTitle} testId="give-meal-plan" onClose={onClose} footer={footer}>
      {done !== null ? (
        <div className="flex flex-col gap-3">
          <p className="c-s15 c-w6" role="status" style={{ color: 'var(--good)' }}>
            {GIVE_WORDS.givenMembers(done.plan, done.count, words)}
          </p>
          <Link to={`${plansTo}/${done.planId}`} className="c-btn c-btn-s c-btn-sm self-start">
            {GIVE_WORDS.openPlan(done.plan)}
          </Link>
        </div>
      ) : (
        <>
          {plans === null && error === null ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
          {plans !== null && plans.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="c-s15 c-t2">{GIVE_WORDS.noPlans}</p>
              <Link to={plansTo} className="c-btn c-btn-s c-btn-sm self-start">
                {GIVE_WORDS.writePlan}
              </Link>
            </div>
          ) : null}
          {plans !== null && plans.length > 0 ? (
            <div className="c-field">
              <label className="c-label" htmlFor={fieldId}>
                {GIVE_WORDS.pickPlan}
              </label>
              <select id={fieldId} className="c-input" value={planId} disabled={busy} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">{GIVE_WORDS.pickPlanFirst}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {planId !== '' && preview === null && error === null ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
          {preview !== null ? <PreviewLines preview={preview} words={words} kind={null} /> : null}
          {error !== null ? <Refusal>{error}</Refusal> : null}
        </>
      )}
    </Sheet>
  );
}

/** A person's page: the meal plan they get, and through which group; Give or Change opens the box. */
export function PersonMealPlan({ gymId, gymSlug, entryId, words, readOnly }) {
  const [state, setState] = useState({ loading: true, answer: null, error: null });
  const [giving, setGiving] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    mealPlansService.forRecord(gymId, entryId).then(
      (answer) => {
        if (live) setState({ loading: false, answer, error: null });
      },
      (err) => {
        if (live) setState({ loading: false, answer: null, error: errorText(err, "We couldn't load their meal plan.") });
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, reads]);
  const plan = state.answer?.plan ?? null;
  const through = throughLine(state.answer?.through ?? null);
  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" data-testid="person-meal-plan">
      <h3 className="c-h2">{GIVE_WORDS.personHeading}</h3>
      {state.loading ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
      {state.error !== null ? <p className="c-s14 c-t2">{state.error}</p> : null}
      {!state.loading && state.error === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {plan !== null ? (
              <Link to={`/console/${gymSlug}/plans/${plan.id}`} className="c-s15 c-w6 c-lk">
                {plan.name}
              </Link>
            ) : (
              <p className="c-s15 c-t2">{GIVE_WORDS.personNone}</p>
            )}
            {through !== null ? <p className="c-s13 c-t2">{through}</p> : null}
          </div>
          {!readOnly ? (
            <button type="button" onClick={() => setGiving(true)} className="c-btn c-btn-s c-btn-sm">
              {plan === null ? GIVE_WORDS.personGive : GIVE_WORDS.personChange}
            </button>
          ) : null}
        </div>
      ) : null}
      {giving ? (
        <GiveMealPlanSheet
          gymId={gymId}
          gymSlug={gymSlug}
          selection={{ kind: 'ticked', entryIds: [entryId] }}
          words={words}
          onGiven={() => setReads((n) => n + 1)}
          onClose={() => setGiving(false)}
        />
      ) : null}
    </section>
  );
}
