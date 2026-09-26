import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, UserMinus, X } from 'lucide-react';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { Tick } from './MemberListUpload';
import { inviteWho, removeBody, removeIgnores, removeQueryString } from './memberListPeople';

// Remove from the app in one press (ROADMAP 5b-iii; RULINGS 2026-09-17, 2026-09-23):
// the app members whose record carries the words ticked in Filter, or the app members
// not on the gym's list. The box names every person before anything happens; a list
// that changed meanwhile removes nobody and the box shows the new names. Every number
// is the server's.

const C = {
  panel: '#0f0e0d',
  card: '#141210',
  line: 'rgba(255,255,255,0.07)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.12)',
  red: '#f87171',
  green: '#34d399',
  plain: 'rgba(255,255,255,0.06)',
};
const BUTTON = 'rounded-xl min-h-[48px] px-5 text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40';

const count = (k) => k.toLocaleString('en');

/** Who the box is about, in words. */
const UNLISTED_WHO = {
  no_longer_listed: 'Using the app, but no longer on your list',
  never_listed: 'Using the app, but not on your list',
};

/** How many app members each group holds, said on one line each. */
const UNLISTED_LINE = {
  no_longer_listed: (k) => `${count(k)} using the app ${k === 1 ? 'is' : 'are'} no longer on your list`,
  never_listed: (k) => `${count(k)} using the app ${k === 1 ? "isn't" : "aren't"} on your list`,
};

/** On "Using the app": each group of app members the list does not hold, with the
 *  button that removes the group in one press (RULINGS 2026-09-17). Nothing is drawn
 *  for a group of nobody. `refreshKey` moves when the roster is read again. */
