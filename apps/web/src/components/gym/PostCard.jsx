import { useState } from 'react';
import { Ban, BicepsFlexed, Check, ChevronRight, EyeOff, Flag, Flame, Heart, Medal, Pin, ThumbsUp, Trash2, Trophy } from 'lucide-react';
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
  hiddenOwnNote,
  memberPostAction,
  ownRemoveBox,
  personLink,
  postedText,
  reactionButtons,
  reportBox,
  reportNoteLine,
} from './postsView';
import { resultPost } from './challengesView';

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

const MEDAL = { 1: '#F5C542', 2: '#C9CED6', 3: '#D08A5B' };

/** A challenge's result, under the post that says it ended: who won as the Challenges tab
 *  says it, the first three or the teams, the prize, and a way to the challenge itself. */
function ChallengeResult({ result, onChallenge }) {
  return (
    <div className="mt-3 rounded-xl p-3 flex flex-col gap-2.5" style={{ background: 'rgba(245,197,66,0.08)', border: '1px solid rgba(245,197,66,0.3)' }} aria-label="How it finished" data-testid="challenge-result">
      <div className="flex items-start gap-2.5">
        <Trophy aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: MEDAL[1] }} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white break-words">{result.headline}</p>
          {result.mine !== null && (
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {result.mine}
            </p>
          )}
        </div>
      </div>
      {result.rows.length > 0 && (
        <ol className="flex flex-col gap-1.5" aria-label={result.rowsLabel}>
          {result.rows.map((row) => (
            <li key={row.key} aria-label={row.label} className="rounded-xl px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <span className="w-11 flex items-center gap-1 text-sm font-bold flex-shrink-0" style={{ color: MEDAL[row.place] ?? MUTED }}>
                {row.placeText === null ? (
                  '—'
                ) : (
                  <>
                    {row.place <= 3 && <Medal aria-hidden="true" className="w-4 h-4" />}
                    {row.placeText}
                  </>
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-white break-words">
                  {row.name}
                  {row.mine !== null && (
                    <span className="ml-2 text-[11px] font-bold px-1.5 py-0.5 rounded-full align-middle" style={{ background: ORANGE, color: '#111' }}>
                      {row.mine}
                    </span>
                  )}
                </span>
                {row.sub !== null && (
                  <span className="block text-xs" style={{ color: MUTED }}>
                    {row.sub}
                  </span>
                )}
              </span>
              {row.reached && (
                <span className="flex items-center gap-0.5 text-[11px] font-semibold flex-shrink-0" style={{ color: ORANGE }}>
                  <Check aria-hidden="true" className="w-3 h-3" strokeWidth={3} /> Reached
                </span>
              )}
              {row.number !== null && <span className="text-sm font-bold text-white tabular-nums flex-shrink-0">{row.number}</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs break-words" style={{ color: MUTED }}>
        {result.facts}
      </p>
      {result.prize !== null && <p className="text-sm text-white break-words">{result.prize}</p>}
      {result.canOpen && onChallenge !== null && (
        <button type="button" onClick={() => onChallenge(result.challengeId)} className="self-start rounded-xl px-3.5 text-sm font-semibold min-h-11 flex items-center gap-1" style={SOFT}>
          See the challenge <ChevronRight aria-hidden="true" className="w-4 h-4" />
        </button>
      )}
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

export default function PostCard({ gymId, gymName, post, busy, onReact, onOpen, onRemove, onReport, onBlock, onPerson = null, onChallenge = null }) {
  /** Which box is open under the post: null, 'remove', 'report' or 'block'. */
  const [asking, setAsking] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const tag = authorTag(post);
  const box = ownRemoveBox(post, gymName);
  const action = memberPostAction(post);
  const blocking = blockBox(post, gymName);
  const hidden = hiddenOwnNote(post, gymName);
  const result = resultPost(post.challengeResult, gymName);
  const opens = onPerson !== null && canOpenPerson(post);
  const Who = opens ? 'button' : 'div';

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
        {/* A member's picture and name are one thing to press: both open their profile. */}
        <Who className="flex items-center gap-2.5 min-w-0 flex-1 text-left" {...(opens ? { type: 'button', onClick: () => onPerson(post), 'aria-label': personLink(post) } : {})}>
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}
            aria-hidden="true"
          >
            {authorInitials(post, gymName)}
          </span>
          <span className="min-w-0 flex-1 block">
            <span className="text-sm font-semibold text-white truncate block">
              {authorName(post, gymName)}
              {tag !== null && (
                <span className="text-xs font-medium ml-1.5" style={{ color: MUTED }}>
                  · {tag}
                </span>
              )}
            </span>
            <span className="text-xs block" style={{ color: MUTED }}>
              {postedText(post.createdAt)}
            </span>
          </span>
        </Who>
        {post.pinned && (
          <span className="flex items-center gap-1 text-xs font-semibold flex-shrink-0" style={{ color: ORANGE }}>
            <Pin className="w-3.5 h-3.5" aria-hidden="true" /> Pinned
          </span>
        )}
      </div>
      {hidden !== null && (
        <p className="flex items-start gap-2 text-xs font-semibold mt-3" style={{ color: ORANGE }} data-testid="hidden-note">
          <EyeOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{hidden}</span>
        </p>
      )}
      {post.body !== '' && (
        <p className="text-sm mt-3 whitespace-pre-wrap break-words" style={{ color: 'rgba(255,255,255,0.88)' }}>
          {post.body}
        </p>
      )}
      {result !== null && <ChallengeResult result={result} onChallenge={onChallenge} />}
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
