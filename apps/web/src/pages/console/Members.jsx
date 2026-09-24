import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText, errorCode } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import ApplicationsQueue from './ApplicationsQueue';
import MemberListUpload from './MemberListUpload';
import { orgWords } from '@app/shared';
import {
  canRemoveMembers,
  viewerPrivileges,
  formatJoinedAt,
  groupLabelText,
  memberCountLabel,
  seatIsFree,
} from './consoleView';
import { consoleIsReadOnly, readOnlyNote, seatLineText, seatMeter } from './billingView';

// The roster — Part 3 §4.3's Members screen, holding EXACTLY to §2.4's
// visibility boundary.
//
// FIVE FACTS PER PERSON, and no sixth: display name, the day they joined, the
// label of the code that brought them in, whether their seat is complimentary,
// and whether they occupy one of the gym's paid places at all. That is the
// whole of what the endpoint returns, and it is the whole of what §2.4 lets a
// gym see about somebody. Staff who may see the gym's own list also get the name
// that list holds for the person (3b-ii-b): the gym's data, not the member's.
//
// **The fifth was added 2026-08-22 (:14953), and T3 L-1 corrected the argument
// for it — see `orgMemberSchema`, which carries the corrected version.** In
// short: it does NOT merely say "this place is free". Read beside the
// complimentary flag it is served with, it tells any trainer or manager exactly
// which colleagues hold the keys — a list the server otherwise refuses them
// with a 403. That disclosure is ACCEPTED rather than unnoticed: §2.4's
// never-see list is member health and personal data, none of which moves, and
// withholding it would hand a trainer back the defect this card removed.
// No email address, no body
// weight, no meals, no coach conversations, no run routes — and no workout
// figures either, since the columns §4.3 lists (last active, workouts 30d,
// average form 30d, streak) come from `org_member_stats`, a view that does not
// exist.
//
// **§4.3's SEAT METER IS HERE NOW, and this comment used to explain why it was
// not.** It said the meter "needs a plan's seat cap, and no gym has a
// subscription, so a meter here would be drawn over a null" — true until
// 2026-08-27, when a gym gained the ability to start its own trial. A gym on no
// plan is still uncapped and still gets no meter, which is the same null handled
// the same way; what changed is that a gym CAN now be on a plan. The numerator
// is the server's exact count, never the length of the page below it: this list
// is fifty rows at a time, so `items.length` would read "50 of 300" at a gym of
// six hundred.
//
// Search, the group filter, remove/restore and CSV export are §4.3 features
// with no routes behind them yet; each has its own owed line.

/** REMOVING A MEMBER — Part 3 §4.3, and it exists because Kd asked what happens
 *  when a gym confirms the wrong person. Until this shipped, nothing in the
 *  product could end a membership except the member deleting their account, so
 *  Confirm was a one-way door.
 *
 *  §4.3 specifies a CONFIRM SHEET before it, and that is the two-step below: the
 *  buttons sit where "Remove" was, so a mis-tap lands on a question rather than
 *  on the removal. Confirm and "Not this person" in the queue above have no such
 *  step, deliberately — both of those are reversible now (remove undoes one, a
 *  fresh application undoes the other), and a question in front of every tap on
 *  a walk-in queue is the friction the 30-second join is supposed not to have.
 *
 *  The consequence is stated where the gym reads it, because it is Kd's own
 *  rule: the person loses the gym's features immediately and keeps every
 *  workout they ever did. */
function RemoveControl({ member, busy, readOnly, words, onRemove }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy || readOnly}
        className="text-xs rounded-lg px-3 py-1.5 flex-shrink-0 disabled:opacity-40"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
      >
        Remove
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
      <span className="text-xs text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Remove {member.displayName}? They keep their own workouts and lose your {words.it}&apos;s
        features.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            onRemove();
          }}
          disabled={busy || readOnly}
          className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="text-xs rounded-lg px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
        >
          Keep
        </button>
      </div>
    </div>
  );
}

