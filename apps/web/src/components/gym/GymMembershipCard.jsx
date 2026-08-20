import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Clock, XCircle } from 'lucide-react';
import { orgService } from '../../api/orgsApi';
import { gymStatusRows } from './gymMembershipView';

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
// It promises nothing the app cannot do. No "we'll email you", because email
// does not exist; no countdown, because nothing expires yet.

function Row({ row }) {
  if (row.kind === 'member') {
    return (
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,138,31,0.15)' }}
        >
          <Building2 className="w-4 h-4" style={{ color: '#FF8A1F' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: '#fff' }}>
            You&apos;re a member of {row.orgName}
          </p>
        </div>
      </div>
    );
  }

  if (row.kind === 'waiting') {
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
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Someone at the gym confirms new members from their side — one tap at the front desk.
            Everything in the app keeps working meanwhile.
          </p>
        </div>
      </div>
    );
  }

  // Refused and expired are DIFFERENT SENTENCES because they are different
  // facts, and only one of them is about a decision somebody made. Expired
  // cannot happen today (nothing writes it — the clock is its own card), and
  // the arm exists because the status is part of the contract this screen
  // parses, not because a path produces it.
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
          Check with the gym, then ask again — it takes seconds.
        </p>
        <Link to="/org/join" className="text-sm font-medium inline-block mt-1.5" style={{ color: '#FF8A1F' }}>
          Try again
        </Link>
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
 *  dashboard passes nothing and keeps its single read. */
export default function GymMembershipCard({ refreshToken = 0 }) {
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
          }),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div
          key={row.orgId}
          className="rounded-2xl p-4"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Row row={row} />
        </div>
      ))}
    </div>
  );
}