export function NotOnListRemove({ gymId, gym, words, readOnly, refreshKey, onRemoved }) {
  const [totals, setTotals] = useState(null);
  const [open, setOpen] = useState(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => Promise.all(Object.keys(UNLISTED_LINE).map((group) => orgService.getUnlisted(gymId, group))))
      .then(
        (answers) => {
          if (live) setTotals(answers.map((res) => ({ group: res.data.page.group, total: res.data.page.total })));
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [gymId, refreshKey, reads]);

  const shown = (totals ?? []).filter((t) => t.total > 0);
  if (shown.length === 0 && open === null) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="not-on-list-remove">
      {shown.map((t) => (
        <div
          key={t.group}
          className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
          style={{ background: C.card, border: '1px solid rgba(255,138,31,0.35)' }}
        >
          <p className="text-sm flex items-center gap-2" style={{ color: C.soft }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: C.orange }} />
            {UNLISTED_LINE[t.group](t.total)}
          </p>
          <button
            type="button"
            onClick={() => setOpen({ kind: 'unlisted', group: t.group })}
            disabled={readOnly}
            className="rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center gap-2 disabled:opacity-40"
            style={{ background: 'rgba(248,113,113,0.12)', color: C.red }}
          >
            <UserMinus className="w-4 h-4" />
            Remove {count(t.total)} from the app
          </button>
        </div>
      ))}
      {open !== null ? (
        <MemberListRemove
          gymId={gymId}
          gym={gym}
          words={words}
          readOnly={readOnly}
          source={open}
          onRemoved={() => {
            setReads((n) => n + 1);
            onRemoved();
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** One page of the people the box is about. */
const lookUp = (gymId, source, cursor) =>
  source.kind === 'words'
    ? orgService.getRemoveByWords(gymId, removeQueryString(source.filters, cursor))
    : orgService.getUnlisted(gymId, source.group, cursor);

/** `source` is `{ kind: 'words', filters }` or `{ kind: 'unlisted', group }`. */
export default function MemberListRemove({ gymId, gym, words, readOnly, source, onRemoved, onClose }) {
  const [page, setPage] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [large, setLarge] = useState(null);
  const [ticked, setTicked] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [done, setDone] = useState(null);
  const [reads, setReads] = useState(0);

  // Read as the box opens, and again after a press the server refused because the
  // names moved.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => lookUp(gymId, source, null))
      .then(
        (res) => {
          if (!live) return;
          setPage(res.data.page);
          setLoadError(null);
        },
        (err) => {
          if (live) setLoadError(errorText(err, "We couldn't read who would be removed."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, source, reads]);

  const more = async () => {
    if (page?.cursor == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = (await lookUp(gymId, source, page.cursor)).data.page;
      setPage((p) => ({ ...next, people: [...p.people, ...next.people] }));
    } catch (err) {
      setError(errorText(err, "We couldn't load any more."));
    } finally {
      setLoadingMore(false);
    }
  };

  const press = async () => {
    if (page === null || page.total === 0 || removing) return;
    setRemoving(true);
    setError(null);
    const numbers = { version: page.version, expectedCount: page.total, digest: page.digest };
    try {
      const res =
        source.kind === 'words'
          ? await orgService.removeByWords(gymId, removeBody(source.filters, page, large !== null && ticked))
          : await orgService.removeUnlisted(gymId, {
              group: source.group,
              ...numbers,
              ...(large !== null && ticked ? { acknowledgeLargeChange: true } : {}),
            });
      setDone(res.data.removed);
      onRemoved();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'large_change') {
        const body = err.response.data;
        setLarge({ removing: body.removing, of: body.of });
        setTicked(false);
      } else if (code === 'list_changed') {
        // The names staff saw are not the names now: show the new ones.
        setLarge(null);
        setTicked(false);
        setPage(null);
        setReads((n) => n + 1);
      }
      setError(errorText(err, "We couldn't remove them. Please try again."));
    } finally {
      setRemoving(false);
    }
  };

  const people = (k) => (k === 1 ? words.person : words.people);
  const who = source.kind === 'words' ? inviteWho(source.filters) : UNLISTED_WHO[source.group];
  const ignores = source.kind === 'words' ? removeIgnores(source.filters) : null;

  let body;
  if (done !== null) {
    body = (
      <>
        <p className="text-[15px] flex gap-2" style={{ color: '#fff' }} role="status">
          <Check className="w-5 h-5 flex-shrink-0" style={{ color: C.green }} />
          {done.alreadyRemoved
            ? `These ${words.people} were already removed.`
            : `${count(done.removed)} ${people(done.removed)} removed from the app.`}
        </p>
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
          Done
        </button>
      </>
    );
  } else if (page === null) {
    body =
      loadError !== null ? (
        <p className="text-sm" style={{ color: C.soft }} role="alert">
          {loadError}
        </p>
      ) : (
        <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Counting…
        </p>
      );
  } else {
    body = (
      <>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
            Who
          </p>
          <p className="text-sm mt-1" style={{ color: C.soft }} data-testid="remove-who">
            {who}
          </p>
          {ignores !== null ? (
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              {ignores}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <p className="text-3xl font-bold" style={{ color: '#fff' }} data-testid="remove-total">
            {count(page.total)}
          </p>
          <p className="text-sm mt-1" style={{ color: C.soft }}>
            {page.total === 0 ? `Nobody using the app is in this group.` : `${people(page.total)} will be removed from ${gym.name} in the app.`}
          </p>
        </div>
        {page.people.length > 0 ? (
          <ul className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto" data-testid="remove-names">
            {page.people.map((p) => (
              <li key={p.userId} className="text-sm rounded-xl px-3 py-2" style={{ background: C.plain, color: C.soft }}>
                <span style={{ color: '#fff' }}>{p.displayName}</span>
                {p.email ? <span style={{ color: C.muted }}> · {p.email}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {page.cursor !== null ? (
          <button
            type="button"
            onClick={() => void more()}
            disabled={loadingMore}
            className="self-start rounded-xl px-4 min-h-[44px] text-sm font-medium flex items-center gap-2"
            style={{ background: C.orangeBg, color: C.orange }}
          >
            {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
        {page.total > 0 ? (
          <p className="text-sm" style={{ color: C.muted }}>
            They keep their workouts and the free app. The app tells them they&apos;re no longer a {words.person} of {gym.name}.
            {source.kind === 'words' ? ' They stay on your list.' : ''}
          </p>
        ) : null}
        {large !== null ? (
          <Tick checked={ticked} onChange={setTicked}>
            Yes, remove {count(large.removing)} of your {count(large.of)} {people(large.of)}
          </Tick>
        ) : null}
        {error !== null ? (
          <p className="text-sm flex gap-2" style={{ color: '#fff' }} role="alert">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: C.orange }} />
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void press()}
            disabled={page.total === 0 || readOnly || removing || (large !== null && !ticked)}
            className={`${BUTTON} flex-1 sm:flex-none`}
            style={{ background: C.red, color: '#000' }}
          >
            {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
            Remove {count(page.total)} from the app
          </button>
          <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(10,9,8,0.88)' }}>
      <div className="min-h-full flex items-end sm:items-center justify-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Remove from the app"
          data-testid="remove-box"
          className="w-full sm:max-w-[560px] rounded-t-[28px] sm:rounded-[28px] p-5 sm:p-6 flex flex-col gap-4"
          style={{ background: C.panel, border: `1px solid ${C.line}` }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#fff' }}>
              Remove from the app
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: C.plain, color: C.soft }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {body}
        </div>
      </div>
    </div>
  );
}
