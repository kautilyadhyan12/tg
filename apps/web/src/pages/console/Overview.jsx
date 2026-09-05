import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Users, ChevronRight } from 'lucide-react';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import JoinCodesPanel from '../../components/console/JoinCodesPanel';
import OverviewNumbers from '../../components/console/OverviewNumbers';
import TrialCard from '../../components/console/TrialCard';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { useAuth } from '../../context/AuthContext';
import { useConsoleOrg } from './useConsoleOrg';
import { consoleIsReadOnly } from './billingView';
import {
  codeToShow,
  joinedCount,
  memberCountLine,
  orgTypeLabel,
  roleLabel,
  viewerPrivileges,
  waitingCountLabel,
} from './consoleView';

// The gym's own screen. Part 3 §4.1 calls this Overview and specifies KPI tiles
// (active members 30d, workouts this week, adoption %, average form score), an
// eight-week trend chart and an at-risk list.
//
// ~~NONE OF THAT IS HERE, and the reason is not scope: §3.2 says every one of
// those widgets reads `org_daily_stats`, `org_live_counters` or
// `org_member_stats`, and not one of the three exists. There is no worker
// building them and no route serving them. A tile drawn over that would print a
// number nobody computed — which is the one thing the severity rule names
// outright.~~ **— SPENT 2026-09-02. The numbers are here** (`OverviewNumbers`,
// off `GET /v1/orgs/:gymId/overview`), and what they count is NOT what §4.1
// says:
//
//   · **VISITS, NOT WORKOUTS** — Kd's ruling at :29961, a knowing deviation from
//     §4.1 he was shown and took. A workout exists only if the member ALSO
//     logged their training, so a workout tile can read zero on a day forty
//     people came through the door.
//   · **Average form score is not built** — struck by him at :26469 §1.1. The
//     nightly job still WRITES the column, because a history nobody recorded
//     cannot be recovered.
//   · **The at-risk list and the rest of the people lists are the NEXT card**,
//     which is his split at :29961 ruling 3: numbers first, lists second.
//
// **`org_daily_stats` HAS A WRITER NOW AND STILL NO READER, and that is a
// decision rather than an oversight** (:30094 §2.1): a per-day DISTINCT count
// cannot be summed across days, and a nightly table is partial for part of every
// day. The route reads `gym_attendance` live. The aggregate is the durable
// record — Reports' source, and what survives the day attendance rows become
// deletable under DPDP, which is when this chart's source moves onto it.
//
// THE §4.2 BANNER USED TO BE ABSENT FOR THE SAME REASON AND IS NOT ANY MORE.
// This comment said "its states are read off `subscriptions`, and billing does
// not exist" — which was true when it was written and stopped being true on
// 2026-08-27, when a gym gained the ability to start its own trial and wrote the
// first `subscriptions` row in the product's history. Billing still does not
// exist; the STATE does, `/v1/orgs/mine` now carries it, and the banner lives in
// `ConsoleLayout` because §4.2 puts its slot above every console screen rather
// than on this one. Corrected here rather than only where it was noticed
// (:5748): this is the file somebody opens to ask why the console shows no
// banner.
//
// ~~The KPI tiles above are untouched by any of that — `org_daily_stats` and its
// two siblings still do not exist.~~ **— spent by the same card; see above.**

/* ROUND 2 Low-4's "would pressing Try again change anything?" predicate MOVED to
   `orgsApi.js` beside `errorStatus` (T3 round 2 L-5). It was private here, the
   Staff panel then inlined the same 403 test at two more sites, and three copies
   of one rule is how two places come to disagree. Its full reasoning travelled
   with it — Part 3 §4's "every error state has a retry" still holds for every
   status except the permanent one. */

/** One label/value line. Deliberately plain: every value on this screen is a
 *  fact the server stated, not a figure this page derived. */
function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {label}
      </span>
      <span className="text-sm text-right" style={{ color: 'rgba(255,255,255,0.85)' }}>
        {value}
      </span>
    </div>
  );
}

