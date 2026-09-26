import { Link, useParams } from 'react-router-dom';
import { Building2, ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PAGE_ICONS } from '../../components/console/consoleIcons';
import { useConsoleOrg } from './useConsoleOrg';
import { useConsoleSignOut } from './consoleSignOut';
import { consoleMenu } from './consoleMenu';
import { roleLabel, viewerPrivileges } from './consoleView';

function Row({ to, icon: Icon, label }) {
  return (
    <Link to={to} className="c-row">
      <Icon size={22} className="c-t2" />
      <span className="c-s16 c-w6" style={{ flexGrow: 1 }}>
        {label}
      </span>
      <ChevronRight size={18} className="c-t3" />
    </Link>
  );
}

/** More, the phone's fifth tab (spec Part 3 §17.5): the pages that are not tabs, your
 *  organisations, and Sign out. It is drawn whatever the gym read answers, so the way out is
 *  always there. */
export default function More() {
  const { orgSlug } = useParams();
  const { user } = useAuth();
  const { org } = useConsoleOrg(orgSlug);
  const { signingOut, signOut } = useConsoleSignOut();

  const menu = consoleMenu(orgSlug, viewerPrivileges(org), org?.orgType);
  const name = user?.displayName || user?.email || '';
  const about = org ? [roleLabel(org.staffRole, org.orgType), org.name].filter(Boolean).join(' · ') : '';

  return (
    <div className="c-page c-narrow">
      <h1 className="c-h1">More</h1>

      <nav aria-label="More" data-testid="console-more" className="c-card" style={{ overflow: 'hidden' }}>
        {menu.more.map((page) => (
          <Row key={page.key} to={page.to} icon={PAGE_ICONS[page.key]} label={page.label} />
        ))}
        <Row to="/console" icon={Building2} label="Your organisations" />
      </nav>

      <div
        data-testid="console-more-you"
        className="c-card"
        style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {name ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="c-s15 c-w6 c-ell">{name}</span>
            {about ? <span className="c-s14 c-t2">{about}</span> : null}
          </div>
        ) : null}
        <button type="button" onClick={signOut} disabled={signingOut} className="c-btn c-btn-s c-btn-lg">
          <LogOut size={18} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
