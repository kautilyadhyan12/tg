import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText, errorStatus } from '../../api/orgsApi';
import {
  expiresInLabel,
  nudgedLabel,
  waitingCountLabel,
  waitingForLabel,
} from './consoleView';

// WHO IS WAITING TO JOIN — the front desk's half of the door (Kd ruling
// 2026-08-19: typing a code applies, it does not join).
//
// IT LIVES ON THE MEMBERS SCREEN AND NOT IN A TAB OF ITS OWN. Part 3 §3.1 fixes
// the console's nav at six sections and this is none of them; §4.3 gives the
// Members screen the job of "the 30-second walk-in join", which is exactly this
// list. The layout shows only sections that are BUILT, so inventing a seventh
// tab would be the first promise on that rail nothing stands behind.
//
// THE COUNT IS THE SERVER'S, NEVER `items.length`. `pendingCount` is an exact
// count over the whole queue; a page of 3 out of 90 printing "3 people waiting"
// is a wrong number in front of a gym owner, which is the one thing the
// severity rule names outright.
//
// THE CLOCK IS THE SERVER'S AND THE SCREEN ONLY READS IT (:11385, step 3).
// Every row says how long somebody has waited, when their request runs out, and
// whether they have asked again — and "Needs a decision" is the `gymNotifiedAt`
// column verbatim, i.e. the SAME fact the expiry statement consults before it
// may delete anything. Deriving that mark from the dates here instead would put
// a second opinion on screen about whether the gym was warned.
//
// NOTHING ON THIS SCREEN CLAIMS A MESSAGE WAS SENT. No email exists in this
// product and there is no web push, so a member's nudge ARRIVES HERE and
// nowhere else, and the wording says what they did rather than what we
// delivered.
//
// A TRAINER SEES NOTHING HERE, SILENTLY. Confirming is owner-and-manager
// (§2.2's remove/restore row, and Kd's "ok only owner and manager"), so the
// server answers 403 — and a console must not draw a control it will then be
// refused. Hiding is not the enforcement; the server already refused. Any OTHER
// failure DOES show, with a retry, because "we couldn't check" and "you may not
// see this" are different sentences and only one of them is about a connection.

