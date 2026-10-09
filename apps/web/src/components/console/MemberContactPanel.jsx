import { useState } from 'react';
import { GYM_CONTACT_EMAIL_MAX_CHARS, GYM_CONTACT_PHONE_MAX_CHARS } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import {
  memberContactChanged,
  memberContactDraft,
  memberContactNote,
  memberContactPatch,
  memberContactProblem,
  memberContactSummary,
  memberContactTitle,
} from '../../pages/console/memberContactView';
import { ConsoleFailed, ConsoleSection } from './ConsoleStates';

// HOW MEMBERS REACH YOU (ROADMAP 20a-iii): the phone number and email address a gym's
// members see in the app, under Contact the gym in their Inbox. Both wait for Save, as
// the gym's details do above, and both are saved by the same route.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

// `startOpen`: the page was opened by a link to this section.
export default function MemberContactPanel({ org, readOnly, startOpen = false }) {
  const fromOrg = memberContactDraft(org);
  // `kept` is what the server holds; `draft` is what is in the boxes.
  const [kept, setKept] = useState(fromOrg);
  const [draft, setDraft] = useState(fromOrg);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // The console reads the gym again after any save on this page. The boxes follow it,
  // unless somebody is part-way through typing here.
  const [seenOrg, setSeenOrg] = useState(org);
  if (seenOrg !== org) {
    setSeenOrg(org);
    if (!memberContactChanged(draft, kept)) setDraft(fromOrg);
    setKept(fromOrg);
  }

  const changed = memberContactChanged(draft, kept);
  const problem = memberContactProblem(draft);
  const canSave = changed && problem === null && !saving && !readOnly;

  const edit = (field, value) => {
    setDraft((was) => ({ ...was, [field]: value }));
    setSaved(false);
    setError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    const patch = memberContactPatch(draft, kept);
    if (!canSave || patch === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await orgService.updateOrg(org.id, patch);
      const now = memberContactDraft(res.data);
      setKept(now);
      setDraft(now);
      setSaved(true);
      // Overview's Start here list and the rest of the console read the gym again.
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleSection title={memberContactTitle(org.orgType)} summary={memberContactSummary(kept, org.orgType)} defaultOpen={startOpen}>
      <form onSubmit={save} className="flex flex-col gap-4">
        {readOnly ? (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {readOnlyNote(org.orgType)}
          </p>
        ) : null}
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {memberContactNote(org.orgType)}
        </p>

        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Phone number
          </span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={draft.phone}
            onChange={(e) => edit('phone', e.target.value)}
            disabled={readOnly || saving}
            maxLength={GYM_CONTACT_PHONE_MAX_CHARS}
            placeholder="020 7946 0958"
            aria-label="Phone number"
            className="mt-2 w-full rounded-xl px-4 py-3 text-base sm:text-sm"
            style={inputStyle}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Email address
          </span>
          <input
            type="email"
            autoComplete="off"
            value={draft.email}
            onChange={(e) => edit('email', e.target.value)}
            disabled={readOnly || saving}
            maxLength={GYM_CONTACT_EMAIL_MAX_CHARS}
            placeholder="frontdesk@yourgym.com"
            aria-label="Email address"
            className="mt-2 w-full rounded-xl px-4 py-3 text-base sm:text-sm"
            style={inputStyle}
          />
        </label>

        {problem !== null && changed ? (
          <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>
            {problem}
          </p>
        ) : null}
        {error !== null ? <ConsoleFailed message={error} /> : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
            style={{
              background: canSave ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
              color: canSave ? '#0A0908' : 'rgba(255,255,255,0.35)',
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved ? (
            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </ConsoleSection>
  );
}
