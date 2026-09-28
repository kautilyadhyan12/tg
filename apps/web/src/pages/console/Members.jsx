import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Loader2, Search, Upload, UserPlus, X } from 'lucide-react';
import { ConfirmInline, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText, errorCode } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import ApplicationsQueue from './ApplicationsQueue';
import MemberListPanel from './MemberListPanel';
import MemberListPerson from './MemberListPerson';
import { orgWords } from '@app/shared';
import {
  canRemoveMembers,
  viewerPrivileges,
  groupLabelText,
  memberCountLabel,
  offListView,
  seatIsFree,
} from './consoleView';
import { canMakeRoomNow, consoleIsReadOnly, memberMeterText, readOnlyNote, seatMeter } from './billingView';
import { shortWhen } from './memberListPeople';
import PlanChoiceDialog from '../../components/console/PlanChoiceDialog';

// The Members screen (spec Part 3 §4.3, §18.2), drawn from `console.css` (spec §17):
// the title with the plan meter, Import and Add member, Waiting to join, and two tabs —
// "Your list" (the gym's own list, `MemberListPanel`) and "In the app" (the roster; kept
// as its own tab, Kd 2026-09-28).
//
// The roster holds EXACTLY to §2.4's visibility boundary: display name, the day they
// joined, the label of the code that brought them in, whether their seat is
// complimentary, and whether they take one of the gym's paid places — plus, for staff
// who may see the gym's own list, the name that list holds for them (3b-ii-b). No email
// address, no body weight, no meals, no workouts. The meter's numbers are the server's
// exact count off the org row, never the length of a page of the roster.

/** One person in the app, as Leads shows a lead: their name, since when, and one tag.
 *  Everything to do with them is on their panel (`RosterSheet`). */
