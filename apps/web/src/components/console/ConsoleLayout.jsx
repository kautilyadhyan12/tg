import { useState } from 'react';
import { NavLink, Link, useParams, useNavigate } from 'react-router-dom';
import { Building2, Users, Settings, ChevronLeft, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ConsoleBanner from './ConsoleBanner';
import { useConsoleOrg } from '../../pages/console/useConsoleOrg';
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
  const { logout }  = useAuth();
  const navigate    = useNavigate();
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
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    navigate('/login');
  };

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
            question is what the gym is on). */}
        <ConsoleBanner org={org} />
        {children}
      </main>

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
