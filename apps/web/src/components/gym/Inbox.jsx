import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail, Phone, Pin } from 'lucide-react';
import { inboxService } from '../../api/inboxApi';
import {
  INBOX_NOTE,
  contactButton,
  contactSetUp,
  contactView,
  emptyInbox,
  groupSwitch,
  kindSwitches,
  messageRow,
  pausedInbox,
  pinnedNote,
  switchesHeading,
} from './inboxView';

// THE MEMBER'S INBOX FROM THEIR GYM (spec Part 3 §16.1; ROADMAP 20a): the gym's one pinned
// note, then its messages, newest first. Opening it tells the server they have been seen;
// the New marks stay until the inbox is read again. The server sends a person only their
// own messages, and only while they are a member of this gym.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';

// CONTACT THE GYM (ROADMAP 20a-iii): nobody can reply in the inbox, so the button under it
// opens the phone number and email the gym added for its members. A gym that added
// neither has no button, and one line saying so.
function ContactGym({ gym, contact }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const view = contactView(contact, gym.name);
  if (view.none !== null) {
    // Somebody who trains at the gym they run is given the place to add them.
    const setUp = contactSetUp(gym);
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs" style={{ color: MUTED }}>
          {view.none}
        </p>
        {setUp === null ? null : (
          <Link
            to={setUp}
            className="rounded-xl px-3.5 py-2 text-sm font-semibold min-h-11 inline-flex items-center"
            style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE, border: '1px solid rgba(255,138,31,0.30)' }}
          >
            Add your phone or email
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-xl px-3.5 py-2 text-sm font-semibold min-h-11"
        style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE, border: '1px solid rgba(255,138,31,0.30)' }}
      >
        {contactButton(gym.orgType)}
      </button>
      {open ? (
        <ul id={panelId} className="flex flex-col gap-2 w-full" aria-label={`How to reach ${gym.name}`}>
          {view.ways.map((way) => (
            <li key={way.kind}>
              <a
                href={way.href}
                className="rounded-xl px-3.5 py-2 text-sm min-h-11 inline-flex items-center gap-2.5 max-w-full"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', overflowWrap: 'anywhere' }}
              >
                {way.kind === 'phone' ? (
                  <Phone className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} aria-hidden="true" />
                ) : (
                  <Mail className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} aria-hidden="true" />
                )}
                {way.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ONE OF THE MEMBER'S OWN SWITCHES. The whole row is the thing to press. `change` sends
// the new setting and answers how it now stands.
function SwitchRow({ words, on, change }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const press = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await change(!on);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void press()}
        className="rounded-xl p-3 min-h-11 flex items-center justify-between gap-3 text-left w-full"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', opacity: busy ? 0.6 : 1 }}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white" style={{ overflowWrap: 'anywhere' }}>
            {words.label}
          </span>
          <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
            {words.line}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="w-12 h-6 rounded-full relative flex-shrink-0 transition-all"
          style={{ background: on ? 'linear-gradient(135deg, #FF8A1F, #FFB347)' : 'rgba(255,255,255,0.08)' }}
        >
          <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all" style={{ left: on ? 28 : 4, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </span>
      </button>
      {failed ? (
        <p className="text-xs" role="alert" style={{ color: RED }}>
          We couldn't change that. Please try again.
        </p>
      ) : null}
    </div>
  );
}

// THE MEMBER'S OWN SWITCHES for this gym: its messages to many people at once (ROADMAP
// 20f-i), then each automatic message a member can switch off (20b-i). Off, the gym's
// staff are told this person gets none, and the sender writes them none.
function MessageSwitches({ gym, startGroup, startOff }) {
  const [group, setGroup] = useState(startGroup);
  const [off, setOff] = useState(startOff);
  return (
    <section className="flex flex-col gap-2 mt-2" aria-label={switchesHeading(gym)}>
      <h3 className="text-sm font-semibold text-white">{switchesHeading(gym)}</h3>
      <SwitchRow words={groupSwitch(gym, group)} on={group} change={async (on) => setGroup(await inboxService.setGroupMessages(gym.id, on))} />
      {kindSwitches(gym, off).map((row) => (
        <SwitchRow key={row.kind} words={row} on={row.on} change={async (on) => setOff(await inboxService.setKindSwitch(gym.id, row.kind, on))} />
      ))}
    </section>
  );
}

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
                <p className="text-sm" style={{ color: '#fff', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
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
      {/* Keyed: another gym's page starts with its own button shut. */}
      <ContactGym key={gym.id} gym={gym} contact={read.contact} />
      <MessageSwitches key={`switch-${gym.id}`} gym={gym} startGroup={read.groupMessages !== false} startOff={read.off ?? []} />
    </div>
  );
}
