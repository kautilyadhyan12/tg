import { useEffect, useState } from 'react';
import { orgWords } from '@app/shared';
import { Link } from 'react-router-dom';
import { Building2, Clock, Loader2, XCircle } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { expiresInLabel, nextNudgeAfter, nextNudgeText } from '../../utils/joinClock';
import { gymStatusRows, nudgeState } from './gymMembershipView';
import GymHoursNote from './GymHoursNote';

// THE CARD THAT SITS ON TOP OF THE APP, and the words are the ruling's own:
// a person waiting for a gym keeps the WHOLE free app, so what they get is a
// card on their dashboard — never a locked screen, never a waiting room.
//
// IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY, and that includes when the
// reads FAIL. Everywhere else in this project an empty state drawn over a
// failed read is the defect (a real history reported as none); here the card is
// additive, so silence claims nothing at all. The opposite — a red error strip
// on the dashboard because a background request for gym status blipped — would
// be noise on the screen a person opens to start a workout.
//
// TWO READS, ISSUED TOGETHER, SETTLED SEPARATELY. `allSettled` and not `all`:
// they answer different questions and one failing must not silence the other,
// which is the same lesson the console's Overview learned in review.
//
// IT PROMISES NOTHING THE APP CANNOT DO. Still no "we'll email you", because
// email still does not exist. **The countdown, however, is now REAL** — the
// waiting room's clock shipped (:11385, step 3), so `expiresAt` is a date
// something actually acts on, and the `expired` arm below is finally reachable.
// Before this card that arm existed and no path in the product could produce
// it.
//
// **AND AS OF 2026-08-30 THAT COUNTDOWN HAS ONE STATE IN WHICH IT IS NOT REAL,
// which is why `expiresAt` is no longer enough on its own to draw it.** Kd
// ruled (:24141 §1) that a request to a gym with no live plan is HELD rather
// than expiring, so for those rows the sweep never acts on the date and the
// card must not quote it. `orgCanConfirm` is the field that says which state
// this is, and `WaitingRow` below is where both sentences change.

