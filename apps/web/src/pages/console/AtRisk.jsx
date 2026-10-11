import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, MessageSquare } from 'lucide-react';
import { atRiskService } from '../../api/atRiskApi';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { canManageOrg } from './gymDetailsView';
import { placeFor } from './consolePlaces';
import MemberListPerson from './MemberListPerson';
import { Refusal } from './MemberListTags';
import {
  AT_RISK_FOOTNOTE,
  MESSAGE_CHOICES,
  QUIET_CHOICES,
  WEEKS_CHOICES,
  atRiskHeadline,
  atRiskIntro,
  atRiskMore,
  canSeeAtRisk,
  checkinNote,
  messageBoxNote,
  messageLine,
  rowAction,
  rowFacts,
  shownName,
} from './atRiskView';

// AT RISK (spec Part 3 §16.4; ROADMAP 20d-i): the people who used to come and have
// stopped, each with their last check-in and one press to send them a come-back message.
// The menu draws the line for `members.read`; the address can be typed by anybody, so
// somebody without the tick is told, and nothing is asked for them.

const PAGE = 25;

/** The gym's two numbers: two pickers and one Save, for whoever runs the gym. */
function Numbers({ gymId, settings, locked, lockedNote, onSaved }) {
  const [draft, setDraft] = useState(settings);
  const [state, setState] = useState({ saving: false, error: null, saved: false });
  const changed = draft.quietDays !== settings.quietDays || draft.weeksCame !== settings.weeksCame;
  const quietId = useId();
  const weeksId = useId();

  const save = async () => {
    setState({ saving: true, error: null, saved: false });
    try {
      const now = await atRiskService.saveSettings(gymId, draft);
      setState({ saving: false, error: null, saved: true });
      onSaved(now);
    } catch (err) {
      setState({ saving: false, error: errorText(err, "We couldn't save that. Try again."), saved: false });
    }
  };
  const pick = (field) => (e) => {
    setDraft((was) => ({ ...was, [field]: Number(e.target.value) }));
    setState((was) => ({ ...was, error: null, saved: false }));
  };

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Who is listed">
      <h2 className="c-h3">Who is listed</h2>
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="c-field">
          <label className="c-label" htmlFor={quietId}>
            No check-in for
          </label>
          <select id={quietId} className="c-input" style={{ maxWidth: 240 }} value={draft.quietDays} disabled={locked || state.saving} onChange={pick('quietDays')}>
            {QUIET_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={weeksId}>
            After coming in at least
          </label>
          <select id={weeksId} className="c-input" style={{ maxWidth: 240 }} value={draft.weeksCame} disabled={locked || state.saving} onChange={pick('weeksCame')}>
            {WEEKS_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="c-btn c-btn-p c-btn-lg md:self-end" disabled={locked || !changed || state.saving} onClick={() => void save()}>
          {state.saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="c-s13 c-t3" role="status">
        {locked ? lockedNote : state.saved && !changed ? 'Saved. The list below uses the new numbers.' : changed ? 'Not saved yet.' : ''}
      </p>
      {state.error !== null ? (
        <Refusal>{state.error}</Refusal>
      ) : null}
    </section>
  );
}

/** One person: their name (which opens their page), the two facts, and what can be done. */
function Row({ person, org, readOnly, onOpenPerson, onSent }) {
  const name = shownName(person, org.orgType);
  const facts = rowFacts(person);
  const action = rowAction(person, { orgType: org.orgType, timezone: org.timezone, readOnly });
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(MESSAGE_CHOICES[0]?.preset ?? null);
  const [state, setState] = useState({ sending: false, error: null, sent: null });
  const groupName = useId();

  const send = async () => {
    if (preset === null || person.userId === null) return;
    setState({ sending: true, error: null, sent: null });
    try {
      const nudge = await atRiskService.sendMessage(org.id, person.userId, preset);
      setState({ sending: false, error: null, sent: nudge.preset });
      setOpen(false);
      onSent();
    } catch (err) {
      setState({ sending: false, error: errorText(err, "We couldn't send that message. Try again."), sent: null });
      // Somebody else sent one first: the row now says so.
      if (errorStatus(err) === 409) onSent();
    }
  };

  return (
    <li className="c-row flex-col items-stretch gap-3" data-testid="at-risk-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1 min-w-0">
          {person.entryId !== null ? (
            <button type="button" className="c-btn-link c-s16 c-w6 self-start text-left" onClick={() => onOpenPerson(person.entryId)} aria-label={`Open ${name.full}'s page`}>
              {name.full}
            </button>
          ) : (
            <p className="c-s16 c-w6 c-t1">{name.full}</p>
          )}
          <p className="c-s14 c-t2">{facts.last}</p>
          <p className="c-s13 c-t3">{facts.regular}</p>
        </div>
        {action.kind === 'send' && !open ? (
          <button type="button" className="c-btn c-btn-s c-btn-lg self-start md:self-center flex-shrink-0" disabled={action.disabled} onClick={() => setOpen(true)}>
            <MessageSquare aria-hidden="true" className="w-4 h-4" />
            Send a message
          </button>
        ) : null}
      </div>

      {state.sent !== null ? (
        <p className="c-s14 c-t1 c-w6" role="status">
          {`Sent to ${name.first}: “${messageLine(state.sent) ?? 'your message'}”`}
        </p>
      ) : null}
      {action.kind === 'sent' && state.sent === null ? <p className="c-s14 c-t2">{action.line}</p> : null}
      {action.kind === 'send' && action.earlier !== null && !open && state.sent === null ? <p className="c-s13 c-t3">{action.earlier}</p> : null}
      {action.kind === 'send' && action.disabled ? <p className="c-s13 c-t3">{readOnlyNote(org.orgType)}</p> : null}
      {action.kind === 'no_app' || action.kind === 'shared' ? (
        <div className="flex flex-col gap-2">
          <p className="c-s14 c-t2">{action.line}</p>
          {person.entryId !== null ? (
            <button type="button" className="c-btn c-btn-s c-btn-sm self-start" onClick={() => onOpenPerson(person.entryId)}>
              Open their page
            </button>
          ) : null}
        </div>
      ) : null}

      {open && action.kind === 'send' ? (
        <fieldset className="flex flex-col gap-3 p-4" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          <legend className="c-label px-1">{`Message to ${name.full}`}</legend>
          <p className="c-s14 c-t2">{messageBoxNote(name.first)}</p>
          <div className="flex flex-col">
            {MESSAGE_CHOICES.map((choice) => (
              <label key={choice.preset} className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
                <input type="radio" name={groupName} value={choice.preset} checked={preset === choice.preset} disabled={state.sending} onChange={() => setPreset(choice.preset)} />
                {choice.text}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={state.sending || preset === null} onClick={() => void send()}>
              {state.sending ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {state.sending ? 'Sending…' : `Send to ${name.first}`}
            </button>
            <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={state.sending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </fieldset>
      ) : null}
      {state.error !== null ? (
        <Refusal>{state.error}</Refusal>
      ) : null}
    </li>
  );
}

export default function AtRisk() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const privileges = viewerPrivileges(org);
  const may = canSeeAtRisk(privileges);
  // Each answer carries the gym it was asked for, so another gym's people are never drawn.
  const [state, setState] = useState({ gymId: null, error: null, refused: false, list: null });
  const [shown, setShown] = useState(PAGE);
  /** The record whose page is open, from a name. */
  const [personId, setPersonId] = useState(null);
  /** The gym's own columns, for a person's page; read when a name is first pressed. */
  const [columns, setColumns] = useState(null);

  const load = useCallback(() => {
    if (gymId === null || !may) return Promise.resolve();
    return atRiskService.list(gymId).then(
      (list) => setState({ gymId, error: null, refused: false, list }),
      (err) => setState((was) => ({ gymId, error: errorText(err, "We couldn't load this list."), refused: errorStatus(err) === 403, list: was.gymId === gymId ? was.list : null })),
    );
  }, [gymId, may]);

  useEffect(() => {
    load();
  }, [load]);

  const openPerson = (entryId) => {
    setPersonId(entryId);
    if (columns === null && gymId !== null) {
      // Without the columns the person's page still opens, with the standard fields.
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const words = orgWords(org.orgType);
  const readOnly = consoleIsReadOnly(org);
  const mine = state.gymId === gymId ? state : { gymId, error: null, refused: false, list: null };
  const refused = !may || mine.refused;
  const list = mine.list;
  const note = list === null ? null : checkinNote(list, org.name);
  const attendanceTo = placeFor(orgSlug, privileges, 'attendance');
  const mayChange = canManageOrg(privileges);
  const more = list === null ? null : atRiskMore(list);

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">At risk</h1>
        <p className="c-sub">{list !== null ? atRiskIntro(list.settings, org.orgType) : org.name}</p>
      </header>

      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{`Your role doesn't allow you to see ${words.people}. Ask the owner if you need to.`}</p>
        </section>
      ) : list === null ? (
        mine.error !== null ? (
          <ConsoleFailed message={mine.error} onRetry={load} newLook />
        ) : (
          <ConsoleLoading label="Loading this list…" newLook />
        )
      ) : (
        <>
          {mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={load} newLook /> : null}

          {note !== null ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="at-risk-checkin-note">
              <p className="c-s15 c-t2">{note.line}</p>
              {attendanceTo !== null ? (
                <PlaceLink to={attendanceTo}>Open Attendance</PlaceLink>
              ) : (
                <p className="c-s14 c-t3">The owner can check people in from Attendance.</p>
              )}
            </section>
          ) : null}

          {mayChange ? (
            <Numbers
              gymId={gymId}
              settings={list.settings}
              locked={readOnly}
              lockedNote={readOnlyNote(org.orgType)}
              onSaved={() => {
                setShown(PAGE);
                void load();
              }}
            />
          ) : (
            <p className="c-s14 c-t3">The owner can change how many days and weeks this list uses.</p>
          )}

          {note === null || note.showList ? (
            <section className="c-card overflow-hidden" aria-label="Who has stopped coming">
              <p className="px-4 pt-4 pb-3 c-s15 c-w6 c-t1" data-testid="at-risk-headline">
                {atRiskHeadline(list, org.orgType)}
              </p>
              {list.people.length > 0 ? (
                <ul className="list-none m-0 p-0" style={{ borderTop: '1px solid var(--line)' }}>
                  {list.people.slice(0, shown).map((person) => (
                    <Row key={person.entryId ?? person.userId ?? person.name} person={person} org={org} readOnly={readOnly} onOpenPerson={openPerson} onSent={() => void load()} />
                  ))}
                </ul>
              ) : null}
              {list.people.length > shown ? (
                <div className="p-4" style={{ borderTop: '1px solid var(--line)' }}>
                  <button type="button" className="c-btn c-btn-s c-btn-lg w-full md:w-auto" onClick={() => setShown((was) => was + PAGE)}>
                    {`Show ${String(Math.min(PAGE, list.people.length - shown))} more`}
                  </button>
                </div>
              ) : null}
              {more !== null && list.people.length <= shown ? <p className="px-4 py-3 c-s13 c-t3" style={{ borderTop: '1px solid var(--line)' }}>{more}</p> : null}
            </section>
          ) : null}

          <p className="c-s13 c-t3">{AT_RISK_FOOTNOTE}</p>
        </>
      )}

      {personId !== null && gymId !== null ? (
        <MemberListPerson
          key={personId}
          gymId={gymId}
          gym={org}
          entryId={personId}
          list={columns}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => setPersonId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
