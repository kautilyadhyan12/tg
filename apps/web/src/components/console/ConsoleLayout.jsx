import { NavLink, Link, useParams, useNavigate } from 'react-router-dom';
import { Building2, Users, ChevronLeft, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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
// Only the two BUILT sections appear. §3.1 lists six (Overview · Members ·
// Leaderboard · Reports · Billing · Settings); the other four have no server
// side at all and each has its own owed line. A greyed-out tab that answers
// nothing is a promise on screen, so they are absent rather than disabled.
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

  const handleSignOut = async () => {
    await logout();
    navigate('/login');
  };

  // Nav only exists inside a gym. On "your gyms" and the create form there is
  // nothing to navigate between, so the rail carries the brand and the way back
  // into the app and nothing else.
  const tabs = orgSlug
    ? [
        { to: `/console/${orgSlug}`, end: true, icon: Building2, label: 'Gym' },
        { to: `/console/${orgSlug}/members`, end: false, icon: Users, label: 'Members' },
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

        <button type="button" onClick={handleSignOut} className={`${railBase} w-full text-left`} style={navStyle(false)}>
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span>Sign out</span>
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
          <button type="button" onClick={handleSignOut} className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Sign out
          </button>
        </div>
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
