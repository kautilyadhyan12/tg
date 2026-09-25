import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Copy, Loader2, Mail, X } from 'lucide-react';
import { MEMBER_INVITE_PERMISSION_WORDS } from '@app/shared';
import { orgService, errorText, inviteChangedPreview } from '../../api/orgsApi';
import { Tick } from './MemberListUpload';
import {
  inviteBlockedWords,
  inviteBody,
  inviteIgnores,
  inviteQueryString,
  inviteShareText,
  inviteWho,
  joinLink,
  skippedLines,
} from './memberListPeople';

// Invite from the list (ROADMAP 5b-ii; spec Part 3 §9.12, §9.14): the box the list's
// Invite button opens. It says who the press is for, how many get an email and who is
// left out and why, then sends. A list that changed meanwhile invites nobody and the
// box shows the new count. Afterwards it offers the invitation's words and link to send
// another way. Every number is the server's.

const C = {
  panel: '#0f0e0d',
  card: '#141210',
  line: 'rgba(255,255,255,0.07)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.12)',
  green: '#34d399',
  plain: 'rgba(255,255,255,0.06)',
};
const BUTTON = 'rounded-xl min-h-[48px] px-5 text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40';

const count = (k) => k.toLocaleString('en');

/** The invitation's words and link, with a Copy button. */
export function ShareInvite({ gymName, slug, email = null }) {
  const text = inviteShareText({ gymName, link: joinLink(window.location.origin, slug), email });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="share-invite">
      <textarea
        readOnly
        aria-label="The invitation's words"
        value={text}
        rows={8}
        onFocus={(e) => e.target.select()}
        className="w-full rounded-xl px-3 py-2.5 text-sm resize-none"
        style={{ background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: C.soft }}
      />
      <button type="button" onClick={() => void copy()} className="self-start rounded-xl min-h-[44px] px-4 text-sm font-semibold flex items-center gap-2" style={{ background: C.plain, color: C.soft }}>
        {copied ? <Check className="w-4 h-4" style={{ color: C.green }} /> : <Copy className="w-4 h-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function MemberListInvite({ gymId, gym, filters, words, readOnly, preview: first, onSent, onClose }) {
  const [preview, setPreview] = useState(first);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const [permission, setPermission] = useState(false);

  // Counted again as the box opens: the button's number may be minutes old.
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
  }, [gymId, filters]);

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
        // The tick was for the group staff saw; a new group is ticked again.
        setPermission(false);
      }
      setError(errorText(err, "We couldn't send the invitations. Please try again."));
    } finally {
      setSending(false);
    }
  };

  const blocked = preview === null ? null : inviteBlockedWords(preview.blocked, words);
  const reach = preview?.reach ?? 0;
  const ignores = inviteIgnores(filters);
  const people = (k) => (k === 1 ? words.person : words.people);

  let body;
  if (sent !== null) {
    const left = skippedLines(sent.skipped);
    body = (
      <>
        <p className="text-[15px] flex gap-2" style={{ color: '#fff' }} role="status">
          <Check className="w-5 h-5 flex-shrink-0" style={{ color: C.green }} />
          {sent.queued === 0
            ? 'Nobody new was invited.'
            : `${count(sent.queued)} ${sent.queued === 1 ? 'invitation is' : 'invitations are'} on the way.`}
        </p>
        {sent.queued > 0 ? (
          <p className="text-sm" style={{ color: C.muted }}>
            Emails go out in small batches, so a long list can take a day or more. Each person&apos;s page shows how theirs went.
          </p>
        ) : null}
        {left.length > 0 ? <LeftOut lines={left} /> : null}
        {sent.queued > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold" style={{ color: '#fff' }}>
              Share it yourself too
            </h3>
            <p className="text-sm" style={{ color: C.muted }}>
              Send these words by WhatsApp, text or your own email. The link only lets in someone who signs in with the address you
              invited.
            </p>
            <ShareInvite gymName={gym.name} slug={gym.slug} />
          </section>
        ) : null}
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
          Done
        </button>
      </>
    );
  } else if (preview === null) {
    body =
      error !== null ? (
        <p className="text-sm" style={{ color: C.soft }} role="alert">
          {error}
        </p>
      ) : (
        <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Counting…
        </p>
      );
  } else {
    const left = skippedLines(preview.skipped);
    body = (
      <>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
            Who
          </p>
          <p className="text-sm mt-1" style={{ color: C.soft }} data-testid="invite-who">
            {inviteWho(filters)}
          </p>
          {ignores !== null ? (
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              {ignores}
            </p>
          ) : null}
        </div>
        {blocked !== null ? (
          <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: C.orangeBg }} role="alert">
            <p className="text-sm flex gap-2" style={{ color: '#fff' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: C.orange }} />
              {blocked}
            </p>
            {preview.blocked === 'no_postal_address' ? (
              <Link to={`/console/${gym.slug}/settings`} className="text-sm font-semibold self-start" style={{ color: C.orange }}>
                Open Settings
              </Link>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <p className="text-3xl font-bold" style={{ color: '#fff' }} data-testid="invite-reach">
            {count(reach)}
          </p>
          <p className="text-sm mt-1" style={{ color: C.soft }}>
            {reach === 0 ? `Nobody here is waiting for an invitation.` : `${people(reach)} will get an email invitation.`}
          </p>
        </div>
        {left.length > 0 ? <LeftOut lines={left} /> : null}
        <p className="text-sm" style={{ color: C.muted }}>
          They get one email from {gym.name} via AI Home Gym with a link to the app. Only someone who signs in with that email address can
          join.
        </p>
        {reach > 0 && blocked === null ? (
          <Tick checked={permission} onChange={setPermission}>
            {MEMBER_INVITE_PERMISSION_WORDS.replace('{people}', words.people)}
          </Tick>
        ) : null}
        {error !== null ? (
          <p className="text-sm" style={{ color: '#fff' }} role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={reach === 0 || blocked !== null || !permission || readOnly || sending}
            className={`${BUTTON} flex-1 sm:flex-none`}
            style={{ background: C.orange, color: '#000' }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {reach === 1 ? 'Send 1 invitation' : `Send ${count(reach)} invitations`}
          </button>
          <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
            Close
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
          aria-label="Invite to the app"
          data-testid="invite-box"
          className="w-full sm:max-w-[560px] rounded-t-[28px] sm:rounded-[28px] p-5 sm:p-6 flex flex-col gap-4"
          style={{ background: C.panel, border: `1px solid ${C.line}` }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#fff' }}>
              Invite to the app
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

function LeftOut({ lines }) {
  return (
    <div data-testid="invite-left-out">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
        Left out
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.key} className="text-sm" style={{ color: C.soft }}>
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
