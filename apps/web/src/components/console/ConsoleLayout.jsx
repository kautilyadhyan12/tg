import { Fragment } from 'react';
import { NavLink, Link, useParams } from 'react-router-dom';
import { Building2, Users, Settings, ChevronLeft, LogOut } from 'lucide-react';
import ConsoleBanner from './ConsoleBanner';
import PlanModal from './PlanModal';
import { useConsoleOrg } from '../../pages/console/useConsoleOrg';
import { useConsoleSignOut } from '../../pages/console/consoleSignOut';
import { canManageStaff } from '../../pages/console/staffView';
import { canManageOrg } from '../../pages/console/gymDetailsView';
import { viewerPrivileges } from '../../pages/console/consoleView';

// The console's own shell — Part 3 §3.1: "Responsive web app (owners live on
// phones; no native console app). Left rail (desktop) / bottom tabs (mobile)."
//
// IT IS NOT `AppLayout`, and that is the point. `AppLayout` positions its main
// column with a hard `marginLeft: collapsed ? 64 : 256` and its sidebar is
// `fixed` at a fixed width — there is no breakpoint anywhere in it, so on a
// phone the content starts 256px off the left edge. The console is the ONE
// surface Kd asked to be usable from a phone (:9604 §4), so it gets a shell
// that actually collapses: rail at `md` and above, tab bar below.
//
// Only the BUILT sections appear. §3.1 lists six (Overview · Members ·
// Leaderboard · Reports · Billing · Settings); Leaderboard, Reports and Billing
// have no server side at all and each has its own owed line. A greyed-out tab
// that answers nothing is a promise on screen, so they are absent rather than
// disabled.
//
// SETTINGS IS DRAWN FOR WHOEVER CAN USE SOMETHING ON IT — see
// `settingsIsReachable` below, and read that comment before narrowing this back.
//
// It used to say "the owner only", on the argument that the one thing on that
// screen was §4.7's Staff list, which §2.2 grants to the owner alone and the
// server gates with `staff.manage`, the READ included. That paragraph ended
// "it widens by itself the day Settings grows a section their role can use" —
// and 2026-08-26 is that day: Kd's `org.manage` ruling put the gym's own details
// there, and an owner may tick that across to a manager. Corrected here rather
// than only where it was noticed (:5748): this is the file somebody opens to ask
// who gets that tab.
//
// Knowing the role costs this shell NO REQUEST OF ITS OWN. It reads the same
// kept answer to "which gyms do I run, and what may I do there?" that the screen
// inside it resolves its own gym from (`pages/console/consoleOrgs.js`), so the
// shell and its screen are one read between them, and moving between console
// screens is none at all.
//
// This paragraph used to say "it is one extra request per console page", which
// was true when it was written and is the exact cost :16331 removed. Left as a
// correction rather than deleted: this is the first file somebody opens to ask
// how the console learns a role, and a stale answer here sends them looking for
// a read that no longer happens.
//
// THE WAY OUT IS SIGN OUT, NOT A LINK INTO THE MEMBER APP (Kd ruling
// 2026-08-19, mid-smoke on the login door). This shell used to end in "Back to
// the app" pointing at /dashboard; the mirror shortcut, `My Gym` in the member
// sidebar, went in the same ruling. The login page's two doors are now the ONLY
// way across in either direction: a person who wants the member app signs out
// and returns through "I'm a member". Re-adding a cross-link here re-opens it.
//
// It is also the console's ONLY exit — there was no sign-out on this shell at
// all, so removing the old link without adding this one would have locked an
// owner inside the console. `logout()` clears the door choice as well as the
// session, which is what keeps a gym's shared front-desk browser honest.