// THE WAITING ROW, and it is the only one with a control on it (:11385).
//
// THREE THINGS IT SAYS AND ONE IT MUST NOT. It names the gym, says when the
// request runs out (or that it is being HELD, and then says nothing about when
// — see `held` below), and offers "Remind them" — and it NEVER claims a message
// was sent anywhere, because none is. There is no email in this product and no
// web push, so the reminder arrives as a mark on the front desk's own queue,
// and the confirmation sentence says exactly that.
//
// **"REMIND THEM" STAYS ON A HELD ROW, AND THAT IS THE RULING RATHER THAN AN
// OVERSIGHT.** It is the one thing this person can still do; the mark really
// does land on the gym's queue, which is READ-only and not unreadable; and Kd
// ruled the join door does not refuse a lapsed gym (:24141 §1) — the nudge is
// the same question about the same dead end, so it gets the same answer.
// Nothing it says is false: the gym CAN see they are still waiting.
//
// THE ONCE-A-DAY RULE IS THE SERVER'S. `nudgeState` decides whether the button
// looks available, and a wrong answer here costs a refused tap and a truthful
// sentence — never a second reminder. R3.3 from the client's side: hiding is
// not the enforcement, and the enforcement is a database column.
function WaitingRow({ row }) {
  // The words this row speaks — the type of the place they applied to.
  const words = orgWords(row?.orgType);
  const [state, setState] = useState({ busy: false, sent: null, error: null });
  const expiring = expiresInLabel(row.expiresAt);
  const { ready } = nudgeState(row);
  // THE GYM HAS NO PLAN, SO NOBODY THERE CAN LET THIS PERSON IN (Kd's ruling of
  // 2026-08-29, :24141 §1). Two sentences on this card become FALSE in that
  // state and both are replaced below: "one tap at the front desk" describes a
  // tap the server refuses with a 409, and the countdown counts toward a
  // deadline the sweep no longer acts on. Either one left standing is :5807's
  // class — on screen and wrong.
  const held = row.orgCanConfirm === false;
  // A tap is refused while one is in flight, while today's is already spent,
  // and once this one lands. The sent state does not clear: re-offering the
  // button under "we've let them know" would invite a tap the server refuses.
  const canTap = ready && !state.busy && state.sent === null;

  const remind = async () => {
    setState({ busy: true, sent: null, error: null });
    try {
      const res = await orgService.nudgeApplication(row.applicationId);
      // BOTH ARMS ARE A SUCCESS. `already_sent` means today's reminder was
      // spent before this tap — the gym has been told either way, which is what
      // the person wanted to know, and treating it as a failure would send them
      // to try again over something that already worked.
      setState({ busy: false, sent: res.data, error: null });
    } catch (err) {
      setState({
        busy: false,
        sent: null,
        error: errorText(err, "We couldn't send that just now. Please try again."),
      });
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(255,138,31,0.15)' }}
      >
        <Clock className="w-4 h-4" style={{ color: '#FF8A1F' }} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: '#fff' }}>
          Waiting for {row.orgName} to confirm you
        </p>
        {/* WHY THE HELD SENTENCE SAYS NOTHING ABOUT A PLAN OR A PAYMENT: the
            person reading this is not staff of that gym, and the app must not
            tell a stranger holding a code which gyms have stopped paying —
            the boundary :23711 §2(a) ordered the gate's checks around, and the
            reason `consoleReadOnly` is staff-only. It says what is true and
            theirs to know: nobody can let them in yet, and their place is safe.

            AND IT STOPS THERE. It does not say the gym will confirm them when
            it is back — nothing in the product can put a gym back on a plan
            (measured 2026-08-29), so a held request whose deadline has already
            passed still needs the payment card to survive its first sweep after
            the gym subscribes. That is on `OWED.md`, and promising it here
            before it works is the same defect Card A refused to ship. */}
        <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {held
            ? `${row.orgName} can't take new ${words.people} right now. Your request is being held — it won't run out while that's the case.`
            : `Someone at the ${words.itToMembers} confirms new ${words.people} from their side — one tap at the front desk. Everything in the app keeps working meanwhile.`}
        </p>
        {/* The deadline comes off the server's own `expiresAt`, read through
            the SAME helper the gym's queue uses, so the two screens cannot
            quote different dates for one request. Absent rather than guessed
            when the field is missing or unreadable — and absent while the
            request is HELD, because then the date is not a deadline at all. */}
        {!held && expiring !== null ? (
          <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {expiring} — if that happens, just enter the code again.
          </p>
        ) : null}

        {/* T3 round 1, Low-2: this used to say "again tomorrow" from a constant
            while `nextNudgeAt` — the field added SO THE CLIENT WOULD NOT INVENT
            A TIME — sat unread. Often it is not tomorrow: a nudge at 13:00
            yesterday and a tap at 09:00 today makes the next slot 13:00 TODAY.
            The server's own time is what the sentence uses now. */}
        {state.sent !== null ? (
          <p className="text-sm mt-2" style={{ color: '#FF8A1F' }}>
            The {words.itToMembers} can see you&apos;re still waiting. You can do this again{' '}
            {nextNudgeText(state.sent.nextNudgeAt)}.
          </p>
        ) : null}
        {state.error !== null ? (
          <p className="text-sm mt-2" style={{ color: '#ef4444' }}>
            {state.error}
          </p>
        ) : null}
        {state.sent === null && row.applicationId !== null ? (
          <button
            type="button"
            onClick={remind}
            disabled={!canTap}
            className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            {state.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Remind them
          </button>
        ) : null}
        {/* Said, rather than left to be guessed from a greyed-out button — a
            control that refuses without explaining is the "greyed out with no
            reason" defect this project has named before.

            T3 round 1, Low-1: this used to say "you reminded them TODAY", which
            is a claim about the calendar that `ready` does not make. `ready` is
            "24 hours since the last one" — so a nudge at 23:00 on Monday and an
            app opened at 09:00 on Tuesday printed a sentence that was simply
            false. The wording now matches the rule that produced it. */}
        {!ready && state.sent === null && row.applicationId !== null ? (
          <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            You&apos;ve reminded them in the last day — you can do it again{' '}
            {nextNudgeText(nextNudgeAfter(row.nudgedAt))}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ row, onTryAgain }) {
  // The words this row speaks — the type of the place it is about.
  const words = orgWords(row?.orgType);
  if (row.kind === 'member') {
    return (
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,138,31,0.15)' }}
        >
          <Building2 className="w-4 h-4" style={{ color: '#FF8A1F' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: '#fff' }}>
            You&apos;re a {words.person} of {row.orgName}
          </p>
          {/* WHEN THE GYM IS OPEN — Kd ruled members see it (:26684 §2), and this
              row is the only one it belongs on: a person WAITING to join is not
              a member yet and the server's read would 404 them, while somebody
              REMOVED is being told their membership ended and does not need the
              timetable of a gym they cannot enter.

              It draws NOTHING until the gym has answered, and nothing on a failed
              read — see the component. That is what keeps this card additive. */}
          <GymHoursNote gymId={row.orgId} />
        </div>
      </div>
    );
  }

  if (row.kind === 'waiting') {
    return <WaitingRow row={row} />;
  }

  // REMOVED IS ITS OWN SENTENCE, and Kd ruled that it has to exist (2026-08-20).
  // This person was let IN and then taken OUT — they were never refused, so
  // reusing the refusal wording would be a second lie in place of the first
  // one. There is no "Try again" link either: re-applying to a gym that just
  // removed you is not the obvious next step, and offering it as one would be
  // the screen making a suggestion it has no basis for.
  if (row.kind === 'removed') {
    return (
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <Building2 className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.55)' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: '#fff' }}>
            You&apos;re no longer a {words.person} of {row.orgName}
          </p>
          {/* The sentence is the thing people actually fear when access ends,
              and it is TRUE — verified, not assumed: `removeMember` writes
              `gym_members` and `audit_log` and nothing else, and neither the
              workouts nor the gamification tables carry a gym at all.

              T3 ROUND 2 L2-1 CUT THE CLAUSE THAT USED TO FOLLOW IT — "the
              features your gym was paying for have ended". Nothing in this
              product creates a subscription yet (grep-verified: no statement
              anywhere inserts into `subscriptions`), and gym-sponsored
              entitlements require one, so NO gym has ever paid and a removed
              member loses nothing. It described a state no reader has ever
              been in. The clause comes back with billing, said by a screen
              that can actually check it. */}
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Everything you did there is still yours — your workouts, your form
            scores and your streak are unchanged. You keep the free app.
          </p>
        </div>
      </div>
    );
  }

  // Refused and expired are DIFFERENT SENTENCES because they are different
  // facts, and only one of them is about a decision somebody made. **Expired is
  // REACHABLE as of 2026-08-20** — the sweep writes it — where before that this
  // arm existed only because the status was in the contract this screen parses.
  // Its "ask again — it takes seconds" is now load-bearing rather than polite:
  // :11385 made re-applying free precisely so an expiry costs a real member
  // seconds instead of their place.
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(239,68,68,0.12)' }}
      >
        <XCircle className="w-4 h-4" style={{ color: '#ef4444' }} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: '#fff' }}>
          {row.kind === 'expired'
            ? `Your request to ${row.orgName} expired before anyone confirmed it`
            : `${row.orgName} didn't confirm your request`}
        </p>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Check with the {words.itToMembers}, then ask again — it takes seconds.
        </p>
        {onTryAgain ? (
          <button
            type="button"
            onClick={onTryAgain}
            className="text-sm font-medium inline-block mt-1.5"
            style={{ color: '#FF8A1F' }}
          >
            Try again
          </button>
        ) : (
          <Link to="/org/join" className="text-sm font-medium inline-block mt-1.5" style={{ color: '#FF8A1F' }}>
            Try again
          </Link>
        )}
      </div>
    </div>
  );
}

