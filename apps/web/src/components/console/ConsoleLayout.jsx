import { Fragment, useEffect, useRef, useState } from 'react';
import { orgWords } from '@app/shared';
import { NavLink, Link, useLocation, useParams } from 'react-router-dom';
import { Bell, Search, Building2, ChevronDown, ChevronsUpDown, CircleCheck, Ellipsis, LogOut, Plus, UserRound } from 'lucide-react';
import ConsoleBanner from './ConsoleBanner';
import PlanModal from './PlanModal';
import SizeDecisionPrompt from './SizeDecisionPrompt';
import { OpenUnder } from './ConsoleBoxes';
import { PAGE_ICONS } from './consoleIcons';
import { railScroller, scrollToShow } from './railScroll';
import { useAuth } from '../../context/AuthContext';
import { useConsoleOrg } from '../../pages/console/useConsoleOrg';
import { useConsoleSignOut } from '../../pages/console/consoleSignOut';
import { consoleLook, consoleMenu, menuGroups, moreIsCurrent, readFolded, writeFolded } from '../../pages/console/consoleMenu';
import { newMenu } from '../../pages/console/consoleNew';
import { attentionLines, bellLabel, countText, menuCounts, moreCount, seesAnyPart } from '../../pages/console/attentionView';
import { AttentionContext, useAttentionRead } from '../../pages/console/useAttention';
import MenuCount from './MenuCount';
import SearchField from './ConsoleSearch';
import { opensSearch, searchCatalogue, searchKeysLabel, searchPlaceholder } from '../../pages/console/searchPlaces';
import { initialsOf } from '../../pages/console/memberListPeople';
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

/** The gym's name at the top of the menu: tapping it opens "Your organisations". With no
 *  gym to name (still loading, or an address that is not one of the person's gyms) it
 *  says whose console this is, as the menu did before R1. */