/** IS THERE ANYTHING ON SETTINGS THIS PERSON CAN USE?
 *
 *  The screen carries two sections now, gated on two different privileges, and
 *  this asks whether the viewer holds EITHER. Written out as one named function
 *  so a single line carries the guarantee and a mutant can point at it — the
 *  lesson :17676 recorded when a guarantee needed a two-line anchor.
 *
 *  **THE WIDENING IS THE POINT AND IT IS THE DAY THE COMMENT ABOVE PREDICTED.**
 *  This was `canManageStaff` alone, on the argument that the only thing on
 *  Settings was §4.7's owner-only Staff list. Kd's `org.manage` ruling put a
 *  second section there, and it is not owner-only by construction: an owner may
 *  tick it across to a manager (:11429 rule 3). Left as it was, that manager
 *  would hold a real power with NO TAB anywhere — and typing the address would
 *  land them on "Only the gym's owner can change these settings", which would be
 *  FALSE about them (:5807: on screen and wrong). */
function settingsIsReachable(privileges) {
  return canManageStaff(privileges) || canManageOrg(privileges);
}

const railBase = 'flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors';

function navStyle(active) {
  return {
    background: active ? 'rgba(255,138,31,0.14)' : 'transparent',
    color: active ? '#FF8A1F' : 'rgba(255,255,255,0.65)',
  };
}

