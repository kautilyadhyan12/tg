import { useEffect } from 'react';
import { Loader2, Mail, Pin } from 'lucide-react';
import { INBOX_NOTE, emptyInbox, messageRow, pausedInbox, pinnedNote } from './inboxView';

// THE MEMBER'S INBOX FROM THEIR GYM (spec Part 3 §16.1; ROADMAP 20a): the gym's one pinned
// note, then its messages, newest first. Opening it tells the server they have been seen;
// the New marks stay until the inbox is read again. The server sends a person only their
// own messages, and only while they are a member of this gym.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';

export default function Inbox({ gym, inbox }) {
  const { loading, error, reload, markSeen } = inbox;
  const read = inbox.inbox;

  useEffect(() => {
    markSeen();
  }, [markSeen]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm mt-4" style={{ color: MUTED }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your messages…
      </div>
    );
  }
  if (error !== null || read === null) {
    return (
      <div className="mt-4">
        <p className="text-sm" style={{ color: RED }}>
          {error ?? "Couldn't load your messages."}
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold min-h-11"
          style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (read.status === 'paused') {
    return (
      <p className="text-sm mt-4" style={{ color: MUTED }}>
        {pausedInbox(gym.name)}
      </p>
    );
  }

  const pinned = pinnedNote(gym);
  const rows = read.messages.map((message) => messageRow(message));

  return (
    <div className="mt-4 flex flex-col gap-2">
      {pinned === null ? null : (
        <div
          className="rounded-xl p-3 flex items-start gap-2.5"
          style={{ background: 'rgba(255,138,31,0.10)', border: '1px solid rgba(255,138,31,0.30)' }}
        >
          <Pin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: ORANGE }} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm" style={{ color: '#fff' }}>
              {pinned.text}
            </p>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              Pinned{pinned.when === null ? '' : ` · ${pinned.when}`}
            </p>
          </div>
        </div>
      )}
      {rows.length === 0 && pinned === null ? (
        <p className="text-sm" style={{ color: MUTED }}>
          {emptyInbox(gym.name)}
        </p>
      ) : rows.length === 0 ? null : (
        <ul className="flex flex-col gap-2" aria-label={`Messages from ${gym.name}`}>
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl p-3 flex items-start gap-2.5"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Mail className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: row.isNew ? ORANGE : MUTED }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm" style={{ color: '#fff', overflowWrap: 'anywhere' }}>
                  {row.body}
                </p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  {row.isNew ? (
                    <span className="font-semibold" style={{ color: ORANGE }}>
                      New
                    </span>
                  ) : null}
                  {row.isNew && row.when !== null ? ' · ' : ''}
                  {row.when}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs" style={{ color: MUTED }}>
        {INBOX_NOTE}
      </p>
    </div>
  );
}
