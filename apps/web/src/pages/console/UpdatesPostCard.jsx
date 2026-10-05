import { useRef, useState } from 'react';
import { BicepsFlexed, Check, EyeOff, Flag, Flame, Heart, Pin, PinOff, ThumbsUp, Trash2, UserCheck, UserX } from 'lucide-react';
import { postPhotoUrl, staffPostsService } from '../../api/postsApi';
import { errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import {
  authorInitials,
  authorName,
  canOpenPerson,
  hiddenStaffNote,
  personLink,
  pinNote,
  postedText,
  reactionButtons,
  reactorsMore,
  reactorsTitle,
  removeBox,
  reportNotesTitle,
  reportedLine,
  stopBox,
} from '../../components/gym/postsView';

// ONE POST, AS STAFF READ IT (spec Part 3 §15.2, §15.3): on the console's Updates page, its
// reported list, and a person's own list.

const REACTION_ICONS = { like: ThumbsUp, love: Heart, strong: BicepsFlexed, fire: Flame };

/** A post's reactions as members see them, each one's icon and how many. A press on one
 *  shows staff who gave it; members are never shown that. */
function Reactions({ gymId, post }) {
  const reactions = reactionButtons(post).filter((r) => r.count > 0);
  const [open, setOpen] = useState(null);
  const [state, setState] = useState({ loading: false, error: null, who: null });
  const asked = useRef(null);

  const show = (id) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    asked.current = id;
    setState({ loading: true, error: null, who: null });
    staffPostsService.reactors(gymId, post.id, id).then(
      (who) => asked.current === id && setState({ loading: false, error: null, who }),
      (err) => asked.current === id && setState({ loading: false, error: errorText(err, "We couldn't load who reacted."), who: null }),
    );
  };

  if (reactions.length === 0) {
    return (
      <p className="c-s13 c-t2" data-testid="reactions">
        No reactions yet
      </p>
    );
  }
  const shown = reactions.find((r) => r.id === open) ?? null;
  const more = state.who === null ? null : reactorsMore(state.who);
  return (
    <div className="flex flex-col gap-3" data-testid="reactions">
      <div className="flex flex-wrap items-center gap-2">
        {reactions.map((r) => {
          const Icon = REACTION_ICONS[r.id];
          return (
            <button
              key={r.id}
              type="button"
              aria-expanded={open === r.id}
              aria-label={`${r.label}. See who`}
              title={`${r.word}: see who`}
              onClick={() => show(r.id)}
              className={open === r.id ? 'c-chip c-chip-on' : 'c-chip'}
            >
              <Icon aria-hidden="true" className="w-[18px] h-[18px]" style={{ color: 'var(--accent)', fill: 'var(--accent)' }} />
              <span className="c-num c-w6">{r.count.toLocaleString('en')}</span>
            </button>
          );
        })}
      </div>
      {shown !== null ? (
        <div role="region" aria-label={`Who reacted ${shown.word}`} className="rounded-[14px] p-4 flex flex-col gap-2" style={{ background: 'var(--raise)' }}>
          <div className="flex items-center gap-3">
            {/* Once the names have arrived the number is theirs, so the two always agree. */}
            <p className="c-s14 c-w6 c-t1 flex-grow">{reactorsTitle({ word: shown.word, count: state.who?.total ?? shown.count })}</p>
            <button type="button" onClick={() => setOpen(null)} className="c-btn c-btn-quiet c-s14">
              Close
            </button>
          </div>
          {state.loading ? <p className="c-s14 c-t2">Loading…</p> : null}
          {state.error !== null ? (
            <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
              {state.error}
            </p>
          ) : null}
          {state.who !== null ? (
            <>
              <ul className="flex flex-col gap-1.5">
                {state.who.people.map((person, i) => (
                  // A list that is read once and never reordered: its position is its key.
                  <li key={i} className={person.name === null ? 'c-s14 c-t2' : 'c-s14 c-t1'}>
                    {person.name ?? 'No name yet'}
                  </li>
                ))}
              </ul>
              {more !== null ? <p className="c-s13 c-t2">{more}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One post. `report`: its entry on the reported list, where it is drawn with why it was
 *  reported and Keep in place of Pin. With `onPin` null (a person's own list) there is no
 *  Pin; with `onPerson` a member's name opens that person's posts. */
export default function PostCard({ gymId, gymName, post, pinnedCount = 0, words, readOnly, busy, report = null, onPin = null, onRemove, onKeep, onStop, onOpen, onPerson = null }) {
  /** Which box is open: null, 'remove' or 'stop'. */
  const [asking, setAsking] = useState(null);
  const box = removeBox(post, words);
  const stop = stopBox(post.author.name);
  const full = report === null && onPin !== null ? pinNote(post, pinnedCount) : null;
  const hidden = hiddenStaffNote(post, words, report !== null);
  const canStop = post.fromMember && post.authorId !== null;
  const opens = onPerson !== null && canOpenPerson(post);
  const Who = opens ? 'button' : 'div';
  return (
    <li className="c-card p-4 md:p-5 flex flex-col gap-3" data-testid={report === null ? 'post' : 'reported-post'}>
      {report !== null ? (
        <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }}>
          <Flag aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{reportedLine(report)}</span>
        </p>
      ) : null}
      {report !== null && report.notes.length > 0 ? (
        <div className="rounded-[14px] p-4 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid="report-notes">
          <p className="c-s13 c-t2">{reportNotesTitle(report)}</p>
          <ul className="flex flex-col gap-2">
            {report.notes.map((note, i) => (
              // Read once and never reordered: its position is its key.
              <li key={i} className="c-s14 c-t1 whitespace-pre-wrap break-words">
                {`“${note}”`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hidden !== null ? (
        <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }} data-testid="hidden-note">
          <EyeOff aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{hidden}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        {/* A member's picture and name are one thing to press: both open their posts. */}
        <Who className="flex items-center gap-3 min-w-0 flex-grow text-left" {...(opens ? { type: 'button', onClick: () => onPerson(post), 'aria-label': personLink(post) } : {})}>
          <span className="c-avatar" style={{ width: 40, height: 40, fontSize: 14 }} aria-hidden="true">
            {authorInitials(post, gymName)}
          </span>
          <span className="min-w-0 flex-grow block">
            <span className={`c-s15 c-w6 c-ell block ${opens ? 'c-lk' : 'c-t1'}`}>{authorName(post, gymName)}</span>
            <span className="c-s13 c-t2 block">{postedText(post.createdAt)}</span>
          </span>
        </Who>
        {post.fromMember ? <span className="c-tag c-tag-plain">{words.personCap}</span> : null}
        {post.authorStopped ? <span className="c-tag c-tag-warn">Stopped from posting</span> : null}
        {post.pinned ? (
          <span className="c-tag c-tag-soft">
            <Pin aria-hidden="true" className="w-3.5 h-3.5" /> Pinned
          </span>
        ) : null}
      </div>
      {post.body !== '' ? <p className="c-s15 c-t1 whitespace-pre-wrap break-words">{post.body}</p> : null}
      {post.photos.length > 0 ? (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {post.photos.map((photo, i) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => onOpen(post, i)}
                aria-label={`Open photo ${i + 1} of ${post.photos.length}`}
                className="block w-full rounded-[10px] overflow-hidden"
                style={{ aspectRatio: '1 / 1', background: 'var(--raise)' }}
              >
                <img
                  src={postPhotoUrl({ gymId, postId: post.id, photoId: photo.id })}
                  alt={`Photo ${i + 1} of ${post.photos.length}`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Reactions key={post.id} gymId={gymId} post={post} />
      {readOnly ? null : asking === 'remove' ? (
        <div role="group" aria-label={box.title} className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          <ConfirmInline
            newLook
            question={box.line}
            confirmLabel={box.confirm}
            cancelLabel={box.cancel}
            busy={busy}
            onConfirm={() => onRemove(post)}
            onCancel={() => setAsking(null)}
          />
        </div>
      ) : asking === 'stop' ? (
        <div role="group" aria-label={stop.title} className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{stop.title}</p>
          <ConfirmInline
            newLook
            question={stop.line}
            confirmLabel={stop.confirm}
            cancelLabel={stop.cancel}
            busy={busy}
            onConfirm={() => onStop(post, true).then(() => setAsking(null))}
            onCancel={() => setAsking(null)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          {report === null ? (
            onPin === null ? null : (
              <button type="button" disabled={busy || full !== null} onClick={() => onPin(post, !post.pinned)} className="c-btn c-btn-s c-btn-sm">
                {post.pinned ? <PinOff aria-hidden="true" className="w-4 h-4" /> : <Pin aria-hidden="true" className="w-4 h-4" />}
                {post.pinned ? 'Unpin' : 'Pin to the top'}
              </button>
            )
          ) : (
            <button type="button" disabled={busy} onClick={() => onKeep(post, report)} className="c-btn c-btn-s c-btn-sm">
              <Check aria-hidden="true" className="w-4 h-4" />
              Keep post
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setAsking('remove')} className="c-btn c-btn-s c-btn-sm">
            <Trash2 aria-hidden="true" className="w-4 h-4" />
            Remove post
          </button>
          {canStop && !post.authorStopped ? (
            <button type="button" disabled={busy} onClick={() => setAsking('stop')} className="c-btn c-btn-s c-btn-sm">
              <UserX aria-hidden="true" className="w-4 h-4" />
              Stop them posting
            </button>
          ) : null}
          {canStop && post.authorStopped ? (
            <button type="button" disabled={busy} onClick={() => onStop(post, false)} className="c-btn c-btn-s c-btn-sm">
              <UserCheck aria-hidden="true" className="w-4 h-4" />
              Let them post again
            </button>
          ) : null}
          {full !== null ? <span className="c-s13 c-t2">{full}</span> : null}
        </div>
      )}
    </li>
  );
}