function MemberRow({ member, busy, canRemove, readOnly, words, onRemove }) {
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate" style={{ color: '#fff' }}>
          {member.displayName}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Joined {formatJoinedAt(member.joinedAt)} · {groupLabelText(member)}
        </div>
        {/* The name on the gym's own list at the address they joined with, beside the
            name they signed up with: a gym that mistyped an address invited a
            stranger, and a different name is the clue (RULINGS 2026-09-23, gap A). */}
        {member.onList ? (
          <div className="text-xs mt-1 flex flex-wrap items-center gap-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
            <span className="truncate">On your list as {member.onList.name}</span>
            {member.onList.nameCheck === 'differs' ? (
              <span
                data-testid="check-this-is-them"
                className="rounded-md px-1.5 py-0.5 font-medium flex items-center gap-1"
                style={{ background: 'rgba(255,138,31,0.12)', color: '#FF8A1F' }}
              >
                <AlertTriangle className="w-3 h-3" />
                Check this is them
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {seatIsFree(member) ? (
        /* A place the gym is not charged for: the owner's own §4.0-step-6 seat,
           and — since Kd's finding at the staff re-smoke (:14953) — anybody
           holding the keys, who has cost the gym nothing since :14401 while
           still looking on this screen exactly like somebody who does.

           No Remove control is drawn beside it, and that is the same rule as
           before rather than a new one: `removeMember` refuses anybody who is
           still staff, and an owner is member #1 of their own gym. A greyed
           control over a live refusal is the defect §2.2's own rules warn
           about; an absent one states nothing. Ending a staff member's
           membership is the Staff screen's two-stage flow. */
        <span
          className="text-xs rounded-lg px-2 py-1 flex-shrink-0"
          style={{ background: 'rgba(255,138,31,0.12)', color: '#FF8A1F' }}
        >
          Complimentary
        </span>
      ) : canRemove ? (
        /* §4.3: "Trainer role: … Remove hidden." A trainer reads this roster in
           full and is refused the removal itself, so the control is not drawn
           for them — same reasoning as the free place above, and the server's
           403 remains the enforcement (`canRemoveMembers`).
           **A LAPSED GYM IS THE OTHER CASE AND IT GREYS RATHER THAN HIDES.**
           The two look alike and are not: a trainer never has this power, so
           drawing nothing tells them nothing false; read-only is a temporary
           fact about the GYM, and a manager whose Remove button vanished would
           be left guessing whether their permissions had changed. */
        <RemoveControl
          member={member}
          busy={busy}
          readOnly={readOnly}
          words={words}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
}

/** Invitations whose person said "Not me" (RULINGS 2026-09-23, gap A): the gym has the
 *  wrong address for somebody on its list. Reads its own endpoint and owns its own
 *  failure, like the queue above; with nothing to check it draws nothing. */
function NotMeBox({ gymId, words }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    // Inside a promise, so even a call that throws at once is a failed read.
    Promise.resolve()
      .then(() => orgService.getNotMe(gymId))
      .then(
      (res) => {
        if (live) setItems(res.data?.items ?? []);
      },
      (err) => {
        if (live) setError(errorText(err, "We couldn't check your invitations."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId]);

  if (error !== null) {
    return (
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {error}
      </p>
    );
  }
  if (items === null || items.length === 0) return null;
  return (
    <section
      data-testid="not-me-box"
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(255,138,31,0.06)', border: '1px solid rgba(255,138,31,0.25)' }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#FF8A1F' }} />
        <div>
          <h2 className="text-sm font-semibold" style={{ color: '#fff' }}>
            {items.length === 1 ? 'An invitation reached the wrong person' : `${String(items.length)} invitations reached the wrong person`}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>
            Whoever gets email at these addresses said they aren&apos;t your {words.person}. Check the email address you have
            for them.
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.entryId} className="rounded-xl px-3 py-2 text-sm" style={{ background: '#121110' }}>
            <span className="font-medium" style={{ color: '#fff' }}>
              {item.fullName || 'No name'}
            </span>
            <span className="block truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {item.email}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Member list": closed until staff open it, so the roster stays the first thing seen. */
function MemberListCard({ gymId, gymName, words, readOnly, onApplied }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: '#fff' }}>
            Member list
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Upload or paste your list of {words.people} from a spreadsheet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={readOnly}
          className="rounded-xl px-4 min-h-[44px] text-sm font-semibold flex-shrink-0 disabled:opacity-40"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {open ? 'Close' : 'Bring in your list'}
        </button>
      </div>
      {open ? <MemberListUpload gymId={gymId} gymName={gymName} words={words} readOnly={readOnly} onApplied={onApplied} /> : null}
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
  const gymId = org?.id ?? null;
  // §4.3's "Remove hidden" for a trainer. Read off the SAME org row the screen
  // already has, so there is no second read to disagree with the first, and it
  // is false while the org is still loading — the roster cannot be on screen
  // before then anyway.
  const canRemove = canRemoveMembers(viewerPrivileges(org));
  // The gym's own list (and so what came back "Not me") is `members.confirm`'s.
  const canSeeList = viewerPrivileges(org).includes('members.confirm');
  // Part 3 §4.2's read-only console, off the org row this screen already holds
  // — no read of its own, and false while the org is still loading, which is
  // the safe direction: a screen with no roster on it yet has no control to
  // grey out.
  const readOnly = consoleIsReadOnly(org);
  // THE WORDS THIS SCREEN SPEAKS (roadmap 2b) — a gym has members, a studio
  // and a trainer have clients. Off the org row already in hand; the gym's
  // words while it loads, which is what every sentence here said before.
  const words = orgWords(org?.orgType);

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    orgService
      .getMembers(gymId, { limit: 50 })
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
        // §2.2 gives a trainer the member list for their own group only, and
        // nothing assigns groups yet, so a studio trainer is held out with a
        // 403 carrying its own sentence. Printing the empty state at them would
        // say the gym has no members, which is a different and false thing.
        const message =
          errorCode(err) === 'trainer_scope_unavailable'
            ? errorText(err, "Your role doesn't allow that.")
            : errorText(err, `We couldn't load the ${words.people}.`);
        setState({ loading: false, error: message, items: [], nextCursor: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt, words]);

  const retry = () => {
    setState({ loading: true, error: null, items: [], nextCursor: null });
    setAttempt((n) => n + 1);
  };

  /** A confirm from the queue above puts somebody INTO this list, so the list
   *  is re-read from page one rather than having a row assembled here out of
   *  two responses. The person is on screen the moment they are a member,
   *  which is what makes the tap feel like it did something — and every field
   *  shown is one the server just stated. */
  const reloadRoster = () => {
    setRemoveError(null);
    retry();
  };

  const removeMember = async (member) => {
    if (gymId === null) return;
    setRemovingId(member.userId);
    setRemoveError(null);
    try {
      await orgService.removeMember(gymId, member.userId);
      reloadRoster();
    } catch (err) {
      // The server's own sentence — a staff member cannot be removed here, and
      // that refusal explains itself better than anything this screen could
      // invent. The list is left exactly as it was, because nothing changed.
      setRemoveError(errorText(err, "We couldn't remove them. Please try again."));
    } finally {
      setRemovingId(null);
    }
  };

  const loadMore = async () => {
    if (gymId === null || state.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await orgService.getMembers(gymId, { limit: 50, cursor: state.nextCursor });
      setState((prev) => ({
        ...prev,
        // Appended, never replaced: the cursor walk is keyset-ordered on the
        // same pair the server sorts by, so pages tile rather than overlap.
        items: [...prev.items, ...(res.data?.items ?? [])],
        nextCursor: res.data?.nextCursor ?? null,
      }));
    } catch (err) {
      // The rows already on screen are real and stay. A failure to fetch the
      // NEXT page must not wipe the page a person is reading.
      setState((prev) => ({ ...prev, error: errorText(err, "We couldn't load any more.") }));
    } finally {
      setLoadingMore(false);
    }
  };

  if (orgLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your organisation…" />
      </div>
    );
  }

  if (orgError !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={orgError} onRetry={reload} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            We couldn&apos;t find an organisation you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: '#FF8A1F' }}>
            Your organisations
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const countLabel = memberCountLabel(
    { items: state.items, nextCursor: state.nextCursor },
    org?.orgType,
  );
  // §4.3's header meter. Null for a gym on no plan and for a capless band — both
  // are real states, and neither may be drawn as "0 of 0" (:5807). It does NOT
  // wait on the roster read: the numbers come off the org row, so a gym whose
  // member list failed to load still shows how full it is.
  const meter = seatMeter(org);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          {words.peopleCap}
        </h1>
        {!state.loading && state.error === null ? (
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {org.name} · {countLabel}
          </p>
        ) : null}
        {meter !== null ? (
          <p
            data-testid="seat-meter"
            className="text-sm mt-1 font-medium"
            /* §4.2's own threshold: amber at 90 % of cap. Below it the meter is
               a fact, not a warning, and colouring it would cry wolf for the
               290 days a gym is nowhere near its limit. */
            style={{ color: meter.pressure ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}
          >
            {/* The words are `seatLineText`'s. This header used to spell the
                full-gym clause out itself, which meant the banner overhead and
                the line under it were two copies of one sentence with nothing
                keeping them equal. */}
            {seatLineText(meter, org?.orgType)}
          </p>
        ) : null}
        {/* THE NOTE IS DRAWN WHERE THERE IS A GREYED CONTROL TO EXPLAIN, and on
            this screen that means somebody who may remove people. A trainer has
            no Remove button at all (§4.3), so for them this sentence would
            explain nothing that is on their screen — true, and noise, with
            §4.2's strip overhead already saying the gym has no plan. The
            waiting queue below carries its own sentence for its own reason. */}
        {readOnly && canRemove ? (
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {readOnlyNote(org?.orgType)}
          </p>
        ) : null}
      </div>

      {/* WAITING TO JOIN, above the roster. It reads its own endpoint and owns
          its own failure: a queue that cannot be read must never take the
          member list down with it, and a trainer — who may read the roster and
          may not confirm — sees no section rather than a refusal. */}
      <ApplicationsQueue
        gymId={gymId}
        orgType={org?.orgType}
        readOnly={readOnly}
        onRosterChanged={reloadRoster}
      />

      {/* Invitations that came back "Not me": only for staff who may see the list. */}
      {canSeeList ? <NotMeBox gymId={gymId} words={words} /> : null}

      {/* Bringing the gym's own list in (ROADMAP 5a): the same privilege the server asks. */}
      {canSeeList ? (
        <MemberListCard gymId={gymId} gymName={org.name} words={words} readOnly={readOnly} onApplied={reloadRoster} />
      ) : null}

      {state.loading ? <ConsoleLoading label={`Loading ${words.people}…`} /> : null}

      {/* T3 r1 L-3: `ConsoleFailed`'s own contract is "a failure ALWAYS offers a
          way out", and this one dead-ended. The way out of a failed removal is
          to re-read the roster — the person is still on it, their own Remove
          control is still there, and the fresh read settles whether the removal
          landed before the error did. */}
      {removeError !== null ? (
        <ConsoleFailed message={removeError} onRetry={reloadRoster} />
      ) : null}

      {!state.loading && state.error !== null ? (
        <ConsoleFailed message={state.error} onRetry={retry} />
      ) : null}

      {!state.loading && state.error === null && state.items.length === 0 ? (
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Nobody has joined yet.
          </p>
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Share your join code and {words.people} will appear here.
          </p>
        </ConsoleCard>
      ) : null}

      {state.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {state.items.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              words={words}
              busy={removingId === m.userId}
              canRemove={canRemove}
              readOnly={readOnly}
              onRemove={() => removeMember(m)}
            />
          ))}
        </div>
      ) : null}

      {state.nextCursor !== null ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="self-start rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
