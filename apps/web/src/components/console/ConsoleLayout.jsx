import { Fragment } from 'react';
import { orgWords } from '@app/shared';
import { NavLink, Link, useLocation, useParams } from 'react-router-dom';
import { Building2, ChevronsUpDown, Ellipsis, LogOut } from 'lucide-react';
import ConsoleBanner from './ConsoleBanner';
import PlanModal from './PlanModal';
import SizeDecisionPrompt from './SizeDecisionPrompt';
import { PAGE_ICONS } from './consoleIcons';
import { useAuth } from '../../context/AuthContext';
import { useConsoleOrg } from '../../pages/console/useConsoleOrg';
import { useConsoleSignOut } from '../../pages/console/consoleSignOut';
import { consoleLook, consoleMenu, moreIsCurrent } from '../../pages/console/consoleMenu';
import { orgTypeLabel, roleLabel, viewerPrivileges } from '../../pages/console/consoleView';
import './console.css';

// The console's own shell (spec Part 3 §3.1, §17): the menu on the left from 768 px; below
// that the gym's name on top and four tabs plus More at the bottom. It is not `AppLayout`,
// whose sidebar has no phone layout.
//
// The way out is Sign out, never a link into the member app (Kd, 2026-08-19): the login
// page's two doors are the only crossing. `logout()` also clears the door choice, which
// keeps a shared front-desk browser honest.
//
// The role comes from the same kept list of gyms the screen inside reads
// (`pages/console/consoleOrgs.js`), so the shell asks the server nothing of its own.

/** The gym's name at the top of the menu: tapping it opens "Your organisations". */
function GymSwitcher({ org, compact }) {
  const place = org ? [org.city, orgTypeLabel(org.orgType)].filter(Boolean).join(' · ') : '';
  const label = org
    ? `${org.name}${org.city ? `, ${org.city}` : ''}. Switch to another organisation`
    : 'Switch to another organisation';
  return (
    <Link to="/console" aria-label={label} className={compact ? 'c-topbar-gym' : 'c-switcher'}>
      <span className="c-gymicon">
        <Building2 size={compact ? 18 : 20} />
      </span>
      <span className="c-switcher-text">
        <span className={`${compact ? 'c-s16' : 'c-s15'} c-w6 c-ell`}>{org?.name ?? ''}</span>
        {!compact && place ? (
          <span className="c-s13 c-ell" style={{ color: 'var(--rail-t3)' }}>
            {place}
          </span>
        ) : null}
      </span>
      <ChevronsUpDown size={16} style={{ color: 'var(--rail-t3)' }} />
    </Link>
  );
}

export default function ConsoleLayout({ children }) {
  const { orgSlug } = useParams();
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  // Nothing is asked on `/console` and `/console/new`, which have no gym. A failed read is
  // the screen's to show; here it only means no role yet.
  const { org } = useConsoleOrg(orgSlug);
  const { signingOut, signOut } = useConsoleSignOut();

  const words = orgWords(org?.orgType);
  const menu = orgSlug ? consoleMenu(orgSlug, viewerPrivileges(org), org?.orgType) : null;
  const moreOn = menu ? moreIsCurrent(menu, pathname) : false;
  const name = user?.displayName || user?.email || '';
  const role = org ? roleLabel(org.staffRole, org.orgType) : '';
  const signOutWords = signingOut ? 'Signing out…' : 'Sign out';

  return (
    <div className={`c-console t-${consoleLook(search, import.meta.env.DEV)}`}>
      {/* ── The menu, on a computer ─────────────────────────────────────────── */}
      <aside className="c-rail" data-testid="console-rail">
        {menu ? <GymSwitcher org={org} /> : <div className="c-rail-title">{words.itCap} console</div>}

        {menu ? (
          <div className="c-rail-nav">
            <nav aria-label="Console" className="c-rail-nav">
              {menu.pages.map((page) => {
                const Icon = PAGE_ICONS[page.key];
                return (
                  <NavLink
                    key={page.key}
                    to={page.to}
                    end={page.end}
                    className={({ isActive }) => `c-nav${isActive ? ' c-nav-on' : ''}`}
                  >
                    <Icon size={20} />
                    <span>{page.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <Link to="/console" className="c-nav">
              <Building2 size={20} />
              <span>Your organisations</span>
            </Link>
          </div>
        ) : null}

        <div className="c-rail-fill" />

        <div className="c-rail-foot">
          {name ? (
            <div className="c-rail-you">
              <span className="c-s14 c-w6 c-ell">{name}</span>
              {role ? (
                <span className="c-s13" style={{ color: 'var(--rail-t3)' }}>
                  {role}
                </span>
              ) : null}
            </div>
          ) : null}
          <button type="button" onClick={signOut} disabled={signingOut} className="c-nav">
            <LogOut size={20} />
            <span>{signOutWords}</span>
          </button>
        </div>
      </aside>

      <main className="c-main">
        {/* ── The top bar, on a phone. With a gym it holds the gym's name, and Sign out is
               under More; without one (your organisations, create) Sign out is here. ── */}
        <header className="c-topbar" data-testid="console-topbar">
          {menu ? (
            <GymSwitcher org={org} compact />
          ) : (
            <>
              <span className="c-s15 c-w6" style={{ color: 'var(--rail-t2)' }}>
                {words.itCap} console
              </span>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="c-btn"
                style={{ height: 44, color: 'var(--rail-t2)' }}
              >
                <LogOut size={18} />
                {signOutWords}
              </button>
            </>
          )}
        </header>

        {/* Part 3 §4.2's banner, above every screen. Keyed on the gym because this shell is
            not remounted between gyms, and a dismissal must not outlive the gym it was for. */}
        <ConsoleBanner key={org?.id ?? 'no-gym'} org={org} />

        {/* Keyed on the slug so every screen starts fresh on another gym, and never shows
            the last gym's answers under the new gym's name (Kd, 2026-08-28). `screen:` keeps
            the key apart from the banner's `no-gym`. `gymSwitch.render.test.jsx` checks
            every console route is drawn inside this shell. */}
        <Fragment key={`screen:${orgSlug ?? 'no-gym'}`}>{children}</Fragment>
      </main>

      {/* The prompt an owner cannot skip (Kd, :22215, :22697), drawn from the shell so no
          console address walks around it; it decides nothing itself (`planPromptFor`).
          Keyed on the gym: it holds a price list and a refused trial. */}
      <PlanModal
        key={`plan-modal:${org?.id ?? 'no-gym'}`}
        org={org}
        onSignOut={signOut}
        signingOut={signingOut}
      />
      {/* A smaller size due soon that the gym's members do not fit: its billing staff choose. */}
      <SizeDecisionPrompt key={`size-decision:${org?.id ?? 'no-gym'}`} org={org} />

      {/* ── The tabs, on a phone ─────────────────────────────────────────────── */}
      {menu ? (
        <nav aria-label="Console" className="c-tabbar" data-testid="console-tabbar">
          {menu.tabs.map((page) => {
            const Icon = PAGE_ICONS[page.key];
            return (
              <NavLink
                key={page.key}
                to={page.to}
                end={page.end}
                className={({ isActive }) => `c-tab${isActive ? ' c-tab-on' : ''}`}
              >
                <Icon size={22} />
                <span>{page.label}</span>
              </NavLink>
            );
          })}
          <Link
            to={menu.moreTo}
            className={`c-tab${moreOn ? ' c-tab-on' : ''}`}
            aria-current={moreOn ? 'page' : undefined}
          >
            <Ellipsis size={22} />
            <span>More</span>
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