function GymSwitcher({ org, fallback, compact }) {
  const place = org ? [org.city, orgTypeLabel(org.orgType)].filter(Boolean).join(' · ') : '';
  const title = org?.name ?? fallback;
  const label = `${title}${org?.city ? `, ${org.city}` : ''}. Switch to another organisation`;
  return (
    <Link to="/console" aria-label={label} className={compact ? 'c-topbar-gym' : 'c-switcher'}>
      <span className="c-gymicon">
        <Building2 size={compact ? 18 : 20} />
      </span>
      <span className="c-switcher-text">
        <span className={`${compact ? 'c-s16' : 'c-s15'} c-w6 c-ell`}>{title}</span>
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

/** One line of the menu on a computer. */
function RailLink({ page, dot }) {
  const Icon = PAGE_ICONS[page.key];
  return (
    <NavLink to={page.to} end={page.end} className={({ isActive }) => `c-nav${isActive ? ' c-nav-on' : ''}`}>
      <Icon size={18} />
      <span className="c-ell">{page.label}</span>
      {dot}
    </NavLink>
  );
}

/** The glowing dot beside Members, and what it means to a screen reader. */
function ReviewDot({ count, words }) {
  return (
    <>
      <span className="c-glow-dot" aria-hidden="true" data-testid="review-dot" />
      <span className="sr-only">{`, ${String(count)} ${count === 1 ? `${words.person} needs` : `${words.people} need`} review`}</span>
    </>
  );
}

/** The browser's own store for this device, or null where it refuses (a private window). */
function deviceStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** One of the menu's five groups. Pressing its heading folds it; a folded group keeps its
 *  heading, so it is one press from open again, and a dot of a page inside it (Review needed
 *  on Members) moves to the heading, so nothing waiting is folded out of sight. */
function RailGroup({ group, folded, onToggle, dot }) {
  const listId = `rail-list-${group.key}`;
  const waiting = folded ? (group.pages.map((page) => dot(page)).find((d) => d !== null) ?? null) : null;
  return (
    <div role="group" aria-labelledby={`rail-grp-${group.key}`} className="c-rail-group">
      <p className="c-rail-grp">
        <button
          type="button"
          id={`rail-grp-${group.key}`}
          className="c-rail-grp-btn"
          aria-expanded={!folded}
          aria-controls={listId}
          onClick={onToggle}
        >
          <span className="c-rail-grp-name">
            {group.label}
            {waiting}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </p>
      <div id={listId} className="c-rail-list" hidden={folded}>
        {group.pages.map((page) => (
          <RailLink key={page.key} page={page} dot={dot(page)} />
        ))}
      </div>
    </div>
  );
}

/** You, at the foot of the menu: your name and role. Pressing it opens Your account and Your
 *  organisations (on a business's pages) and Sign out. */
function YouMenu({ name, role, accountTo, onAccount, withOrganisations, signOut, signingOut }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`c-rail-me${onAccount ? ' c-rail-me-on' : ''}`}
        aria-current={onAccount ? 'page' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="c-rail-av" aria-hidden="true">
          {name ? initialsOf(name) : <UserRound size={16} />}
        </span>
        <span className="c-rail-you">
          <span className="c-s14 c-w6 c-ell" style={{ color: 'var(--rail-t1)' }}>
            {name || 'Your account'}
          </span>
          {role ? (
            <span className="c-s12 c-ell" style={{ color: 'var(--rail-t3)' }}>
              {role}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <OpenUnder anchorRef={anchor} label={name || 'Your account'} onClose={close}>
          <div className="c-menu-list">
            {accountTo ? (
              <Link to={accountTo} className="c-menu-row" onClick={close}>
                <UserRound size={18} aria-hidden="true" />
                Your account
              </Link>
            ) : null}
            {withOrganisations ? (
              <Link to="/console" className="c-menu-row" onClick={close}>
                <Building2 size={18} aria-hidden="true" />
                Your organisations
              </Link>
            ) : null}
            <button type="button" className="c-menu-row" onClick={signOut} disabled={signingOut}>
              <LogOut size={18} aria-hidden="true" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </OpenUnder>
      ) : null}
    </>
  );
}

/** The bell, in the bar across the top and the phone's top bar (spec Part 3 §17.11): its count
 *  is the number of kinds of thing waiting, and it opens "Needs attention" under itself, the
 *  same lines from any page, each opening the place it is dealt with. Opening it reads again. */
function BellButton({ lines, onOpen }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="c-bell"
        aria-label={bellLabel(lines)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="console-bell"
        onClick={() => {
          if (!open) onOpen();
          setOpen((was) => !was);
        }}
      >
        <Bell size={20} aria-hidden="true" />
        {lines.length > 0 ? (
          <span className="c-bell-pip" aria-hidden="true">
            {countText(lines.length)}
          </span>
        ) : null}
      </button>
      {open ? (
        <OpenUnder anchorRef={anchor} label="Needs attention" onClose={close}>
          <div className="c-attn" data-testid="needs-attention">
            <div className="c-attn-head">
              <h2 className="c-s17 c-w6 c-t1">Needs attention</h2>
              {lines.length > 0 ? <span className="c-s12 c-t3">{lines.length === 1 ? '1 item' : `${String(lines.length)} items`}</span> : null}
            </div>
            {lines.length === 0 ? (
              <p className="c-attn-none c-s14 c-w6">
                <CircleCheck size={18} aria-hidden="true" />
                Nothing needs attention
              </p>
            ) : (
              lines.map((line) => (
                <div key={line.key} className="c-attn-row" data-testid="attention-line">
                  <span className={`c-attn-dot${line.tone === 'plain' ? '' : ` c-attn-dot-${line.tone}`}`} aria-hidden="true" />
                  <span className="c-attn-text">
                    <span className="c-s14 c-w6 c-t1">{line.title}</span>
                    {line.note !== null ? <span className="c-s13 c-t3">{line.note}</span> : null}
                  </span>
                  <span className="c-attn-end">
                    {line.money !== null ? <span className="c-s14 c-w6 c-t1">{line.money}</span> : null}
                    {line.to !== null ? (
                      <Link to={line.to} className="c-btn c-btn-s c-btn-sm" onClick={close} aria-label={`${line.button}: ${line.title}`}>
                        {line.button}
                      </Link>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </div>
        </OpenUnder>
      ) : null}
    </>
  );
}

/** New, in the bar across the top (spec Part 3 §17.11): what this person may add, each line
 *  opening that page's own box. While the business can change nothing it says why instead. */
function NewButton({ offer }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="c-btn c-btn-soft"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Plus size={18} aria-hidden="true" />
        New
      </button>
      {open ? (
        <OpenUnder anchorRef={anchor} label="New" onClose={close}>
          {offer.note !== null ? (
            <p className="c-s14 c-t2">{offer.note}</p>
          ) : (
            <div className="c-menu-list">
              {offer.items.map((item) => {
                const Icon = PAGE_ICONS[item.icon];
                return (
                  <Link key={item.key} to={item.to} className="c-menu-row" onClick={close}>
                    <Icon size={18} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </OpenUnder>
      ) : null}
    </>
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
  const consoleName = `${words.itCap} console`;
  const menu = orgSlug ? consoleMenu(orgSlug, viewerPrivileges(org), org?.orgType) : null;
  // Members glows while an import left anybody to review (5b-v-d-iv; Kd: "if gym dont see
  // them they will forget"). The server counts it only for staff who may see the list.
  const toReview = org?.membersNeedReview ?? 0;
  const reviewDot = (page) => (page.key === 'members' && toReview > 0 ? <ReviewDot count={toReview} words={words} /> : null);
  const moreOn = menu ? moreIsCurrent(menu, pathname) : false;
  const name = user?.displayName || user?.email || '';
  const role = org ? roleLabel(org.staffRole, org.orgType, org.coOwner) : '';
  const signOutWords = signingOut ? 'Signing out…' : 'Sign out';
  const offer = orgSlug ? newMenu(orgSlug, viewerPrivileges(org), org) : { items: [], note: null };
  const showNew = offer.items.length > 0 || offer.note !== null;
  // What waits (V1-d): one read for the menu's counts, the bell and More.
  const { attention, reload: reloadAttention } = useAttentionRead(org?.id ?? null, menu !== null && org != null);
  const lines = attentionLines(attention, orgSlug, viewerPrivileges(org), org?.orgType);
  const counts = menuCounts(lines);
  const showBell = menu !== null && seesAnyPart(attention);
  /** A page's mark in the menu: its count where something waits, else Members' Review needed dot. */
  const mark = (page) => (counts[page.key] !== undefined ? <MenuCount count={counts[page.key]} /> : reviewDot(page));
  const underMore = menu ? moreCount(menu.more, counts) : null;

  // Search (V1-e-i): the box in the bar, typed in where it is; on a phone the top bar's search
  // button turns the top bar into that box; Ctrl K / ⌘K puts the cursor in whichever is on screen.
  // What waits (the bell's lines) is found too.
  const catalogue = orgSlug ? searchCatalogue(orgSlug, viewerPrivileges(org), org, lines) : [];
  const [phoneSearch, setPhoneSearch] = useState(false);
  const barInput = useRef(null);
  const canSearch = menu !== null;
  useEffect(() => {
    if (!canSearch) return undefined;
    const onKey = (event) => {
      if (!opensSearch(event)) return;
      event.preventDefault();
      if (barInput.current !== null && barInput.current.offsetParent !== null) barInput.current.focus();
      else setPhoneSearch(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSearch]);
  // Another page (Back, a link) closes the phone's search.
  const [searchPath, setSearchPath] = useState(pathname);
  if (pathname !== searchPath) {
    setSearchPath(pathname);
    setPhoneSearch(false);
  }
  const placeholder = searchPlaceholder(org?.orgType);

  // The groups this person folded on this device, kept as they left them. The page they are on
  // is never folded away: arriving on it shows its group open for this visit only, and the
  // device keeps their choice.
  const [folded, setFolded] = useState(() => readFolded(deviceStore()));
  const currentGroup = menu?.pages.find((p) => pathname === p.to || (!p.end && pathname.startsWith(`${p.to}/`)))?.group ?? null;
  const [openNow, setOpenNow] = useState(null);
  const [groupSeen, setGroupSeen] = useState(null);
  if (currentGroup !== groupSeen) {
    setGroupSeen(currentGroup);
    setOpenNow(currentGroup);
  }
  const isFolded = (key) => folded.includes(key) && openNow !== key;
  const toggleGroup = (key) => {
    if (isFolded(key)) setFolded((was) => was.filter((k) => k !== key));
    else if (folded.includes(key)) setOpenNow(null);
    else {
      setFolded((was) => [...was, key]);
      if (openNow === key) setOpenNow(null);
    }
  };
  useEffect(() => {
    writeFolded(deviceStore(), folded);
  }, [folded]);

  // A page opened from somewhere else than the menu (a button, a link, a reload) has its lit
  // line on screen in the menu too. In a short window the whole menu scrolls, and you and
  // Sign out stay over its foot, so the line is kept clear of them.
  const railRef = useRef(null);
  const navRef = useRef(null);
  const pageCount = menu ? menu.pages.length : 0;
  useEffect(() => {
    const rail = railRef.current;
    const box = railScroller(rail, navRef.current);
    const on = rail?.querySelector('nav .c-nav-on') ?? null;
    const cover = box === rail ? (rail?.querySelector('.c-rail-me')?.offsetHeight ?? 0) : 0;
    scrollToShow(box, on, 8 + cover);
  }, [pathname, pageCount]);

  return (
    <div className={`c-console t-${consoleLook(search, import.meta.env.DEV)}`}>
      {/* ── The menu, on a computer ─────────────────────────────────────────── */}
      <aside ref={railRef} className="c-rail" data-testid="console-rail">
        {menu ? <GymSwitcher org={org} fallback={consoleName} /> : <div className="c-rail-title">{consoleName}</div>}

        {menu ? (
          <nav ref={navRef} aria-label="Console" className="c-rail-nav">
            {/* Overview on top, then the five groups (spec Part 3 §17.10 rule 7). */}
            <RailLink page={menu.pages[0]} dot={mark(menu.pages[0])} />
            {menuGroups(menu.pages).map((group) => (
              <RailGroup
                key={group.key}
                group={group}
                folded={isFolded(group.key)}
                onToggle={() => toggleGroup(group.key)}
                dot={mark}
              />
            ))}
          </nav>
        ) : (
          <div className="c-rail-fill" />
        )}

        {/* Always on screen, however short the window: the list above scrolls on its own. Your
            name opens Your account (Delete account is in it, 19b-ii), Your organisations and
            Sign out. */}
        <div className="c-rail-foot">
          <YouMenu
            name={name}
            role={role}
            accountTo={menu ? `/console/${orgSlug}/account` : null}
            onAccount={menu !== null && pathname === `/console/${orgSlug}/account`}
            withOrganisations={menu !== null}
            signOut={signOut}
            signingOut={signingOut}
          />
        </div>
      </aside>

      <main className="c-main">

        {/* ── The top bar, on a phone. With a gym it holds the gym's name, and Sign out is
               under More; without one (your organisations, create) Sign out is here. ── */}
        <header className="c-topbar" data-testid="console-topbar">
          {menu && phoneSearch ? (
            <SearchField key={`phone:${pathname}`} phone orgSlug={orgSlug} catalogue={catalogue} placeholder={placeholder} onLeave={() => setPhoneSearch(false)} />
          ) : menu ? (
            <>
              <GymSwitcher org={org} fallback={consoleName} compact />
              <span className="c-topbar-end">
                <button type="button" className="c-bell" aria-label="Search" onClick={() => setPhoneSearch(true)} data-testid="console-search-phone">
                  <Search size={20} aria-hidden="true" />
                </button>
                {showBell ? <BellButton lines={lines} onOpen={reloadAttention} /> : null}
                {name ? (
                  <Link to={menu.moreTo} className="c-topbar-me" aria-label={`${name}: your account and Sign out, under More`}>
                    <span className="c-rail-av" aria-hidden="true">
                      {initialsOf(name)}
                    </span>
                  </Link>
                ) : null}
              </span>
            </>
          ) : (
            <>
              <span className="c-s15 c-w6" style={{ color: 'var(--rail-t2)' }}>
                {consoleName}
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

        {/* Part 3 §4.2's banner, at the very top of every screen, above the bar with New (Kd,
            V1-c's click-through). Keyed on the gym because this shell is not remounted between
            gyms, and a dismissal must not outlive the gym it was for. */}
        <ConsoleBanner key={org?.id ?? 'no-gym'} org={org} />

        {/* The bar across the top, on a computer: Search for everybody, New for whoever may add
            something, and the bell. */}
        {menu ? (
          <div className="c-pagebar" data-testid="console-bar">
            <SearchField key={`bar:${pathname}`} inputRef={barInput} orgSlug={orgSlug} catalogue={catalogue} placeholder={placeholder} keys={searchKeysLabel(typeof navigator === 'undefined' ? '' : navigator.platform)} />
            {showNew ? <NewButton offer={offer} /> : null}
            {showBell ? <BellButton lines={lines} onOpen={reloadAttention} /> : null}
          </div>
        ) : null}

        {/* Keyed on the slug so every screen starts fresh on another gym, and never shows
            the last gym's answers under the new gym's name (Kd, 2026-08-28). `screen:` keeps
            the key apart from the banner's `no-gym`. `gymSwitch.render.test.jsx` checks
            every console route is drawn inside this shell. */}
        <AttentionContext.Provider value={{ attention, counts, reload: reloadAttention }}>
          <Fragment key={`screen:${orgSlug ?? 'no-gym'}`}>{children}</Fragment>
        </AttentionContext.Provider>
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
                <span className="c-tab-icon">
                  <Icon size={22} />
                  {mark(page)}
                </span>
                <span>{page.tabLabel ?? page.label}</span>
              </NavLink>
            );
          })}
          <Link
            to={menu.moreTo}
            className={`c-tab${moreOn ? ' c-tab-on' : ''}`}
            aria-current={moreOn ? 'page' : undefined}
          >
            <span className="c-tab-icon">
              <Ellipsis size={22} />
              {underMore !== null ? <MenuCount count={underMore} /> : null}
            </span>
            <span>More</span>
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
