import { Link, useParams } from 'react-router-dom';
import { Building2, ChevronRight, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PAGE_ICONS } from '../../components/console/consoleIcons';
import { useConsoleOrg } from './useConsoleOrg';
import { useConsoleSignOut } from './consoleSignOut';
import { MENU_GROUPS, consoleMenu, menuGroups } from './consoleMenu';
import { roleLabel, viewerPrivileges } from './consoleView';
import { initialsOf } from './memberListPeople';
import { useAttention } from './useAttention';
import MenuCount from '../../components/console/MenuCount';

function Row({ to, icon: Icon, label, count }) {
  return (
    <Link to={to} className="c-more-row">
      <Icon size={20} className="c-t2" />
      <span className="c-s15 c-w5" style={{ flexGrow: 1, minWidth: 0 }}>
        {label}
      </span>
      {count !== undefined ? <MenuCount count={count} /> : null}
      <ChevronRight size={18} className="c-t3" />
    </Link>
  );
}

/** The pages under More in the menu's groups, with Your organisations and Your account at
 *  the end of Manage, which is drawn for them even when it holds no page of the gym's. */
function moreGroups(menu, orgSlug) {
  const groups = menuGroups(menu.more).map((g) => ({ ...g, rows: g.pages.map((p) => ({ key: p.key, to: p.to, icon: PAGE_ICONS[p.key], label: p.label })) }));
  let manage = groups.find((g) => g.key === 'manage');
  if (manage === undefined) {
    const label = MENU_GROUPS.find((g) => g.key === 'manage')?.label ?? 'Manage';
    manage = { key: 'manage', label, rows: [] };
    groups.push(manage);
  }
  manage.rows.push(
    { key: 'orgs', to: '/console', icon: Building2, label: 'Your organisations' },
    { key: 'account', to: `/console/${orgSlug}/account`, icon: UserRound, label: 'Your account' },
  );
  return groups;
}

/** More, the phone's fifth tab (spec Part 3 §17.5, §17.10): who you are, the pages that are
 *  not tabs in the menu's groups, your organisations, your account, and Sign out. It is drawn
 *  whatever the gym read answers, so the way out is always there. */
export default function More() {
  const { orgSlug } = useParams();
  const { user } = useAuth();
  const { org } = useConsoleOrg(orgSlug);
  const { signingOut, signOut } = useConsoleSignOut();

  const menu = consoleMenu(orgSlug, viewerPrivileges(org), org?.orgType);
  // What waits on each page (V1-d), read once by the console's shell.
  const { counts } = useAttention();
  const name = user?.displayName || user?.email || '';
  const about = org ? [roleLabel(org.staffRole, org.orgType, org.coOwner), org.name].filter(Boolean).join(' · ') : '';

  return (
    <div className="c-page c-narrow">
      <h1 className="sr-only">More</h1>

      {name ? (
        <div data-testid="console-more-me" className="c-card c-more-me">
          <span className="c-avatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="c-s15 c-w6 c-ell">{name}</span>
            {about ? <span className="c-s13 c-t2">{about}</span> : null}
          </span>
        </div>
      ) : null}

      <nav aria-label="More" data-testid="console-more" className="c-more-groups">
        {moreGroups(menu, orgSlug).map((group) => (
          <section key={group.key} aria-labelledby={`more-grp-${group.key}`} className="c-more-group">
            <h2 id={`more-grp-${group.key}`} className="c-more-grp">
              {group.label}
            </h2>
            <div className="c-card c-more-list">
              {group.rows.map((row) => (
                <Row key={row.key} to={row.to} icon={row.icon} label={row.label} count={counts[row.key]} />
              ))}
            </div>
          </section>
        ))}
      </nav>

      <div data-testid="console-more-you" className="c-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button type="button" onClick={signOut} disabled={signingOut} className="c-btn c-btn-s c-btn-lg">
          <LogOut size={18} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
