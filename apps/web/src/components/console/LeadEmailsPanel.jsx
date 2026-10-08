import { useCallback, useEffect, useRef, useState } from 'react';
import { LEAD_EMAIL_SETTINGS_WORDS } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { placeFor } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';
import SentencePlace from './SentencePlace';
import {
  leadEmailsBody,
  leadEmailsChanged,
  leadEmailsDraft,
  leadEmailsProblem,
  tickSendForMe,
  usedThisMonthLine,
} from '../../pages/console/leadEmailsView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// FOLLOW-UP EMAILS TO LEADS (ROADMAP 20c-v; RULINGS 2026-09-27): the owner's "Send them
// for me". Off until they turn it on; then the app sends each new lead's three
// follow-ups itself, for up to 100 new leads a month, and replies go to the address
// here, since the app's sending address has no inbox. The switch and the address wait
// for Save together, as the gym's details do above.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

// `startOpen`: the page was opened by a link to this section.
export default function LeadEmailsPanel({ org, readOnly, startOpen = false }) {
  const gymId = org.id;
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(
    (isLive = () => true) =>
      orgService
        .getLeadEmailSettings(gymId)
        .then((res) => {
          if (!isLive()) return;
          setSettings(res.data.settings);
          setDraft(leadEmailsDraft(res.data.settings));
        })
        .catch((err) => {
          // Never drawn as a switched-off box: the section opens and says so.
          if (isLive()) setLoadError(errorText(err, "We couldn't load your follow-up email settings."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchSettings(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  // THE GYM'S DETAILS ARE SAVED HIGHER UP THIS PAGE, and two of them stop this box (the
  // postal address, the name). A save there brings a fresh copy of the gym, so the facts
  // are read again then, and what is typed here is kept.
  const seenOrg = useRef(org);
  useEffect(() => {
    if (seenOrg.current === org) return undefined;
    seenOrg.current = org;
    let cancelled = false;
    orgService
      .getLeadEmailSettings(gymId)
      .then((res) => {
        if (cancelled) return;
        setSettings(res.data.settings);
        setDraft((typed) => typed ?? leadEmailsDraft(res.data.settings));
        setSaveError(null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [org, gymId]);

  const retry = () => {
    setLoadError(null);
    void fetchSettings();
  };

  const problem = settings !== null && draft !== null ? leadEmailsProblem(draft, settings) : null;
  const changed = settings !== null && draft !== null && leadEmailsChanged(draft, settings);
  const canSave = changed && problem === null && !saving && !readOnly;

  const edit = (next) => {
    setDraft(next);
    setSaved(false);
    setSaveError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.updateLeadEmailSettings(gymId, leadEmailsBody(draft));
      setSettings(res.data.settings);
      setDraft(leadEmailsDraft(res.data.settings));
      setSaved(true);
    } catch (err) {
      const code = errorCode(err);
      setSaveError({
        message: errorText(err, "We couldn't save that. Please try again."),
        place: code === 'gym_name' ? 'gymName' : code === 'needs_postal_address' ? 'postalAddress' : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleSection
      title="Follow-up emails to leads"
      summary={settings === null ? 'Who sends a new lead their 3 follow-up emails' : settings.sendForMe ? 'Sent for you' : 'You send them from your own email'}
      forceOpen={loadError !== null}
      defaultOpen={startOpen}
    >
      {/* Above the boxes, and before they load, as its neighbours say it. */}
      {readOnly ? (
        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={retry} />
      ) : settings === null || draft === null ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            A new lead who ticks &ldquo;Happy to hear from us&rdquo; gets 3 follow-up emails: on the day, 3 days later
            and 4 days after that. You can send them yourself from each lead&apos;s panel, or we can send them for you.
          </p>

          {settings.stopped ? (
            <p className="text-sm" style={{ color: '#ef4444' }}>
              {LEAD_EMAIL_SETTINGS_WORDS.sending_stopped}
            </p>
          ) : null}
          {settings.appSending === 'paused' ? (
            <p className="text-sm" style={{ color: '#ef4444' }}>
              {LEAD_EMAIL_SETTINGS_WORDS.paused}
            </p>
          ) : null}

          <label className={`flex items-start gap-3 ${readOnly ? '' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={draft.sendForMe}
              onChange={(e) => edit(tickSendForMe(draft, e.target.checked, user?.email))}
              disabled={readOnly || saving}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="text-sm block" style={{ color: '#fff' }}>
                Send them for me
              </span>
              <span className="text-xs block mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                They come from &ldquo;{org.name} via AI Home Gym&rdquo;, from 8 in the morning by your clock. Up to{' '}
                {settings.perMonth} new leads a month; after that, the rest wait for you on the Leads page as they do
                now.
              </span>
            </span>
          </label>
          {/* Outside the label, so pressing it opens Leads and ticks nothing. It leaves this
              form, so it asks first while a change here is not saved. */}
          <PlaceLink to={placeFor(org.slug, viewerPrivileges(org), 'leads')} guard={changed} className="c-lk text-sm self-start">
            Open Leads
          </PlaceLink>

          <label className="block">
            <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Replies go to
            </span>
            <span className="block text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Our sending address has no inbox, so when a lead replies, it comes here.
            </span>
            <input
              type="email"
              value={draft.replyTo}
              onChange={(e) => edit({ ...draft, replyTo: e.target.value })}
              disabled={readOnly || saving}
              placeholder="frontdesk@yourgym.com"
              aria-label="Replies go to"
              className="mt-2 w-full rounded-xl px-4 py-3 text-base sm:text-sm"
              style={inputStyle}
            />
          </label>

          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {usedThisMonthLine(settings)}
          </p>

          {problem !== null && (changed || settings.sendForMe) ? (
            <p className="text-sm" style={{ color: '#ef4444' }}>
              {problem}
            </p>
          ) : null}
          {/* The box is higher up this same page, so nothing typed here is lost. */}
          {problem !== null && (changed || settings.sendForMe) ? (
            <SentencePlace kind={problem === LEAD_EMAIL_SETTINGS_WORDS.needs_postal_address ? 'postalAddress' : null} gym={org} className="c-lk text-sm self-start" />
          ) : null}
          {saveError !== null ? <ConsoleFailed message={saveError.message} /> : null}
          {saveError !== null ? <SentencePlace kind={saveError.place} gym={org} className="c-lk text-sm self-start" /> : null}

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
      )}
    </ConsoleSection>
  );
}
