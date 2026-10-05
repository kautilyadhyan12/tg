import { useState } from 'react';
import { Ban, BicepsFlexed, Flag, Flame, Heart, Pin, ThumbsUp, Trash2 } from 'lucide-react';
import { postPhotoUrl } from '../../api/postsApi';
import { errorText } from '../../api/orgsApi';
import {
  REPORT_REASONS,
  authorInitials,
  authorName,
  authorTag,
  blockBox,
  canBlock,
  canOpenPerson,
  memberPostAction,
  ownRemoveBox,
  personLink,
  postedText,
  reactionButtons,
  reportBox,
  reportNoteLine,
} from './postsView';

// ONE POST, AS A MEMBER READS IT (spec Part 3 §15.2, §15.3): on the gym's Updates and on a
// person's profile. A member's name opens that person's posts where `onPerson` is given.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';
const ICONS = { like: ThumbsUp, love: Heart, strong: BicepsFlexed, fire: Flame };
const QUIET = { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' };
const SOFT = { background: 'rgba(255,138,31,0.15)', color: ORANGE };

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

/** The box a member reports a post in: one reason, then Send. */
function ReportBox({ name, gymName, busy, error, onSend, onCancel }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const box = reportBox(gymName);
  const room = reportNoteLine(note);
  return (
    <div role="group" aria-label={box.title} className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-sm font-semibold text-white">{box.title}</p>
      <p className="text-xs" style={{ color: MUTED }}>
        {box.line}
      </p>
      <div role="radiogroup" aria-label="Why are you reporting it?" className="flex flex-col gap-1">
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className="flex items-center gap-2.5 min-h-11 text-sm" style={{ color: 'rgba(255,255,255,0.88)' }}>
            <input type="radio" name={name} checked={reason === r.id} onChange={() => setReason(r.id)} disabled={busy} style={{ accentColor: ORANGE, width: 18, height: 18 }} />
            {r.word}
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.88)' }}>
          {box.noteLabel}
        </span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={box.notePlaceholder}
          disabled={busy}
          aria-describedby={`${name}-room`}
          className="rounded-xl px-3 py-2.5 text-sm text-white w-full"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
        <span id={`${name}-room`} className="text-xs" style={{ color: room.over ? RED : MUTED }}>
          {room.text}
        </span>
      </label>
      {error !== null && (
        <p className="text-sm" role="alert" style={{ color: RED }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || reason === null || room.over} onClick={() => onSend(reason, note)} className="rounded-xl px-3.5 text-sm font-semibold min-h-11 disabled:opacity-40" style={SOFT}>
          {busy ? 'Sending…' : box.confirm}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-3.5 text-sm font-semibold min-h-11" style={QUIET}>
          {box.cancel}
        </button>
      </div>
    </div>
  );
}

export default function PostCard({ gymId, gymName, post, busy, onReact, onOpen, onRemove, onReport, onBlock, onPerson = null }) {
  /** Which box is open under the post: null, 'remove', 'report' or 'block'. */
  const [asking, setAsking] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const tag = authorTag(post);
  const box = ownRemoveBox(post, gymName);
  const action = memberPostAction(post);
  const blocking = blockBox(post, gymName);

  const run = async (request) => {
    setWorking(true);
    setError(null);
    try {
      await request();
      setAsking(null);
    } catch (err) {
      setError(errorText(err, "That didn't work. Please try again."));
    } finally {
      setWorking(false);
    }
  };
  const close = () => {
    setAsking(null);
    setError(null);
  };

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
            {onPerson !== null && canOpenPerson(post) ? (
              <button type="button" onClick={() => onPerson(post)} aria-label={personLink(post)} className="font-semibold underline-offset-2 hover:underline" style={{ color: '#fff' }}>
                {authorName(post, gymName)}
              </button>
            ) : (
              authorName(post, gymName)
            )}
            {tag !== null && (
              <span className="text-xs font-medium ml-1.5" style={{ color: MUTED }}>
                · {tag}
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
      <div className="flex flex-wrap items-center gap-2 mt-3">
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
        {action === 'remove' ? (
          <button type="button" disabled={working} onClick={() => setAsking('remove')} className="min-h-11 px-3 rounded-xl flex items-center gap-1.5 text-sm font-semibold ml-auto" style={QUIET}>
            <Trash2 className="w-4 h-4" aria-hidden="true" /> Remove
          </button>
        ) : action === 'reported' ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold ml-auto" style={{ color: MUTED }}>
            <Flag className="w-3.5 h-3.5" aria-hidden="true" /> Reported
          </span>
        ) : action === 'report' ? (
          <button type="button" disabled={working} onClick={() => setAsking('report')} className="min-h-11 px-3 rounded-xl flex items-center gap-1.5 text-sm font-semibold ml-auto" style={QUIET}>
            <Flag className="w-4 h-4" aria-hidden="true" /> Report
          </button>
        ) : null}
        {canBlock(post) && (
          <button type="button" disabled={working} onClick={() => setAsking('block')} className={`min-h-11 px-3 rounded-xl flex items-center gap-1.5 text-sm font-semibold ${action === null ? 'ml-auto' : ''}`} style={QUIET}>
            <Ban className="w-4 h-4" aria-hidden="true" /> Block
          </button>
        )}
      </div>
      {asking === 'remove' && (
        <div role="group" aria-label={box.title} className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-sm font-semibold text-white">{box.title}</p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {box.line}
          </p>
          {error !== null && (
            <p className="text-sm" role="alert" style={{ color: RED }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working} onClick={() => run(() => onRemove(post))} className="rounded-xl px-3.5 text-sm font-semibold min-h-11" style={{ background: 'rgba(239,68,68,0.15)', color: RED }}>
              {working ? 'Removing…' : box.confirm}
            </button>
            <button type="button" disabled={working} onClick={close} className="rounded-xl px-3.5 text-sm font-semibold min-h-11" style={QUIET}>
              {box.cancel}
            </button>
          </div>
        </div>
      )}
      {asking === 'block' && (
        <div role="group" aria-label={blocking.title} className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-sm font-semibold text-white">{blocking.title}</p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {blocking.line}
          </p>
          {error !== null && (
            <p className="text-sm" role="alert" style={{ color: RED }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working} onClick={() => run(() => onBlock(post))} className="rounded-xl px-3.5 text-sm font-semibold min-h-11" style={SOFT}>
              {working ? 'Blocking…' : blocking.confirm}
            </button>
            <button type="button" disabled={working} onClick={close} className="rounded-xl px-3.5 text-sm font-semibold min-h-11" style={QUIET}>
              {blocking.cancel}
            </button>
          </div>
        </div>
      )}
      {asking === 'report' && <ReportBox name={`report-${post.id}`} gymName={gymName} busy={working} error={error} onSend={(reason, note) => run(() => onReport(post, reason, note))} onCancel={close} />}
    </li>
  );
}