export default function Overview() {
  const { orgSlug } = useParams();
  const { user } = useAuth();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);

  // T3 L-3: TWO INDEPENDENTLY-AUTHORISED READS, TWO OUTCOMES.
  //
  // These were one `Promise.all`, and the two endpoints do not share an
  // authorisation answer: §2.2 grants a trainer Invite (the codes) while the
  // roster is held back for anyone whose group scoping does not exist yet — and
  // the API is deliberately built that way, with a test proving one trainer gets
  // 200 on codes and 403 on members. Collapsed together, that trainer lost the
  // WHOLE screen to "Trainer access to this list isn't available yet", under a
  // Try again that could never succeed. Each pane now reports its own outcome.
  //
  // Unreachable today (no route creates a trainer row), and fixed anyway: the
  // API's guarantee is real and tested, and a screen that cannot express it is
  // the client half of the same defect.
  const [codes, setCodes] = useState({ loading: true, error: null, retryable: true, list: null });
  const [members, setMembers] = useState({ loading: true, error: null, retryable: true, page: null });
  // :11385 — "the gym is reminded… a count the owner cannot miss". This is the
  // screen an owner lands on, so the number lives here as well as on the list
  // itself; a queue only visible after you go looking for it is not a reminder.
  //
  // A FAILURE HERE IS SILENT, and that is the difference between this pane and
  // the two above it. Those two are the screen's subject; this is a nudge, and
  // a person who may not confirm (a trainer, 403) or whose request blipped is
  // better told nothing than told the gym has nobody waiting — the count is
  // simply absent, and the Members screen states its own case when they open
  // it.
  const [waiting, setWaiting] = useState(null);
  // THE NUMBERS ARE A FOURTH INDEPENDENTLY-AUTHORISED READ, and they are the
  // clearest case on this screen for why L-3 above split the outcomes at all.
  //
  // `GET /v1/orgs/:gymId/overview` is gated on `attendance.read` — the ninth
  // privilege, default-on for all three roles and one an owner may UNTICK
  // (:28107 §2). So a real, reachable person meets a 403 here while every other
  // pane answers 200, and collapsing that into the screen's fate would take a
  // trainer's whole console away because their gym hid the attendance figures
  // from them. A refused read draws NOTHING — §4b: they lose the numbers, not
  // the screen — and `isRetryable` already knows a 403 is permanent, which is
  // what stops a Try again being offered for a button nobody can press.
  const [overview, setOverview] = useState({ loading: true, error: null, retryable: true, data: null });
  // WHO CAME TODAY — the names under the numbers, added 2026-09-03 at Kd's
  // instruction after he looked at the shipped screen: *"how can gym even get a
  // correct information from it … it should be like this many people came and
  // then if wants to see details can see this person with name … and if marked
  // again then show came two times again at this time"*.
  //
  // **IT IS THE EXISTING ATTENDANCE READ, NOT A NEW ENDPOINT.**
  // `GET /v1/orgs/:gymId/attendance` has served the day's people, their times
  // and the whole-day totals since :28221, and it is the same route the
  // Attendance screen this panel links to already uses. No server change.
  //
  // **A FAILURE HERE IS SILENT, and that is deliberate — the same reasoning as
  // the waiting count above.** These names are a PREVIEW of a screen reachable
  // in one click from the panel's own header; a second error card for a list the
  // owner can open themselves would be noise beside the numbers' own failure,
  // which IS reported. What must never happen is the reverse — the numbers
  // failing quietly — and that arm is separate.
  //
  // **IT SPENDS THE ATTENDANCE BUCKET** (`orgs_attendance_read`, 600/hour per
  // account, shared with the day and history reads — :28649 L-5). One read per
  // console open is inside that by a wide margin; **nothing here may poll,
  // refresh on focus or run on a timer**, and if this panel ever wants live
  // updates the limiter is what has to change first.
  const [day, setDay] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const gymId = org?.id ?? null;

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    // Still issued together — two waits on a phone is the thing `Promise.all`
    // was right about. `allSettled` keeps that and drops only the shared fate.
    void Promise.allSettled([
      orgService.getCodes(gymId),
      orgService.getMembers(gymId, { limit: 100 }),
      // `limit: 1` because only the COUNT is read here, and `pendingCount` is
      // an exact figure over the whole queue rather than this page's length —
      // so one row is enough and ninety would be wasted on a phone.
      orgService.getApplications(gymId, { limit: 1 }),
      orgService.getOverview(gymId),
      // No `day` and no `cursor`: the server decides which day is "today" in the
      // GYM's own zone (trap #8), and the first page is what a preview needs.
      // The query schema is `.strict()` and takes no `limit`, so the page size
      // is the server's; `previewPeople` decides how many reach the screen.
      orgService.getAttendanceDay(gymId, {}),
    ]).then(([codesOutcome, membersOutcome, waitingOutcome, overviewOutcome, dayOutcome]) => {
      if (cancelled) return;
      setCodes(
        codesOutcome.status === 'fulfilled'
          ? { loading: false, error: null, retryable: true, list: codesOutcome.value.data?.codes ?? [] }
          : {
              loading: false,
              error: errorText(codesOutcome.reason, "We couldn't load this gym's join code."),
              retryable: isRetryable(codesOutcome.reason),
              list: null,
            },
      );
      setMembers(
        membersOutcome.status === 'fulfilled'
          ? { loading: false, error: null, retryable: true, page: membersOutcome.value.data ?? null }
          : {
              loading: false,
              error: errorText(membersOutcome.reason, "We couldn't load this gym's members."),
              retryable: isRetryable(membersOutcome.reason),
              page: null,
            },
      );
      setWaiting(
        waitingOutcome.status === 'fulfilled'
          ? (waitingOutcome.value.data?.pendingCount ?? null)
          : null,
      );
      setOverview(
        overviewOutcome.status === 'fulfilled'
          ? {
              loading: false,
              error: null,
              retryable: true,
              data: overviewOutcome.value.data?.overview ?? null,
            }
          : {
              loading: false,
              error: errorText(overviewOutcome.reason, "We couldn't load this gym's numbers."),
              retryable: isRetryable(overviewOutcome.reason),
              data: null,
            },
      );
      setDay(dayOutcome.status === 'fulfilled' ? (dayOutcome.value.data?.attendance ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const retry = () => {
    setCodes({ loading: true, error: null, retryable: true, list: null });
    setMembers({ loading: true, error: null, retryable: true, page: null });
    setWaiting(null);
    setOverview({ loading: true, error: null, retryable: true, data: null });
    setDay(null);
    setAttempt((n) => n + 1);
  };

  /** Re-read the CODES ONLY, after the panel below changes one.
   *
   *  Not `retry()`, deliberately: bumping `attempt` re-runs all three reads, so
   *  pausing a code would blank and redraw the member count and the waiting
   *  figure — a whole-screen flash for a change that touched one list. Nothing
   *  else on this screen depends on a code.
   *
   *  It REJECTS on failure rather than swallowing, because the panel's own `run`
   *  is what reports to the owner: a refresh that failed silently would leave
   *  the change applied on the server and invisible on screen, which is the
   *  empty-vs-failed defect wearing a different hat. The panel is also the only
   *  caller, so there is no floating promise here (R2.5). */
  const reloadCodes = async () => {
    const res = await orgService.getCodes(gymId);
    setCodes({ loading: false, error: null, retryable: true, list: res.data?.codes ?? [] });
  };

  /** Re-read the NUMBERS ONLY, after a cheer goes out.
   *
   *  Not `retry()`, for `reloadCodes`'s reason one level up: bumping `attempt`
   *  re-runs all five reads, so a tap on one member's name would blank and
   *  redraw the join code, the member count, the waiting figure and the day's
   *  people — a whole-screen flash for a change that touched one row.
   *
   *  **WHAT IT IS ACTUALLY FETCHING is `cheerableAt`**, which is the server's
   *  answer to "when does this button reopen" and the only channel that carries
   *  it (the 409 deliberately omits the instant — `:34240` §6). The panel holds
   *  a local "just sent" flag for the seconds in between, so this read is what
   *  makes the sentence survive a reload and agree with a second browser.
   *
   *  **IT SWALLOWS ITS OWN FAILURE, WHICH IS THE OPPOSITE OF EVERY OTHER ARM ON
   *  THIS SCREEN, AND THAT IS THE POINT.** By the time it runs the cheer HAS
   *  landed — the panel returns before calling this if the send threw. An error
   *  card here would tell an owner their cheer failed when it did not, which is
   *  :5807 on a screen: a false statement about something that already happened.
   *  What is lost by staying quiet is one refreshed date, and the button is
   *  already dead behind the local flag. */
  const reloadOverview = async () => {
    try {
      const res = await orgService.getOverview(gymId);
      setOverview({
        loading: false,
        error: null,
        retryable: true,
        data: res.data?.overview ?? null,
      });
    } catch {
      // Deliberately nothing — see above. The cheer landed; only the refreshed
      // `cheerableAt` is missed, and the panel's own state covers the button.
    }
  };

  if (orgLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your gym…" />
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
            We couldn&apos;t find a gym you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: '#FF8A1F' }}>
            Your gyms
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const joined = joinedCount(members.page);
  // The viewer is PASSED, not assumed (round 2 Low-3): "(you)" is a claim about
  // who is reading, and this screen will one day be reachable by a manager.
  const countLine = memberCountLine(members.page, user?.id ?? null);
  const shownCode = codeToShow(codes.list);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          {org.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {org.city ? `${org.city} · ` : ''}
          {orgTypeLabel(org.orgType)}
        </p>
      </div>

      {/* THE PLAN, ABOVE THE JOIN CODE AND BELOW THE GYM'S NAME — what the gym
          is on, and how many places are used. A code handed out by a gym on no
          plan admits members who get nothing extra for being there, so the plan
          is stated first. Draws nothing at all for anybody without
          `billing.manage`, nothing for a gym on no plan, and needs no read of
          its own: both facts arrive on the org row this screen already has.

          THE CARD NO LONGER STARTS A TRIAL — Kd's ruling of 2026-08-28 (:22921
          §1). The pre-trial button is deleted and the unskippable prompt in
          `ConsoleLayout` is the only way a trial starts. A gym on no plan draws
          nothing here because that owner is looking at the prompt, over this
          whole screen.

          THE KEY IS KEPT AND IS NOW BELT-AND-BRACES, which is a change of
          status worth writing down rather than leaving to be inferred. It was
          :20712's fix applied to the fourth component to need it: this card held
          `justStarted` — the server's own answer to its button — and
          `/console/:orgSlug` is ONE route, so walking from gym A to gym B does
          not remount anything here and that answer followed the owner onto the
          next gym. **The card holds no state at all any more**: the fact moved
          into `consoleOrgs.js`, which is keyed by gym id by construction, and
          the shell wraps every screen in a keyed Fragment as well (:22029, Kd's
          redesign ruling). Left alone rather than deleted, on the same reasoning
          that left the other per-panel keys standing. */}
      <TrialCard key={org.id} org={org} />

      {/* ── The numbers, on their own outcome ──────────────────────────── */}
      {/* NO SPINNER OF ITS OWN, deliberately. All four reads are issued in one
          `allSettled` and land in one `.then`, so every pane on this screen
          flips at the same instant — a second spinner beside the codes one
          would be two pieces of furniture for one wait. What must never be
          silent is a FAILURE, and that is the arm below.

          THE DUPLICATE IS SUPPRESSED THE WAY ROUND 2's Low-4 established: when
          the connection drops, all four reads fail with the same sentence, and
          the fix for two identical error cards was never to give the third and
          fourth one each. The codes pane is the canonical one — it sits under
          this and is the screen's subject — so this draws only a failure the
          owner has not already been told about.

          A REFUSAL DRAWS NOTHING AT ALL. `isRetryable` is false for a 403, and
          a trainer whose gym unticked their attendance box is not missing
          anything they can act on; a red card on every visit to their own home
          screen would be noise about a decision their owner made. */}
      {!overview.loading && overview.error !== null && overview.retryable
      && overview.error !== codes.error && overview.error !== members.error ? (
        <ConsoleFailed message={overview.error} onRetry={retry} />
      ) : null}
      {!overview.loading && overview.error === null ? (
        <OverviewNumbers
          overview={overview.data}
          day={day}
          orgSlug={orgSlug}
          /* "Nobody came" and "nobody COULD come" are different sentences with
             different next moves, and the switch is what tells them apart
             (`emptyDayReason`'s rule, one screen over). It rides on the org row
             this screen already holds — no read of its own. */
          manualAttendanceEnabled={org.manualAttendanceEnabled}
          /* THE CHEER'S THREE FACTS, and each is a DIFFERENT question the panel
             cannot answer from the payload it draws.

             `privileges` — the overview read is gated on `attendance.read`
             while the cheer is gated on `members.read`. Two ticks, either of
             which an owner may take away, so a staffer can legitimately SEE
             this list and be refused the button on it. Drawing a live control
             over that is :12518 C/H-2 — the trainer handed a Remove button the
             server would refuse, one screen over.

             `readOnly` — a cheer is a WRITE, and :23711 put every write on this
             console behind the same gate. A lapsed gym stops acting on its
             members; the button greys with the server's own sentence.

             `onCheered` — the server owns `cheerableAt`. See `reloadOverview`. */
          gymId={org.id}
          privileges={viewerPrivileges(org)}
          readOnly={consoleIsReadOnly(org)}
          onCheered={reloadOverview}
        />
      ) : null}

      {/* ── The join code pane, on its own outcome ─────────────────────── */}
      {codes.loading ? <ConsoleLoading label="Loading…" /> : null}
      {!codes.loading && codes.error !== null ? (
        <ConsoleFailed message={codes.error} onRetry={codes.retryable ? retry : undefined} />
      ) : null}
      {!codes.loading && codes.error === null ? (
        shownCode !== null ? (
          <JoinCodeCard code={shownCode} />
        ) : (
          <ConsoleCard>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              This gym has no join code, so nobody can join it.
            </p>
          </ConsoleCard>
        )
      ) : null}

      {/* MANAGING the codes, under the one being handed out. Kept on Overview
          rather than given a tab of its own: §3.1 fixes the console's nav at six
          screens and surfaces Groups as a filter rather than a screen, and the
          confirm queue took the same decision one card ago. An owner looks for
          their code here, so the controls belong beside it.

          Drawn only on a SUCCESSFUL read: over a failed one the list is null,
          and a panel that rendered "New code" over a gym whose codes it could
          not read would offer a second code to a gym that may already be at its
          limit. The failure card above already says what happened, with the
          retry. */}
      {!codes.loading && codes.error === null ? (
        <JoinCodesPanel
          gymId={org.id}
          codes={codes.list}
          privileges={viewerPrivileges(org)}
          // Part 3 §4.2's read-only console. The codes are still SHOWN and still
          // copyable — read-only is about changing things, and a gym that cannot
          // mint a code can still read the one it has (:23711: it "seals nobody
          // out"). What goes quiet is minting, pausing, replacing and removing.
          readOnly={consoleIsReadOnly(org)}
          onChanged={reloadCodes}
        />
      ) : null}

      {/* ── The members pane, on ITS own outcome ───────────────────────── */}
      {/* ROUND 2 Low-4, second half: when BOTH reads fail the same way — which
          is the ordinary offline case — the L-3 split turned one error card into
          two identical ones with two Try again buttons. Two true sentences, and
          still a worse screen than the one it replaced. The duplicate is
          suppressed; the panes stay independent, which is the part that
          mattered. */}
      {!members.loading && members.error !== null && members.error !== codes.error ? (
        <ConsoleFailed message={members.error} onRetry={members.retryable ? retry : undefined} />
      ) : null}
      {!members.loading && members.error === null ? (
        <Link
          to={`/console/${orgSlug}/members`}
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,138,31,0.15)' }}
          >
            <Users className="w-5 h-5" style={{ color: '#FF8A1F' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold" style={{ color: '#fff' }}>
              {countLine ?? 'Members'}
            </div>
            {/* `joined` counts people who are NOT the owner's own complimentary
                seat, and is null when the page is truncated — in which case the
                roster is plainly not empty and this line does not appear. The
                count above says "1 member (you)" in this same case, so the two
                sentences agree instead of reading as a contradiction (L-5). */}
            {/* The waiting count outranks the empty-roster nudge: a gym with
                three people waiting has not got "nobody" to talk about, and
                telling them to share the code again would be the wrong next
                step by a mile. */}
            {typeof waiting === 'number' && waiting > 0 ? (
              <div className="text-xs mt-0.5 font-medium" style={{ color: '#FF8A1F' }}>
                {waitingCountLabel(waiting)} — confirm them here
              </div>
            ) : joined === 0 ? (
              <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Nobody has joined yet — share your code.
              </div>
            ) : null}
          </div>
          <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
        </Link>
      ) : null}

      <ConsoleCard>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Details
        </div>
        <Fact label="Currency" value={org.currencyDisplay} />
        <Fact label="Timezone" value={org.timezone} />
        <Fact label="Your role" value={roleLabel(org.staffRole)} />
      </ConsoleCard>
    </div>
  );
}
