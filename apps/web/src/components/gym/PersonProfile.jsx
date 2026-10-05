import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { leaderboardService } from '../../api/leaderboardApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { postPhotoUrl, postsService } from '../../api/postsApi';
import PhotoViewer from '../common/PhotoViewer';
import PostCard from './PostCard';
import { BOARD_TABS, PERIODS, ordinal, valueText } from './leaderboardView';
import { blockBox, personPostsEmpty, postsCount, reportBox, withPage, withPost, withReaction, withoutPost } from './postsView';

// A PERSON'S PROFILE, FOR ANOTHER MEMBER (spec Part 3 §15.5, §15.2; ROADMAP 19b-ii-c): a page
// of its own over the gym's, laid out as a profile is everywhere (Kd's click-through,
// RULINGS 2026-10-05): the picture and name, the numbers in a row, then their posts.
// Opened from a row of the leaderboard or a picture or name on Updates. The server sends
// a hidden person's places to nobody, and a blocked or departed person's posts to nobody.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';
const QUIET = { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' };
const SOFT = { background: 'rgba(255,138,31,0.15)', color: ORANGE };

function Stat({ number, label, under = null }) {
  return (
    <li className="flex-1 min-w-0 rounded-xl px-2 py-3 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <span className="block text-lg font-bold text-white">{number}</span>
      <span className="block text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {label}
      </span>
      {under !== null && (
        <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
          {under}
        </span>
      )}
    </li>
  );
}

export default function PersonProfile({ gym, person, period = 'this_week', onClose, onChanged = null }) {
  const gymId = gym.id;
  /** Their places: null until read, and null again for a person with none to show. */
  const [boards, setBoards] = useState({ error: null, rows: null });
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [more, setMore] = useState({ loading: false, error: null });
  const [reacting, setReacting] = useState(null);
  const [reactError, setReactError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [viewing, setViewing] = useState(null);
  /** Something changed that the page behind shows too. */
  const dirty = useRef(false);

  // The page behind holds still while the profile is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  useEffect(() => {
    let live = true;
    leaderboardService.profile(gymId, person.userId, period).then(
      (data) => live && setBoards({ error: null, rows: data.boards }),
      // "Not found" is the answer for a person who is on no board: nothing is drawn.
      (err) => live && setBoards({ error: errorStatus(err) === 404 ? null : "Couldn't load their places on the leaderboard.", rows: null }),
    );
    return () => {
      live = false;
    };
  }, [gymId, person.userId, period]);

  const load = useCallback(
    () =>
      postsService.person(gymId, person.userId).then(
        (page) => setState({ loading: false, error: null, feed: { pinned: [], ...page } }),
        (err) => setState({ loading: false, error: errorText(err, "Couldn't load their posts."), feed: null }),
      ),
    [gymId, person.userId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const change = (fn) => {
    dirty.current = true;
    setState((s) => (s.feed === null ? s : { ...s, feed: fn(s.feed) }));
  };
  const close = () => {
    if (dirty.current && onChanged !== null) onChanged();
    onClose();
  };

  const showMore = async () => {
    setMore({ loading: true, error: null });
    try {
      const page = await postsService.person(gymId, person.userId, state.feed.next);
      setState((s) => (s.feed === null ? s : { ...s, feed: { ...withPage(s.feed, page), total: page.total } }));
      setMore({ loading: false, error: null });
    } catch (err) {
      setMore({ loading: false, error: errorText(err, "Couldn't load more.") });
    }
  };

  const onReact = async (post, tapped) => {
    const next = withReaction(post, tapped);
    setReactError(null);
    setReacting(post.id);
    change((feed) => withPost(feed, next));
    try {
      const done = await postsService.react(gymId, post.id, next.mine);
      change((feed) => withPost(feed, { ...next, reactions: done.reactions, mine: done.mine }));
    } catch (err) {
      change((feed) => withPost(feed, post));
      setReactError(errorText(err, "Couldn't save your reaction. Please try again."));
    } finally {
      setReacting(null);
    }
  };

  const onRemove = async (post) => {
    await postsService.removeOwn(gymId, post.id);
    change((feed) => ({ ...withoutPost(feed, post.id), total: Math.max(0, feed.total - 1) }));
    setNotice('Your post has been removed.');
  };

  const onReport = async (post, reason, note) => {
    await postsService.report(gymId, post.id, reason, note);
    change((feed) => withPost(feed, { ...post, reported: true }));
    setNotice(reportBox(gym.name).done);
  };

  // Every post here is theirs, so all of them go: read again, and the page says why.
  const onBlock = async (post) => {
    await postsService.block(gymId, post.id);
    dirty.current = true;
    await load();
    setNotice(blockBox(post, gym.name).done);
  };

  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? '';
  const feed = state.feed;
  const empty = feed !== null && feed.posts.length === 0 ? personPostsEmpty(person.name, feed.blocked) : null;
  const count = feed === null ? { number: '–', label: 'Posts' } : postsCount(feed.total);
  return (
    <div role="dialog" aria-modal="true" aria-label={person.name} className="fixed inset-0 z-50 overflow-y-auto" style={{ background: '#0c0b0a' }} data-testid="person-profile">
      <div className="sticky top-0 z-10" style={{ background: 'rgba(12,11,10,0.94)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="mx-auto w-full max-w-2xl flex items-center gap-2 px-3 min-h-14">
          <button type="button" onClick={close} aria-label="Back" className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: '#fff' }}>
            <ArrowLeft aria-hidden="true" className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-base font-bold text-white truncate">{person.name}</p>
            <p className="text-xs truncate" style={{ color: MUTED }}>
              {gym.name}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-10">
        <div className="flex items-center gap-4 pt-6">
          <span
            className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0"
            style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE, border: '2px solid rgba(255,138,31,0.35)' }}
            aria-hidden="true"
          >
            {person.initials}
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white break-words">{person.name}</h2>
            <p className="text-sm" style={{ color: MUTED }}>
              Member at {gym.name}
            </p>
          </div>
        </div>

        <ul className="flex gap-2 mt-5" aria-label={`${person.name} in numbers`} data-testid="person-stats">
          <Stat number={count.number} label={count.label} />
          {(boards.rows ?? []).map((b) => (
            <Stat
              key={b.board}
              number={b.place === null ? '—' : ordinal(b.place)}
              label={b.board === 'streak' ? 'Streak' : (BOARD_TABS.find((t) => t.id === b.board)?.label ?? '')}
              under={b.board === 'streak' ? valueText(b.value, b.board) : `${valueText(b.value, b.board)} ${periodLabel}`}
            />
          ))}
        </ul>
        {boards.error !== null && (
          <p className="text-sm mt-3" style={{ color: MUTED }}>
            {boards.error}
          </p>
        )}

        <section aria-label="Posts" className="mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} data-testid="person-posts">
          {notice !== null && (
            <p className="text-sm mb-3 font-semibold" role="status" style={{ color: '#4ade80' }}>
              {notice}
            </p>
          )}
          {reactError !== null && (
            <p className="text-sm mb-3" role="alert" style={{ color: RED }}>
              {reactError}
            </p>
          )}
          {state.loading ? (
            <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          ) : state.error !== null ? (
            <div>
              <p className="text-sm" role="alert" style={{ color: RED }}>
                {state.error}
              </p>
              <button
                type="button"
                onClick={() => {
                  setState({ loading: true, error: null, feed: null });
                  load();
                }}
                className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold min-h-11"
                style={SOFT}
              >
                Try again
              </button>
            </div>
          ) : empty !== null ? (
            <p className="text-sm text-center py-8" style={{ color: MUTED }}>
              {empty}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {feed.posts.map((post) => (
                <PostCard
                  key={post.id}
                  gymId={gymId}
                  gymName={gym.name}
                  post={post}
                  busy={reacting === post.id}
                  onReact={onReact}
                  onOpen={(p, index) => setViewing({ post: p, index })}
                  onRemove={onRemove}
                  onReport={onReport}
                  onBlock={onBlock}
                />
              ))}
            </ul>
          )}
          {feed !== null && feed.next !== null && (
            <div className="mt-3">
              <button type="button" onClick={showMore} disabled={more.loading} className="rounded-xl px-3.5 py-2.5 text-sm font-semibold min-h-11" style={QUIET}>
                {more.loading ? 'Loading…' : 'Show older posts'}
              </button>
              {more.error !== null && (
                <p className="text-sm mt-2" role="alert" style={{ color: RED }}>
                  {more.error}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {viewing !== null && (
        <PhotoViewer
          photos={viewing.post.photos.map((photo, i) => ({
            key: photo.id,
            src: postPhotoUrl({ gymId, postId: viewing.post.id, photoId: photo.id }),
            alt: `Photo ${i + 1} of ${viewing.post.photos.length}`,
          }))}
          index={viewing.index}
          onIndex={(index) => setViewing((v) => (v === null ? v : { ...v, index }))}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
