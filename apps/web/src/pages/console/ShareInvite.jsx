import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { inviteShareText, joinLink } from './memberListPeople';

// The invitation's words and link, with a Copy button: after an Invite, and from a
// person's page. `newLook` draws it from `console.css` (Invite's page); without it, in
// the person's page's own dark colours until that page is restyled.

const OLD = {
  soft: 'rgba(255,255,255,0.8)',
  green: '#34d399',
  plain: 'rgba(255,255,255,0.06)',
};

export function ShareInvite({ gymName, slug, email = null, newLook = false }) {
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
  if (newLook) {
    return (
      <div className="flex flex-col gap-2" data-testid="share-invite">
        <textarea readOnly aria-label="The invitation's words" value={text} rows={7} onFocus={(e) => e.target.select()} className="c-area" />
        <button type="button" onClick={() => void copy()} className="c-btn c-btn-s self-start">
          {copied ? <Check aria-hidden="true" className="w-4 h-4" /> : <Copy aria-hidden="true" className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="share-invite">
      <textarea
        readOnly
        aria-label="The invitation's words"
        value={text}
        rows={8}
        onFocus={(e) => e.target.select()}
        className="w-full rounded-xl px-3 py-2.5 text-sm resize-none"
        style={{ background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: OLD.soft }}
      />
      <button type="button" onClick={() => void copy()} className="self-start rounded-xl min-h-[44px] px-4 text-sm font-semibold flex items-center gap-2" style={{ background: OLD.plain, color: OLD.soft }}>
        {copied ? <Check className="w-4 h-4" style={{ color: OLD.green }} /> : <Copy className="w-4 h-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