/** `refreshToken` — change it and the two reads run again.
 *
 *  T3 r1 L-6: on Settings → Gym this card sits directly ABOVE the code box, and
 *  it read once at mount. So the panel below could answer "You've asked to join
 *  Iron House" while the card an inch above it stayed blank, and only a page
 *  reload reconciled them — two views of one fact, disagreeing on screen. The
 *  dashboard passes nothing and keeps its single read.
 *
 *  **`showMemberships` — KD TOOK "You're a member of X" OFF THE DASHBOARD,
 *  2026-09-04**, looking at his own: *"the dashboard should not even show you
 *  are a memebr of xyz it is the part of gym ... it should have been in my gym
 *  as gym related things should be there"*. Two full-width boxes stood between
 *  his name and the Start Workout hero, on the screen somebody opens to train.
 *
 *  **NOTHING IS DELETED AND THIS PROP IS WHY.** `My Gyms` draws the membership
 *  and its opening hours in full, Settings → Gym still draws this card whole,
 *  and what the dashboard loses is one row KIND. The other three — waiting,
 *  removed, refused/expired — STAY on the dashboard, and that is deliberate
 *  rather than an oversight:
 *
 *  - a person still WAITING has no `My Gyms` item at all (`:28822` — it appears
 *    only once a gym approves them), so moving their row there would hide the
 *    only place they can see their request and press **Remind them**;
 *  - `:12660` is Kd's own ruling that a REMOVED member must be told, and that
 *    entry records silence as the other half of the bug it fixed;
 *  - refused and expired both end in *"ask again — it takes seconds"*, which is
 *    load-bearing (`:11385`) and pointless on a screen only members reach.
 *
 *  They are also rare and transient, where a membership row is permanent — so
 *  what he was looking at is gone and none of the sentences he ruled in are.
 *
 *  `onTryAgain` — for a screen with the code box already on it. "Try again" on
 *  a refused or expired request then calls it instead of linking to
 *  `/org/join`: onboarding's screen 11 passes one that puts the cursor in the
 *  box below, because an account that has not finished setup following that
 *  link is sent straight back to the wizard. */
