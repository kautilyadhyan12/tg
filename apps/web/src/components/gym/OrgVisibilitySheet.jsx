import { Check, X } from 'lucide-react';

// PART 3 §2.4 — "the join screen shows a 'What {org} can see' sheet with
// exactly this list".
//
// THIS IS A HARD REQUIREMENT OF THE SPEC, NOT POLISH. §2.4 calls the boundary
// "a promise, not a setting" and names three things that make it real: the
// repos physically cannot join the forbidden tables, the member is told at join
// time, and Settings restates it on both sides. This component is the second of
// those three. Part 6 §2 lists it again beside join-by-code as an obligation
// the mobile app carries too — so when that screen is built it renders this
// list, it does not write a second one.
//
// THE LIST IS THE SPEC'S OWN, translated into words a person reads and not
// reworded past recognition. §2.4, verbatim, is:
//
//   Organizations see, for their members and only during the membership
//   interval: workout activity (dates, exercises, sets/reps/hold time,
//   duration), form scores & fault categories (from SetSummary — aggregates
//   and per-set values), streaks and challenge participation. Organizations
//   never see: meal logs or nutrition anything, body weight/measurements,
//   AI-coach conversations, run GPS routes, or activity from before joining /
//   after leaving.
//
// Two things a later edit must not do: drop a row because the feature behind it
// is not built yet (the promise is about what a gym may EVER see, not about
// this month's screens), and add a row because a new endpoint exists — a field
// added to the roster without re-reading §2.4 is how the promise gets broken,
// and this list is where the breach would become visible.
//
// The gym's NAME is optional on purpose. Before applying, the app has only a
// code: it does not know which gym it belongs to until the server answers, and
// a heading that guessed would be a false thing on screen. So the form shows
// the generic version and the answer shows the named one — same list, same
// component, no second copy to drift.

const CAN_SEE = [
  'The days you trained, which exercises, your sets, reps, hold time and how long you went for',
  'Your form scores and which faults came up',
  'Your streak, and any challenges you take part in',
];

const NEVER_SEES = [
  'Your meals, or anything about nutrition',
  'Your weight or body measurements',
  'Your conversations with the AI coach',
  'Where you ran — your routes on the map',
  'Anything from before you joined, or after you leave',
];

function Row({ children, tone }) {
  const good = tone === 'good';
  const Icon = good ? Check : X;
  return (
    <li className="flex items-start gap-2.5 py-1">
      <Icon
        className="w-4 h-4 flex-shrink-0 mt-0.5"
        style={{ color: good ? '#4ade80' : 'rgba(255,255,255,0.35)' }}
      />
      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {children}
      </span>
    </li>
  );
}

export default function OrgVisibilitySheet({ orgName = null }) {
  const who = typeof orgName === 'string' && orgName.trim() !== '' ? orgName : 'a gym';
  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: '#fff' }}>
        What {who} can see
      </h2>

      <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Only while you are a member.
      </p>

      <ul className="mt-3">
        {CAN_SEE.map((line) => (
          <Row key={line} tone="good">
            {line}
          </Row>
        ))}
      </ul>

      <div
        className="text-xs uppercase tracking-wider mt-4 mb-1"
        style={{ color: 'rgba(255,255,255,0.35)' }}
      >
        Never
      </div>
      <ul>
        {NEVER_SEES.map((line) => (
          <Row key={line} tone="bad">
            {line}
          </Row>
        ))}
      </ul>
    </section>
  );
}
