import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight, Loader2, Mail, X } from 'lucide-react';
import { MEMBER_INVITE_PERMISSION_WORDS } from '@app/shared';
import { orgService, errorText, inviteChangedPreview } from '../../api/orgsApi';
import MemberListPerson from './MemberListPerson';
import { ShareInvite } from './ShareInvite';
import {
  gymToday,
  inviteBlockedWords,
  inviteBody,
  inviteIgnores,
  invitePeopleQuery,
  inviteQueryString,
  inviteSummary,
  inviteWhyNot,
  inviteWho,
  skippedLines,
} from './memberListPeople';

// Invite from the list (spec Part 3 §18.6; ROADMAP 5b-ii, 5b-v-a-i), the page the list's
// "Invite to app" opens. Kd, 2026-09-27: it "should show like a normal dashboard just like
// your list … showing every details and reason that is understandable by human". So it
// is laid out as the list is: one line saying how many of the people it looked at get an
// email and how many don't, then two tabs — Will get an email · Won't get one — each a
// table of those people with their status and membership, where the email goes, or why
// it won't, in the words their own row uses. A row opens the person's page, where the
// reason can be fixed. Every number and every person is the server's, worked out by the
// same rule as the Send button. A list that changed meanwhile invites nobody and shows
// the new people. Afterwards it offers the invitation's words and link to send another way.

const count = (k) => k.toLocaleString('en');

const GROUPS = [
  { key: 'reach', title: 'Recipients' },
  { key: 'left_out', title: 'Not included' },
];
const LOADING = { loading: true, error: null, people: [], total: 0, cursor: null };

