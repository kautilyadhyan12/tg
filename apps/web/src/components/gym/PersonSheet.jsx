import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { leaderboardService } from '../../api/leaderboardApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { postPhotoUrl, postsService } from '../../api/postsApi';
import PhotoViewer from '../common/PhotoViewer';
import PostCard from './PostCard';
import Sheet, { Initials } from './Sheet';
import { BOARD_TABS, PERIODS, ordinal, valueText } from './leaderboardView';
import { blockBox, personPostsEmpty, reportBox, withPage, withPost, withReaction, withoutPost } from './postsView';

// A PERSON'S PROFILE, FOR ANOTHER MEMBER (spec Part 3 §15.5, §15.2; ROADMAP 19b-ii-c): their
// place on each board the gym shows, and the posts they made as a member. Opened from a
// row of the leaderboard or a name on Updates. The server sends a hidden person's places
// to nobody, and a blocked or departed person's posts to nobody.

const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';
const QUIET = { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' };
const SOFT = { background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' };

export default function PersonSheet({ gym, person, period = 'this_week', onClose, onChanged = null }) {
  const gymId = gym.id;
  /** Their places: null until read, and null again for a person with none to show. */
  const [boards, setBoards] = useState({ loading: true, error: null, rows: null });
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [more, setMore] = useState({ loading: false, error: null });
  const [reacting, setReacting] = useState(null);
  const [reactError, setReactError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [viewing, setViewing] = useState(null);
  /** Something changed that the page behind shows too. */
  const dirty = useRef(false);

  useEffect(() => {
    let live = true;
    leaderboardService.profile(gymId, person.userId, period).then(
      (data) => live && setBoards({ loading: false, error: null, rows: data.boards }),
      // "Not found" is the answer for a person who is on no board: nothing is drawn.
      (err) => live && setBoards({ loading: false, error: errorStatus(err) === 404 ? null : "Couldn't load their places on the leaderboard.", rows: null }),
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
      setState((s) => (s.feed === null ? s : { ...s, feed: withPage(s.feed, page) }));
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
    change((feed) => withoutPost(feed, post.id));
    setNotice('Your post has been removed.');
  };

  const onReport = async (post, reason, note) => {
    await postsService.report(gymId, post.id, reason, note);
    change((feed) => withPost(feed, { ...post, reported: true }));
    setNotice(reportBox(gym.name).done);
  };

  // Every post here is theirs, so all of them go: read again, and the sheet says why.
  const onBlock = async (post) => {
    await postsService.block(gymId, post.id);
    dirty.current = true;
    await load();
    setNotice(blockBox(post, gym.name).done);
  };

  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? '';
  const feed = state.feed;
  const empty = feed !== null && feed.posts.length === 0 ? personPostsEmpty(person.name, feed.blocked) : null;
  return (
    <Sheet title={person.name} onClose={close}>
      <div className="flex items-center gap-3 mb-4">
        <Initials text={person.initials} />
        <p className="text-sm text-white font-semibold">{person.name}</p>
      </div>

      {boards.rows !== null && boards.rows.length > 0 && (
        <section aria-label="On the leaderboard" className="mb-5" data-testid="person-boards">
          <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: MUTED }}>
            On the leaderboard
          </h4>
          <ul className="flex flex-col gap-2">
            {boards.rows.map((b) => (
              <li key={b.board} className="flex justify-between text-sm rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <span className="text-white">{b.board === 'streak' ? 'Streak' : `${BOARD_TABS.find((t) => t.id === b.board)?.label ?? ''}, ${periodLabel}`}</span>
                <span style={{ color: MUTED }}>
                  {b.place === null ? '—' : ordinal(b.place)} · {valueText(b.value, b.board)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {boards.error !== null && (
        <p className="text-sm mb-5" style={{ color: MUTED }}>
          {boards.error}
        </p>
      )}

      <section aria-label="Posts" data-testid="person-posts">
        <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: MUTED }}>
          Posts
        </h4>
        {notice !== null && (
          <p className="text-sm mb-2 font-semibold" role="status" style={{ color: '#4ade80' }}>
            {notice}
          </p>
        )}
        {reactError !== null && (
          <p className="text-sm mb-2" role="alert" style={{ color: RED }}>
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
          <p className="text-sm" style={{ color: MUTED }}>
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
    </Sheet>
  );
}