export default function GymMembershipCard({ refreshToken = 0, showMemberships = true, onTryAgain }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([orgService.getMyApplications(), orgService.getMine()]).then(
      ([appsOutcome, orgsOutcome]) => {
        if (cancelled) return;
        setRows(
          gymStatusRows({
            applications:
              appsOutcome.status === 'fulfilled' ? appsOutcome.value.data?.applications : null,
            orgs: orgsOutcome.status === 'fulfilled' ? orgsOutcome.value.data?.orgs : null,
            // Same response, same settled outcome — a gym you were removed
            // from arrives beside the gyms you are still in.
            formerOrgs:
              orgsOutcome.status === 'fulfilled' ? orgsOutcome.value.data?.formerOrgs : null,
          }),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // FILTERED AT RENDER, NOT AT READ, so `rows` stays the whole truth: the same
  // state feeds a screen that shows memberships and one that does not, and a
  // later reader cannot be handed a list that quietly lost a kind.
  const visible = showMemberships ? rows : rows.filter((row) => row.kind !== 'member');

  // Still nothing when there is nothing to say — including a dashboard whose
  // only gym news is a membership. Silence claims nothing; see the header.
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {visible.map((row) => (
        <div
          key={row.orgId}
          className="rounded-2xl p-4"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Row row={row} onTryAgain={onTryAgain} />
        </div>
      ))}
    </div>
  );
}