function RosterRow({ member, onOpen }) {
  // An app member the gym's list does not hold (3a-vi-b). Only staff who may see the
  // list are sent it.
  const off = offListView(member.offList);
  return (
    <li className="border-t first:border-t-0" style={{ borderColor: 'var(--line)' }} data-testid={off ? 'member-off-list' : undefined}>
      <button
        type="button"
        onClick={onOpen}
        data-testid="roster-row"
        className="grid w-full text-left min-h-11 px-4 py-3.5 md:px-5 gap-x-3 items-center"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) auto 18px' }}
      >
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="c-s15 c-w6 c-t1 c-ell">{member.displayName}</span>
          <span className="c-s13 c-t2 c-ell">In the app since {shortWhen(member.joinedAt)}</span>
        </span>
        <span>
          {seatIsFree(member) ? (
            <span className="c-tag c-tag-soft">Complimentary</span>
          ) : off ? (
            <span className="c-tag c-tag-warn">
              <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
              Not on your list
            </span>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3" />
      </button>
    </li>
  );
}

/** One person in the app, opened: who they are to the gym, and what staff can do — put
 *  them on the list, or Remove (One Remove, RULINGS 2026-09-27: someone on the list moves
 *  to past members AND leaves the app in the same step). A side panel on a computer, the
 *  whole screen on a phone, as a lead's panel is. */
function RosterSheet({ member, words, seesList, canRemove, readOnly, busy, onClose, onRemove, onPutOnList }) {
  const [asking, setAsking] = useState(false);
  const off = offListView(member.offList);
  const free = seatIsFree(member);
  // Remove moves a record to past members only when the server named the record that is
  // certainly theirs (`recordId`); a gym with no list, someone on no list, and a family's
  // shared email the list can't place lose their app access and nothing else (round one
  // of 5b-v-a-i, High-6).
  const movesRecord = seesList && !free && member.recordId !== undefined;
  const question = movesRecord
    ? `Remove ${member.displayName}? They'll be moved to past ${words.people} and lose access to your ${words.it} in the app. Their own workout history isn't affected, and you can put them back at any time.`
    : `Remove ${member.displayName}'s app access? They'll lose access to your ${words.it} in the app. Their own workout history isn't affected.`;
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={member.displayName}
        className="c-sheet absolute inset-0 md:left-auto md:w-[480px] md:border-l flex flex-col overflow-y-auto"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-start gap-3 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-col gap-1 flex-grow min-w-0">
            <h2 className="c-h1 c-ell" style={{ fontSize: 28, lineHeight: '34px' }}>
              {member.displayName}
            </h2>
            <span className="c-s14 c-t2">
              In the app since {shortWhen(member.joinedAt)}
              {groupLabelText(member) === '—' ? '' : ` · ${groupLabelText(member)}`}
            </span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 py-5 md:px-7">
          {free ? (
            <p className="c-s14 c-t2">
              <span className="c-tag c-tag-soft mr-2">Complimentary</span>
              The owner and staff use the app for free. Manage staff in Settings.
            </p>
          ) : null}
          {/* The name on the gym's own list, beside the name they gave the app. The email on
              the list is the link; names are never compared (RULINGS 2026-09-28). */}
          {member.onList ? <span className="c-s14 c-t2">On your list as {member.onList.name}</span> : null}
          {off ? (
            <div className="flex flex-col gap-1">
              <span className="c-s14 c-w6 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>
                <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
                {off.line}
              </span>
              {off.sameEmail ? <span className="c-s14 c-t2">{off.sameEmail}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {off ? (
              <button type="button" onClick={onPutOnList} disabled={busy || readOnly} className="c-btn c-btn-soft">
                {off.button}
              </button>
            ) : null}
            {/* A trainer is refused the removal, so it is not drawn for them; a lapsed gym
                greys it rather than hiding it (the server's 403 enforces both). The owner
                and staff are removed with staff. */}
            {!free && canRemove && !asking ? (
              <button type="button" onClick={() => setAsking(true)} disabled={busy || readOnly} className="c-btn c-btn-s">
                Remove
              </button>
            ) : null}
          </div>
          {asking ? (
            <ConfirmInline
              newLook
              question={question}
              confirmLabel="Remove"
              cancelLabel="Cancel"
              busy={busy || readOnly}
              onConfirm={() => {
                setAsking(false);
                onRemove();
              }}
              onCancel={() => setAsking(false)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** "Already in the app · 3" under an empty list (`MembersEmpty`). */
function AlreadyInApp({ items }) {
  if (items.length === 0) return null;
  return (
    <section className="c-card overflow-hidden" aria-labelledby="already-title">
      <h2 id="already-title" className="c-h3 px-5 pt-4 pb-3">
        Already in the app · {items.length.toLocaleString('en')}
      </h2>
      <ul>
        {items.map((m) => (
          <li
            key={m.userId}
            className="flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-1 md:gap-4 md:items-center px-5 py-3.5 border-t"
            style={{ borderColor: 'var(--line)' }}
          >
            <span className="c-s15 c-w6 c-t1 c-ell">{m.displayName}</span>
            <span className="c-s14 c-t2">In the app since {shortWhen(m.joinedAt)}</span>
            <span>{seatIsFree(m) ? <span className="c-tag c-tag-soft">Complimentary</span> : null}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Members() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);

  // Starts in `loading` (the org has to resolve first) and the retry handler
  // re-enters it, so the effect below never sets state synchronously.
  const [state, setState] = useState({ loading: true, error: null, items: [], nextCursor: null });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  /** The person in the app whose panel is open, by id. */
  const [openUserId, setOpenUserId] = useState(null);
  /** The search over the people in the app, as typed and as asked (after a pause). */
  const [rosterTyped, setRosterTyped] = useState('');
  const [rosterQuery, setRosterQuery] = useState('');
  /** Bumped when a change here moves the list (One Remove, Put back), so it reads again. */
  const [listKey, setListKey] = useState(0);
  /** The bigger size opened from the "nearly full" line. */
  const [choosing, setChoosing] = useState(false);
  /** Import or Add member, pressed in the header, for the list to open. */
  const [action, setAction] = useState(null);
  /** The record of a person in the app whose page is open, and the list view it reads. */
  const [openRecord, setOpenRecord] = useState(null);
  const [recordList, setRecordList] = useState(null);
  const clearAction = useCallback(() => setAction(null), []);
  const gymId = org?.id ?? null;
  // §4.3's "Remove hidden" for a trainer, off the org row the screen already has.
  const canRemove = canRemoveMembers(viewerPrivileges(org));
  // The gym's own list is `members.confirm`'s.
  const canSeeList = viewerPrivileges(org).includes('members.confirm');
  // Which tab, kept in the address so a reload stays on it.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = canSeeList && searchParams.get('view') !== 'app' ? 'list' : 'app';
  const showTab = (next) => setSearchParams(next === 'app' ? { view: 'app' } : {}, { replace: true });
  // Part 3 §4.2's read-only console, off the org row this screen already holds.
  const readOnly = consoleIsReadOnly(org);
  // A gym has members, a studio and a trainer have clients.
  const words = orgWords(org?.orgType);

  // A person's page reads the list's own columns and words: read once, when the first
  // page is opened from "Using the app". Without it the page still shows everything else.
  useEffect(() => {
    if (openRecord === null || recordList !== null || gymId === null) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => orgService.getMemberList(gymId))
      .then(
        (res) => {
          if (live) setRecordList(res.data.list);
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [openRecord, recordList, gymId]);

  useEffect(() => {
    const timer = setTimeout(() => setRosterQuery(rosterTyped.trim()), 300);
    return () => clearTimeout(timer);
  }, [rosterTyped]);

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    orgService
      .getMembers(gymId, rosterQuery === '' ? { limit: 50 } : { limit: 50, query: rosterQuery })
      .then((res) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          items: res.data?.items ?? [],
          nextCursor: res.data?.nextCursor ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // §2.2 gives a trainer the member list for their own group only, and nothing
        // assigns groups yet, so a studio trainer is held out with a 403 carrying its own
        // sentence. Printing the empty state would say the gym has no members.
        const message =
          errorCode(err) === 'trainer_scope_unavailable'
            ? errorText(err, "Your role doesn't allow that.")
            : errorText(err, `We couldn't load the ${words.people}.`);
        setState({ loading: false, error: message, items: [], nextCursor: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt, words, rosterQuery]);

  const retry = () => {
    setState({ loading: true, error: null, items: [], nextCursor: null });
    setAttempt((n) => n + 1);
  };

  /** A confirm from the queue above puts somebody INTO this list, so the list is re-read
   *  from page one; every field shown is one the server just stated. */
  const reloadRoster = () => {
    setRemoveError(null);
    retry();
  };

  const putOnList = async (member) => {
    if (gymId === null) return;
    setRemovingId(member.userId);
    setRemoveError(null);
    try {
      await orgService.putMemberOnList(gymId, member.userId);
      setOpenUserId(null);
      setListKey((n) => n + 1);
      reloadRoster();
    } catch (err) {
      setRemoveError(errorText(err, "We couldn't put them on your list. Please try again."));
    } finally {
      setRemovingId(null);
    }
  };

  const removeMember = async (member) => {
    if (gymId === null) return;
    setRemovingId(member.userId);
    setRemoveError(null);
    try {
      await orgService.removeMember(gymId, member.userId);
      setOpenUserId(null);
      setListKey((n) => n + 1);
      reloadRoster();
    } catch (err) {
      // The server's own sentence; the list is left as it was, because nothing changed.
      setOpenUserId(null);
      setRemoveError(errorText(err, "We couldn't remove them. Please try again."));
    } finally {
      setRemovingId(null);
    }
  };

  const loadMore = async () => {
    if (gymId === null || state.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await orgService.getMembers(
        gymId,
        rosterQuery === '' ? { limit: 50, cursor: state.nextCursor } : { limit: 50, cursor: state.nextCursor, query: rosterQuery },
      );
      setState((prev) => ({
        ...prev,
        // Appended, never replaced: the cursor walk is keyset-ordered.
        items: [...prev.items, ...(res.data?.items ?? [])],
        nextCursor: res.data?.nextCursor ?? null,
      }));
    } catch (err) {
      // The rows already on screen are real and stay.
      setState((prev) => ({ ...prev, error: errorText(err, "We couldn't load any more.") }));
    } finally {
      setLoadingMore(false);
    }
  };

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }

  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const openMember = openUserId === null ? null : (state.items.find((m) => m.userId === openUserId) ?? null);
  // Somebody with a record of their own opens the same page as on "Your list" (Kd,
  // 2026-09-27: "those personal card should be same in both"); the rest open their panel.
  const openFromRoster = (m) => (canSeeList && m.recordId ? setOpenRecord(m.recordId) : setOpenUserId(m.userId));
  const countLabel = memberCountLabel({ items: state.items, nextCursor: state.nextCursor }, org?.orgType);
  // §4.3's header meter, off the org row: null for a gym on no plan and a capless band.
  const meter = seatMeter(org);
  const meterText = memberMeterText(meter, org?.orgType);
  const press = (what) => {
    showTab('list');
    setAction(what);
  };

  return (
    <div className="c-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">{words.peopleCap}</h1>
          <p className="c-sub">
            <span className={meterText === null ? '' : 'hidden md:inline'}>{org.name}</span>
            {meterText !== null ? (
              <>
                <span className="hidden md:inline"> · </span>
                <span data-testid="seat-meter" style={meter.pressure ? { color: 'var(--warn)' } : undefined}>
                  {meterText}
                </span>
              </>
            ) : null}
          </p>
          {/* Nearly full: billing staff on a paying plan can make room from here. */}
          {meter?.pressure === true && canMakeRoomNow(org) ? (
            <button type="button" onClick={() => setChoosing(true)} className="c-btn c-btn-soft self-start mt-1">
              Change size
            </button>
          ) : null}
          {/* The note explains greyed controls, so only to somebody who has them. */}
          {readOnly && canRemove ? <p className="c-s14 c-t2">{readOnlyNote(org?.orgType)}</p> : null}
        </div>
        {canSeeList ? (
          <div className="grid grid-cols-2 gap-2 md:flex">
            <button type="button" onClick={() => press('import')} disabled={readOnly} className="c-btn c-btn-s c-btn-lg md:h-10 md:text-sm">
              <Upload aria-hidden="true" className="w-4 h-4" />
              Import
            </button>
            <button type="button" onClick={() => press('add')} disabled={readOnly} className="c-btn c-btn-p c-btn-lg md:h-10 md:text-sm">
              <UserPlus aria-hidden="true" className="w-4 h-4" />
              Add {words.person}
            </button>
          </div>
        ) : null}
      </header>
      {choosing ? <PlanChoiceDialog org={org} mode="size" onClose={() => setChoosing(false)} /> : null}

      {/* WAITING TO JOIN, above the tabs: people at the door must not be hidden behind the
          other tab. It reads its own endpoint and owns its own failure. */}
      <ApplicationsQueue gymId={gymId} orgType={org?.orgType} readOnly={readOnly} onRosterChanged={reloadRoster} />

      {canSeeList ? (
        <div className="c-utabs" role="tablist">
          {[
            ['list', 'Your list'],
            ['app', 'In the app'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => showTab(key)}
              className={tab === key ? 'c-utab c-utab-on' : 'c-utab'}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'list' ? (
        <MemberListPanel
          gymId={gymId}
          gym={org}
          words={words}
          readOnly={readOnly}
          refreshKey={listKey}
          action={action}
          onActionTaken={clearAction}
          emptyExtra={<AlreadyInApp items={state.items} />}
          onRosterChanged={reloadRoster}
        />
      ) : null}

      {tab === 'app' ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="c-search w-full md:max-w-[460px] md:flex-grow">
            <Search aria-hidden="true" className="w-[18px] h-[18px]" />
            <input
              type="search"
              aria-label={`Search the ${words.people} in the app by name`}
              maxLength={120}
              placeholder="Search by name"
              value={rosterTyped}
              onChange={(e) => setRosterTyped(e.target.value)}
              className="c-input"
            />
          </label>
          <span className="flex-grow" />
          {!state.loading && state.error === null ? <span className="c-s14 c-t2 c-num whitespace-nowrap">{countLabel}</span> : null}
        </div>
      ) : null}

      {tab === 'app' && state.loading ? <ConsoleLoading label={`Loading ${words.people}…`} newLook /> : null}

      {/* A failure always offers a way out: the fresh read settles whether a removal
          landed before the error did. */}
      {tab === 'app' && removeError !== null ? <ConsoleFailed message={removeError} onRetry={reloadRoster} newLook /> : null}

      {tab === 'app' && !state.loading && state.error !== null ? <ConsoleFailed message={state.error} onRetry={retry} newLook /> : null}

      {tab === 'app' && !state.loading && state.error === null && state.items.length === 0 && rosterQuery !== '' ? (
        <p className="c-s14 c-t2">No {words.people} in the app match your search.</p>
      ) : null}

      {tab === 'app' && !state.loading && state.error === null && state.items.length === 0 && rosterQuery === '' ? (
        <section className="c-card p-5 md:p-6 flex flex-col gap-1">
          <p className="c-s15 c-w6 c-t1">Nobody has joined yet.</p>
          <p className="c-s14 c-t2">Share your join code and {words.people} will appear here.</p>
        </section>
      ) : null}

      {tab === 'app' && state.items.length > 0 ? (
        <section className="c-card overflow-hidden">
          <ul>
            {state.items.map((m) => (
              <RosterRow key={m.userId} member={m} onOpen={() => openFromRoster(m)} />
            ))}
          </ul>
        </section>
      ) : null}

      {tab === 'app' && openMember !== null ? (
        <RosterSheet
          key={openMember.userId}
          member={openMember}
          words={words}
          seesList={canSeeList}
          canRemove={canRemove}
          readOnly={readOnly}
          busy={removingId === openMember.userId}
          onClose={() => setOpenUserId(null)}
          onRemove={() => removeMember(openMember)}
          onPutOnList={() => putOnList(openMember)}
        />
      ) : null}

      {tab === 'app' && openRecord !== null ? (
        <MemberListPerson
          key={openRecord}
          gymId={gymId}
          gym={org}
          entryId={openRecord}
          list={recordList}
          words={words}
          readOnly={readOnly}
          onClose={() => setOpenRecord(null)}
          onChanged={() => {
            reloadRoster();
            setListKey((k) => k + 1);
          }}
        />
      ) : null}

      {tab === 'app' && state.nextCursor !== null ? (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="c-btn c-btn-s c-btn-lg w-full md:w-auto md:self-start">
          {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