/** The permission tick (§9.12), drawn as the Leads page draws its own. */
function PermissionTick({ checked, onChange, children }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="self-start flex items-start gap-3 min-h-11 text-left"
    >
      <span className={checked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
        {checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="c-s15 c-w5 c-t1">{children}</span>
    </button>
  );
}

export default function MemberListInvite({
  gymId,
  gym,
  list = null,
  filters,
  words,
  readOnly,
  preview: first,
  onSent,
  onListChanged = () => undefined,
  onClose,
}) {
  const [preview, setPreview] = useState(first);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const [permission, setPermission] = useState(false);
  /** The tab staff picked; until then Recipients, or Not included when nobody is reached. */
  const [picked, setTab] = useState(null);
  const [groups, setGroups] = useState({ reach: LOADING, left_out: LOADING });
  const [loadingMore, setLoadingMore] = useState(false);
  /** undefined: no person open · an id: that person's page, over this one. */
  const [openId, setOpenId] = useState(undefined);
  /** Bumped when the count must be read again (a change on a person's page). */
  const [countTick, setCountTick] = useState(0);
  /** Bumped when the lists must be read again (that, or a list that moved under a press). */
  const [peopleTick, setPeopleTick] = useState(0);
  /** The `peopleTick` each list was last read for, so a tab is read once per change. */
  const readFor = useRef({ reach: -1, left_out: -1 });
  const tab = picked ?? (preview !== null && preview.reach === 0 ? 'left_out' : 'reach');
  const today = gymToday(gym?.timezone);

  // Counted again as the page opens: the button's number may be minutes old.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => orgService.getInvitePreview(gymId, inviteQueryString(filters)))
      .then((res) => res.data.preview)
      .then(
        (got) => {
          if (live) setPreview(got);
        },
        (err) => {
          if (live) setError(errorText(err, "We couldn't count who would be invited."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, filters, countTick]);

  // A tab's first page, read when the tab is first shown and again after a change.
  useEffect(() => {
    if (sent !== null) return undefined;
    const group = tab;
    const reads = readFor.current;
    if (reads[group] === peopleTick) return undefined;
    reads[group] = peopleTick;
    let live = true;
    let done = false;
    setGroups((g) => ({ ...g, [group]: LOADING }));
    Promise.resolve()
      .then(() => orgService.getInvitePeople(gymId, invitePeopleQuery(filters, group)))
      .then(
        (res) => {
          done = true;
          if (live) setGroups((g) => ({ ...g, [group]: { loading: false, error: null, ...res.data.page } }));
        },
        (err) => {
          done = true;
          if (live) setGroups((g) => ({ ...g, [group]: { ...LOADING, loading: false, error: errorText(err, "We couldn't load who would be invited.") } }));
        },
      );
    return () => {
      live = false;
      // Left before it answered: read it again when the tab comes back.
      if (!done) reads[group] = -1;
    };
  }, [gymId, filters, tab, peopleTick, sent]);

  const loadMore = async () => {
    const group = tab;
    const shown = groups[group];
    if (shown.cursor === null || loadingMore) return;
    const at = readFor.current[group];
    setLoadingMore(true);
    try {
      const res = await orgService.getInvitePeople(gymId, invitePeopleQuery(filters, group, shown.cursor));
      if (readFor.current[group] !== at) return;
      const p = res.data.page;
      setGroups((g) => ({ ...g, [group]: { ...g[group], people: [...g[group].people, ...p.people], total: p.total, cursor: p.cursor } }));
    } catch (err) {
      if (readFor.current[group] === at) setGroups((g) => ({ ...g, [group]: { ...g[group], error: errorText(err, "We couldn't load any more.") } }));
    } finally {
      setLoadingMore(false);
    }
  };

  const send = async () => {
    if (preview === null || sending || !permission) return;
    setSending(true);
    setError(null);
    try {
      const res = await orgService.pressInvite(gymId, inviteBody(filters, preview, permission));
      setSent(res.data.invited);
      onSent();
    } catch (err) {
      const fresh = inviteChangedPreview(err);
      if (fresh !== null) {
        setPreview(fresh);
        // The tick was for the people staff saw; new people are ticked again.
        setPermission(false);
        setPeopleTick((t) => t + 1);
      }
      setError(errorText(err, "We couldn't send the invitations. Please try again."));
    } finally {
      setSending(false);
    }
  };

  // Something changed on a person's page: count and list again, and ask for the tick again.
  const personChanged = () => {
    setPermission(false);
    setCountTick((t) => t + 1);
    setPeopleTick((t) => t + 1);
    onListChanged();
  };

  const blocked = preview === null ? null : inviteBlockedWords(preview.blocked, words);
  const reach = preview?.reach ?? 0;
  const ignores = inviteIgnores(filters);
  const chosen = inviteWho(filters);
  const summary = preview === null ? null : inviteSummary(preview, filters, words);

  let body;
  let footer;
  if (sent !== null) {
    const left = skippedLines(sent.skipped);
    body = (
      <>
        <p className="c-s16 c-w6 c-t1 flex items-center gap-2" role="status">
          <Check aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
          {sent.queued === 0
            ? 'No new invitations were sent.'
            : `${count(sent.queued)} ${sent.queued === 1 ? 'invitation is' : 'invitations are'} being sent.`}
        </p>
        {sent.queued > 0 ? (
          <p className="c-s14 c-t2">Invitations are sent in batches, so large lists can take up to a day. Each member&apos;s page shows the delivery status.</p>
        ) : null}
        {left.length > 0 ? (
          <div data-testid="invite-left-out" className="flex flex-col gap-1">
            <span className="c-s14 c-w6 c-t2">Not included</span>
            <ul className="flex flex-col gap-1">
              {left.map((line) => (
                <li key={line.key} className="c-s14 c-t1">
                  {line.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {sent.queued > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="c-h3">Share the invitation</h3>
            <p className="c-s14 c-t2">
              You can also send this invitation by WhatsApp, text message or email. Only someone who signs in with the invited email address can join.
            </p>
            <ShareInvite gymName={gym.name} slug={gym.slug} newLook />
          </section>
        ) : null}
      </>
    );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
        Done
      </button>
    );
  } else if (preview === null) {
    body =
      error !== null ? (
        <p className="c-s14 c-t1" role="alert">
          {error}
        </p>
      ) : (
        <p className="c-s14 c-t2 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
        </p>
      );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg">
        Cancel
      </button>
    );
  } else {
    const shown = groups[tab];
    const leftOut = summary.leftOut;
    body = (
      <>
        <div className="flex flex-col gap-1">
          <p className="c-s16 c-w6 c-t1" data-testid="invite-summary">
            {summary.gets}
            {summary.wont !== null ? (
              <>
                {' · '}
                <button type="button" onClick={() => setTab('left_out')} className="c-btn-link c-w6" style={{ color: 'var(--t1)' }}>
                  {summary.wont}
                </button>
              </>
            ) : null}
          </p>
          {chosen !== 'Everyone on your list' ? (
            <p className="c-s14 c-t2" data-testid="invite-who">
              Filtered by {chosen}
            </p>
          ) : null}
          {ignores !== null ? <p className="c-hint">{ignores}</p> : null}
        </div>

        {blocked !== null ? (
          <div className="c-callout flex-col" role="alert">
            <p className="c-s14 flex gap-2">
              <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
              {blocked}
            </p>
            {preview.blocked === 'no_postal_address' ? (
              <Link to={`/console/${gym.slug}/settings`} className="c-btn c-btn-s self-start">
                Open Settings
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="c-utabs" role="tablist" aria-label="Recipients">
          {GROUPS.map(({ key, title }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`invite-tab-${key}`}
              onClick={() => setTab(key)}
              className={tab === key ? 'c-utab c-utab-on gap-1.5' : 'c-utab gap-1.5'}
            >
              {title} <span className="c-n">{count(key === 'reach' ? reach : leftOut)}</span>
            </button>
          ))}
        </div>

        {shown.loading ? (
          <p className="c-s14 c-t2 flex items-center gap-2">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : null}
        {shown.error !== null ? (
          <p className="c-s14 c-t1" role="alert">
            {shown.error}
          </p>
        ) : null}

        {!shown.loading && shown.people.length > 0 ? (
          <section className="c-card overflow-hidden" data-testid={`invite-list-${tab}`}>
            <div className="c-invite-grid c-th hidden md:grid px-5 py-2.5">
              <span style={{ gridArea: 'who' }}>Name</span>
              <span style={{ gridArea: 'status' }}>Status</span>
              <span style={{ gridArea: 'type' }}>Membership</span>
              <span style={{ gridArea: 'why' }}>{tab === 'reach' ? 'Email' : 'Reason'}</span>
            </div>
            <ul>
              {shown.people.map((p, i) => {
                const why = tab === 'reach' ? null : inviteWhyNot(p, today);
                const gymWords = [p.status, p.membershipType].filter((w) => w !== null && w !== '').join(' · ');
                return (
                  <li key={p.entryId} className={i > 0 ? 'border-t' : 'md:border-t'} style={{ borderColor: 'var(--line)' }}>
                    <button
                      type="button"
                      data-testid="invite-row"
                      onClick={() => setOpenId(p.entryId)}
                      className="c-invite-grid grid w-full text-left min-h-11 px-4 py-3 md:px-5 md:py-3"
                    >
                      <span className="flex flex-col gap-0.5 min-w-0" style={{ gridArea: 'who' }}>
                        <span className="c-s15 c-w6 c-t1 c-ell">{p.fullName || 'No name'}</span>
                        {why !== null && p.email !== null ? <span className="c-s13 c-t2 c-ell">{p.email}</span> : null}
                      </span>
                      {gymWords !== '' ? (
                        <span className="md:hidden c-s13 c-t2" style={{ gridArea: 'words' }}>
                          {gymWords}
                        </span>
                      ) : null}
                      <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'status' }}>
                        {p.status || <span className="c-t3">—</span>}
                      </span>
                      <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'type' }}>
                        {p.membershipType || <span className="c-t3">—</span>}
                      </span>
                      <span className="flex flex-col gap-0.5 min-w-0" style={{ gridArea: 'why' }} data-testid="invite-why">
                        {why === null ? (
                          <span className="c-s14 c-t1 c-ell">{p.email}</span>
                        ) : (
                          <>
                            <span className="c-s14 c-t1">{why.text}</span>
                            {why.hint !== null ? <span className="c-hint">{why.hint}</span> : null}
                          </>
                        )}
                      </span>
                      <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3 self-center" style={{ gridArea: 'go' }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {!shown.loading && shown.error === null && shown.people.length === 0 ? (
          <p className="c-s14 c-t2">{tab === 'reach' ? `No ${words.people} to invite.` : `All ${words.people} are included.`}</p>
        ) : null}

        {!shown.loading && shown.cursor !== null ? (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="c-btn c-btn-s c-btn-lg w-full md:w-auto md:self-start">
            {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </>
    );
    footer = (
      <div className="flex flex-col gap-3 w-full">
        <p className="c-s13 c-t2">
          Each member receives one invitation email from {gym.name}, sent by AI Home Gym, with a link to join. Only someone who signs in with that email address can join.
        </p>
        {reach > 0 && blocked === null ? (
          <PermissionTick checked={permission} onChange={setPermission}>
            {MEMBER_INVITE_PERMISSION_WORDS.replace('{gym}', gym.name).replace('{people}', words.people)}
          </PermissionTick>
        ) : null}
        {error !== null ? (
          <p className="c-s14 c-t1" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => void send()}
            disabled={reach === 0 || blocked !== null || !permission || readOnly || sending}
            className="c-btn c-btn-p c-btn-lg md:order-2"
          >
            {sending ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Mail aria-hidden="true" className="w-4 h-4" />}
            {reach === 1 ? 'Send 1 invitation' : `Send ${count(reach)} invitations`}
          </button>
          <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg md:order-1">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Invite ${words.people} to the app`}
        data-testid="invite-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-8 md:top-10 md:bottom-10 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[960px] md:max-w-[calc(100%-48px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            Invite {words.people} to the app
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto flex-grow">{body}</div>
        <div className="flex px-4 pt-3 pb-5 md:px-7 md:py-4 border-t md:justify-end" style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
          {footer}
        </div>
      </div>
      {openId !== undefined ? (
        <MemberListPerson
          key={openId}
          gymId={gymId}
          gym={gym}
          entryId={openId}
          list={list}
          words={words}
          readOnly={readOnly}
          onClose={() => setOpenId(undefined)}
          onChanged={personChanged}
        />
      ) : null}
    </div>
  );
}