function ApplicantRow({ applicant, busy, onConfirm, onReject }) {
  // THE CLOCK, ON THE ROW. Every piece of it is derived from a field the SERVER
  // sent; the screen works nothing out for itself, so it cannot quote a
  // deadline the sweep disagrees with.
  const waiting = waitingForLabel(applicant.appliedAt);
  const expiring = expiresInLabel(applicant.expiresAt);
  const nudged = nudgedLabel(applicant.nudgedAt);
  // "NEEDS A DECISION" IS THE `gymNotifiedAt` COLUMN AND NOTHING ELSE — the
  // same fact the expiry statement reads before it may touch this row. A mark
  // computed here from the dates instead would be a second opinion about
  // whether the gym was warned, and the two could disagree on exactly the rows
  // where it matters.
  const flagged = typeof applicant.gymNotifiedAt === 'string';

  return (
    <div
      className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ background: '#121110', border: '1px solid rgba(255,138,31,0.22)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate flex items-center gap-2" style={{ color: '#fff' }}>
          <span className="truncate">{applicant.displayName}</span>
          {flagged ? (
            <span
              className="text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
            >
              Needs a decision
            </span>
          ) : null}
        </div>
        {/* KD RULING 2026-08-21 — THE CODE'S LABEL IS OFF THIS ROW.
            He raised it during the clock smoke ("Front Desk" on every row) and
            was told what it is for: Part 3 §2.1's group mechanism, the thing
            that tells a big gym which desk, class or campaign somebody came
            through. He then ruled names off join codes altogether — *"this kind
            of names not needed men"* — which settles it, because EVERY code now
            carries the same default label and the field can no longer
            distinguish anything. It was noise while a gym had one code; it is
            noise permanently until names come back.
            **The no-removal rule's AUTHORISED path**: an explicit ruling against
            a cited cost. `groupLabelText` and the roster's own column are
            UNTOUCHED (R1.1) — this is the row he named. */}
        <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {[waiting, expiring].filter(Boolean).join(' · ')}
        </div>
        {nudged !== null ? (
          <div className="text-xs mt-0.5" style={{ color: '#FF8A1F' }}>
            {nudged}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          style={{ background: '#FF8A1F', color: '#0A0908' }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Confirm
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' }}
        >
          Not this person
        </button>
      </div>
    </div>
  );
}

export default function ApplicationsQueue({ gymId, onRosterChanged }) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    forbidden: false,
    items: [],
    nextCursor: null,
    pendingCount: 0,
  });
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    orgService
      .getApplications(gymId, { limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          forbidden: false,
          items: res.data?.items ?? [],
          nextCursor: res.data?.nextCursor ?? null,
          pendingCount: res.data?.pendingCount ?? 0,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // The refusal is RECORDED like any other failure and the `forbidden`
        // flag is what decides whether it is ever drawn. Suppressing it here as
        // well was the first draft, and the mutation audit showed the two
        // guards masking each other: with both in place, deleting either
        // changed nothing observable, so neither could be caught failing.
        // One of them does the work now (:5104 F5 — a protection that cannot
        // fail is the same defect with a comment on it).
        setState({
          loading: false,
          error: errorText(err, "We couldn't check who's waiting to join."),
          forbidden: errorStatus(err) === 403,
          items: [],
          nextCursor: null,
          pendingCount: 0,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  // `changesRoster` is only true for CONFIRM. Refusing somebody adds nobody to
  // the member list, and re-reading it anyway would flash "Loading members…"
  // underneath a tap that changed nothing there — a screen implying something
  // moved when it did not.
  const decide = async (applicationId, call, changesRoster) => {
    setBusyId(applicationId);
    setActionError(null);
    try {
      await call();
      // The row leaves the list and the count follows it, so the two cannot
      // disagree while the page sits there. Both taps are idempotent
      // server-side, so a double press costs nothing.
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((a) => a.id !== applicationId),
        pendingCount: Math.max(0, prev.pendingCount - 1),
      }));
      if (changesRoster) onRosterChanged();
    } catch (err) {
      // The server's own sentence, and some of them carry a number this screen
      // could not know — "Your plan covers 3 members and they are all taken.
      // Add a seat, then confirm again — this person is still waiting." The
      // refresh puts the true state back on screen underneath it.
      setActionError(errorText(err, "That didn't go through. Please try again."));
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const loadMore = async () => {
    if (gymId === null || state.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await orgService.getApplications(gymId, { limit: 50, cursor: state.nextCursor });
      setState((prev) => ({
        ...prev,
        items: [...prev.items, ...(res.data?.items ?? [])],
        nextCursor: res.data?.nextCursor ?? null,
        // The count comes back with every page and is the whole-queue figure,
        // so taking the newest reading keeps it honest as people are confirmed
        // elsewhere while this list is open.
        pendingCount: res.data?.pendingCount ?? prev.pendingCount,
      }));
    } catch (err) {
      setActionError(errorText(err, "We couldn't load any more."));
    } finally {
      setLoadingMore(false);
    }
  };

  // A trainer, or a gym with nobody waiting: no section at all. Nothing false
  // is said by its absence, and an empty "nobody is waiting" panel on every
  // roster would be a permanent reminder of a thing that mostly does not
  // happen.
  //
  // THIS LINE IS THE WHOLE GUARANTEE and it is ORDERED ABOVE the error branch
  // on purpose: a trainer's 403 is recorded like any other failure, and this is
  // what stops it being drawn at them. Delete it and the Members screen tells a
  // trainer "Your role doesn't allow that" over a roster they are perfectly
  // entitled to read — which is what mutant J11 measures.
  if (state.forbidden) return null;
  if (state.loading) return <ConsoleLoading label="Checking who's waiting…" />;
  if (state.error !== null) return <ConsoleFailed message={state.error} onRetry={refresh} />;
  if (state.items.length === 0 && state.pendingCount === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: '#fff' }}>
          Waiting to join
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {waitingCountLabel(state.pendingCount)} — confirm the ones you recognise.
        </p>
      </div>

      {actionError !== null ? <ConsoleFailed message={actionError} onRetry={refresh} /> : null}

      {state.items.map((a) => (
        <ApplicantRow
          key={a.id}
          applicant={a}
          busy={busyId === a.id}
          onConfirm={() => decide(a.id, () => orgService.confirmApplication(gymId, a.id), true)}
          onReject={() => decide(a.id, () => orgService.rejectApplication(gymId, a.id), false)}
        />
      ))}

      {state.nextCursor !== null ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="self-start rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </section>
  );
}
