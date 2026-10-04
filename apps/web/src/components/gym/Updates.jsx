import { useCallback, useEffect, useState } from 'react';
import { BicepsFlexed, Flame, Heart, Loader2, Pin, ThumbsUp } from 'lucide-react';
import { postPhotoUrl, postsService } from '../../api/postsApi';
import { errorText } from '../../api/orgsApi';
import PhotoViewer from '../common/PhotoViewer';
import { authorInitials, authorName, emptyLine, postedText, reactionButtons, withPage, withPost, withReaction } from './postsView';

// THE GYM'S UPDATES, FOR A MEMBER (spec Part 3 §15.2; ROADMAP 19b-i). Posts by the gym's
// staff, pinned ones first; one reaction a post and no comments. The server sends them
// only to a live member of this gym.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const ICONS = { like: ThumbsUp, love: Heart, strong: BicepsFlexed, fire: Flame };

function Photos({ gymId, post, onOpen }) {
  if (post.photos.length === 0) return null;
  return (
    <div className={`grid gap-1.5 mt-3 ${post.photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {post.photos.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => onOpen(i)}
          aria-label={`Open photo ${i + 1} of ${post.photos.length}`}
          className="block overflow-hidden rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', aspectRatio: post.photos.length === 1 ? `${photo.width} / ${photo.height}` : '1 / 1', maxHeight: 420 }}
        >
          <img
            src={postPhotoUrl({ gymId, postId: post.id, photoId: photo.id })}
            alt={`Photo ${i + 1} of ${post.photos.length}`}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

function Post({ gymId, gymName, post, busy, onReact, onOpen }) {
  return (
    <li className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)' }} data-testid="post">
      <div className="flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}
          aria-hidden="true"
        >
          {authorInitials(post, gymName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">
            {authorName(post, gymName)}
            {post.author.name !== null && (
              <span className="text-xs font-medium ml-1.5" style={{ color: MUTED }}>
                · Staff
              </span>
            )}
          </p>
          <p className="text-xs" style={{ color: MUTED }}>
            {postedText(post.createdAt)}
          </p>
        </div>
        {post.pinned && (
          <span className="flex items-center gap-1 text-xs font-semibold flex-shrink-0" style={{ color: ORANGE }}>
            <Pin className="w-3.5 h-3.5" aria-hidden="true" /> Pinned
          </span>
        )}
      </div>
      {post.body !== '' && (
        <p className="text-sm mt-3 whitespace-pre-wrap break-words" style={{ color: 'rgba(255,255,255,0.88)' }}>
          {post.body}
        </p>
      )}
      <Photos gymId={gymId} post={post} onOpen={(i) => onOpen(post, i)} />
      <div className="flex flex-wrap gap-2 mt-3">
        {reactionButtons(post).map((r) => {
          const Icon = ICONS[r.id];
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.mine}
              aria-label={r.label}
              title={r.word}
              disabled={busy}
              onClick={() => onReact(post, r.id)}
              className="min-h-11 min-w-11 px-3 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold"
              style={
                r.mine
                  ? { background: 'rgba(255,138,31,0.18)', color: ORANGE }
                  : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }
              }
            >
              <Icon className="w-4 h-4" aria-hidden="true" style={r.mine ? { fill: ORANGE } : undefined} />
              {r.count > 0 && <span>{r.count.toLocaleString('en')}</span>}
            </button>
          );
        })}
      </div>
    </li>
  );
}

export default function Updates({ gym }) {
  const gymId = gym.id;
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [more, setMore] = useState({ loading: false, error: null });
  /** The post whose reaction is on its way, and what went wrong with the last one. */
  const [reacting, setReacting] = useState(null);
  const [reactError, setReactError] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(
    () =>
      postsService.list(gymId).then(
        (feed) => setState({ loading: false, error: null, feed }),
        (err) => setState({ loading: false, error: errorText(err, "Couldn't load the updates."), feed: null }),
      ),
    [gymId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const tryAgain = () => {
    setState({ loading: true, error: null, feed: null });
    load();
  };

  const showMore = async () => {
    setMore({ loading: true, error: null });
    try {
      const page = await postsService.list(gymId, state.feed.next);
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
    setState((s) => (s.feed === null ? s : { ...s, feed: withPost(s.feed, next) }));
    try {
      const done = await postsService.react(gymId, post.id, next.mine);
      setState((s) => (s.feed === null ? s : { ...s, feed: withPost(s.feed, { ...next, reactions: done.reactions, mine: done.mine }) }));
    } catch (err) {
      // Put back as it was: the tap did not reach the gym's page.
      setState((s) => (s.feed === null ? s : { ...s, feed: withPost(s.feed, post) }));
      setReactError(errorText(err, "Couldn't save your reaction. Please try again."));
    } finally {
      setReacting(null);
    }
  };

  const feed = state.feed;
  const empty = feed === null ? null : emptyLine(feed);
  return (
    <div className="mt-4" data-testid="updates">
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <div>
          <p className="text-sm" style={{ color: '#ef4444' }}>
            {state.error}
          </p>
          <button
            type="button"
            onClick={tryAgain}
            className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold"
            style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}
          >
            Try again
          </button>
        </div>
      ) : empty !== null ? (
        <p className="text-sm" style={{ color: MUTED }}>
          {empty}
        </p>
      ) : (
        <>
          {reactError !== null && (
            <p className="text-sm mb-2" role="alert" style={{ color: '#ef4444' }}>
              {reactError}
            </p>
          )}
          <ul className="flex flex-col gap-2.5">
            {[...feed.pinned, ...feed.posts].map((post) => (
              <Post
                key={post.id}
                gymId={gymId}
                gymName={feed.gymName}
                post={post}
                busy={reacting === post.id}
                onReact={onReact}
                onOpen={(p, index) => setViewing({ post: p, index })}
              />
            ))}
          </ul>
          {feed.next !== null && (
            <div className="mt-3">
              <button
                type="button"
                onClick={showMore}
                disabled={more.loading}
                className="rounded-xl px-3.5 py-2.5 text-sm font-semibold min-h-11"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' }}
              >
                {more.loading ? 'Loading…' : 'Show older posts'}
              </button>
              {more.error !== null && (
                <p className="text-sm mt-2" role="alert" style={{ color: '#ef4444' }}>
                  {more.error}
                </p>
              )}
            </div>
          )}
        </>
      )}
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