export default function ConsoleLayout({ children }) {
  const { orgSlug } = useParams();
  // Asks nothing when there is no gym in the address (`/console`,
  // `/console/new`) — the hook returns early there. A failure is not handled
  // here on purpose: the screen inside reads the same list and owns the error
  // card, and a shell that drew a second one would stack two failures for one
  // dropped request. Unknown role simply means no Settings tab.
  const { org }     = useConsoleOrg(orgSlug);

  // `signingOut` is feedback, not a guard (T3 round 1, L8). The member sidebar
  // wraps its sign-out in `triggerTransition`, which covers the wait with an
  // overlay; this shell has no overlay, so without a pending state a press on a
  // slow connection looks like a dead button and invites a second press.
  //
  // MOVED INTO A HOOK 2026-08-28, unchanged in behaviour: the unskippable prompt
  // needs the same button (the rail and the tab bar are BEHIND its overlay), and
  // the gym-created screen draws that prompt outside this shell altogether.
  // Three copies of a sign-out is :1239's shape; one implementation is not.
  const { signingOut, signOut: handleSignOut } = useConsoleSignOut();

  // Nav only exists inside a gym. On "your gyms" and the create form there is
  // nothing to navigate between, so the rail carries the brand and the way OUT
  // — sign out — and nothing else. (It said "the way back into the app" until
  // 2026-08-19; that is the link this packet removed.)
  const tabs = orgSlug
    ? [
        { to: `/console/${orgSlug}`, end: true, icon: Building2, label: 'Gym' },
        { to: `/console/${orgSlug}/members`, end: false, icon: Users, label: 'Members' },
        ...(settingsIsReachable(viewerPrivileges(org))
          ? [{ to: `/console/${orgSlug}/settings`, end: false, icon: Settings, label: 'Settings' }]
          : []),
      ]
    : [];

  return (
    <div className="min-h-screen" style={{ background: '#0A0908' }}>
      {/* ── Desktop rail ──────────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex fixed left-0 top-0 h-full w-56 flex-col p-3 z-20"
        style={{ background: '#0D0C0B', borderRight: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="px-2 py-4">
          <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Gym console
          </div>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={railBase} style={({ isActive }) => navStyle(isActive)}>
              <t.icon className="w-4 h-4 flex-shrink-0" />
              <span>{t.label}</span>
            </NavLink>
          ))}
          {orgSlug ? (
            <Link to="/console" className={`${railBase} mt-2`} style={navStyle(false)}>
              <ChevronLeft className="w-4 h-4 flex-shrink-0" />
              <span>Your gyms</span>
            </Link>
          ) : null}
        </nav>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={`${railBase} w-full text-left disabled:opacity-50`}
          style={navStyle(false)}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </aside>

      {/* ── Content. `pb-24` on mobile keeps the last row clear of the tab bar,
             which is fixed and would otherwise sit on top of it. ──────────── */}
      <main className="md:ml-56 min-h-screen pb-24 md:pb-0">
        {/* Mobile-only top bar: the rail is hidden here, so this is the only
            way out of the console on a phone. */}
        <div
          className="md:hidden flex items-center justify-between px-4 h-14"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Gym console
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-sm disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {/* §4.2's persistent slot — "sits above all screens", which is why it is
            here and not on the Overview. It draws nothing at all until the gym
            is on a plan, and nothing on `/console` or `/console/new`, where
            there is no gym to be about (`org` is null and the machine's first
            question is what the gym is on).

            KEYED ON THE GYM for the same reason `Overview` keys the trial card:
            this shell does NOT remount when an owner walks from gym A to gym B,
            so the banner's `closedAt` — set purely to re-render on the press —
            outlived the gym it was about, and one dismissal silenced the other
            gym's banner for the rest of the day. Measured.

            `'no-gym'` covers `/console` and `/console/new`, where there is no
            gym and the banner draws nothing anyway. **IT IS EXPLICITNESS, NOT A
            GUARD — this comment claimed otherwise and the claim was false.** It
            said a bare `org?.id` "would quietly restore the bug for anyone
            navigating out through the gym list". Measured on that exact journey
            (gym A → the gym list → gym B), with a bare `org?.id`: gym B's banner
            draws correctly, because React reads `'A-id'` → `undefined` →
            `'B-id'` as two remounts, and the `undefined` leg is one of them.
            The control ran alongside it — with NO key at all the same journey
            DOES leak, so the instrument could fail and did not.

            Corrected rather than deleted (:5748): a false measurement in a
            comment is worse than no comment, because the next person reads it
            as evidence. The `?? 'no-gym'` stays — it says what the key is on
            those two routes instead of leaving a reader to work out what React
            does with `undefined`. */}
        <ConsoleBanner key={org?.id ?? 'no-gym'} org={org} />

        {/* ── THE GYM CHANGE, HANDLED ONCE, FOR EVERY CONSOLE SCREEN ────────
            Kd's ruling, 2026-08-28: the escape hatch fired on the FIFTH
            appearance of one class and he ruled REDESIGN rather than a fifth
            patch. This line is that redesign, and it is deliberately small.

            THE CLASS: `/console/:orgSlug` is ONE route and `/console/:orgSlug/
            members` is another, so walking from gym A to gym B re-renders the
            screen but does NOT remount it. Any answer a screen is holding —
            join codes, a roster, a member count, a started trial, a dismissed
            banner — outlives the gym it was about, while the gym's NAME comes
            off a row already in hand. The result is gym B's heading over gym
            A's data, and it is not a flicker: it lasts the whole round trip.
            Round 2 measured it at its worst — gym A's join code drawn twice
            under "Gym B" WITH A LIVE COPY BUTTON, and gym A's roster with live
            Remove buttons. A code copied there admits somebody to the wrong gym.

            **AND IT IS NOT REACHABLE BY A USER TODAY — measured, and said here
            because the sentence above reads as if it were.** The console offers
            no gym switcher: every path between two gyms goes through "Your
            gyms", which swaps `ConsoleHome` into the slot the screen was in, and
            a different component type in the same position is an UNMOUNT. The
            state is cleared on the way past. Measured on that real journey with
            the real list and rail link: gym A's code appears x0 under gym B both
            with this fix and without it. The leak is real in the screens and
            needs only a direct link to become visible — which a gym switcher is.

            So this line is bought cheaply BEFORE the feature that would expose
            it, not after. It is not repairing damage a user has seen.

            WHY HERE AND NOT IN THE SCREENS: the four fixes before this one were
            each a `key` on the one component that had just been caught
            (:20712, :20867, :20986, `TrialCard` below), which puts the
            guarantee in the memory of whoever adds the next panel. Five times
            out of six it was not remembered. Every console screen is drawn
            through this one `main`, so the invariant is stated once, here, and
            a screen added later cannot opt out of it or forget it —
            **PROVIDED it is still wrapped in this shell, which `App.jsx` does
            BY HAND for each route and which nothing enforced until round 3.**
            `gymSwitch.render.test.jsx` now reads `App.jsx` and fails if any
            `/console` route is drawn outside `ConsoleLayout`; without that,
            this paragraph was a promise resting on somebody remembering.

            KEYED ON THE SLUG, NOT THE GYM ROW: the slug is what actually
            changed, it comes straight off the address bar, and it is correct
            on the very first render of the new gym — whereas `org` is resolved
            from a list and is the thing that arrives EARLY and makes the stale
            panels look authoritative. `'no-gym'` covers `/console` and
            `/console/new`, which have no slug.

            THE COST, accepted in the ruling — AND NOBODY PAYS IT TODAY, which
            the ruling did not know and this paragraph used to imply otherwise.
            When a gym switcher exists, switching gym will show each screen's own
            "Loading…" for one round trip instead of the previous gym's details;
            that is the screen telling the truth about what it knows. On the only
            journey the console currently draws, the screen already remounts
            going past "Your gyms", so this key changes nothing a user sees.

            THE `screen:` PREFIX IS LOAD-BEARING AND THE GUARD PROVED IT. Written
            first as `orgSlug ?? 'no-gym'`, this collided with the banner's own
            `?? 'no-gym'` one line above — two SIBLINGS holding the same key on
            `/console` and `/console/new`, which is React dropping one of them
            without a word. :20986's duplicate-key guard failed the suite on it
            immediately, which is the second time that instrument has caught the
            fix for this class rather than the class itself. The prefix makes a
            collision impossible against the banner and against any gym id.

            The per-panel keys above and below are now redundant and are LEFT
            ALONE — a fix round carries only its fix (:5348 rule 6). */}
        <Fragment key={`screen:${orgSlug ?? 'no-gym'}`}>{children}</Fragment>
      </main>

      {/* ── THE PROMPT AN OWNER CANNOT SKIP — Kd's ruling (:22215, :22697) ───
          It is drawn HERE, from the shell, for §4.2's own reason about the
          banner: a prompt mounted on the Overview would leave the roster and
          Settings reachable by typing an address, which is a prompt somebody
          walks around rather than one they cannot skip. It draws nothing on
          `/console` and `/console/new`, where there is no gym to be about —
          which is also what makes "Your gyms" inside it a real exit rather than
          a way past.

          IT DECIDES NOTHING ITSELF: `planPromptFor` answers null for anybody
          without `billing.manage` (Kd, :22921 §1 — a trainer uses the console
          as normal), null for a gym on a live plan, and null for the api being
          too old to say whether this owner's trial is spent.

          KEYED, AND THE PREFIX IS LOAD-BEARING for the reason the wrapper above
          records: `ConsoleBanner` one line up already keys on `org?.id ??
          'no-gym'`, and two siblings holding the same key is React dropping one
          without a word (:20986's guard caught exactly that on the wrapper's
          own first draft). It needs a key at all because it holds state — a
          fetched price list, and the fact that the server has refused a trial —
          and this shell does not remount between two gyms. */}
      <PlanModal
        key={`plan-modal:${org?.id ?? 'no-gym'}`}
        org={org}
        onSignOut={handleSignOut}
        signingOut={signingOut}
      />

      {/* ── Mobile tab bar ────────────────────────────────────────────────── */}
      {tabs.length > 0 ? (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 flex z-20"
          style={{ background: '#0D0C0B', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className="flex-1 flex flex-col items-center gap-1 py-3 text-xs"
              style={({ isActive }) => ({ color: isActive ? '#FF8A1F' : 'rgba(255,255,255,0.55)' })}
            >
              <t.icon className="w-5 h-5" />
              <span>{t.label}</span>
            </NavLink>
          ))}
          <Link
            to="/console"
            className="flex-1 flex flex-col items-center gap-1 py-3 text-xs"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Your gyms</span>
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
