import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, ImagePlus, MapPin, Pencil, Plus, Users } from 'lucide-react';
import { eventPosterUrl, staffEventsService } from '../../api/eventsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import TimePick from '../../components/console/TimePick';
import { eventIsOn, eventPlaces, eventWhen } from '../../components/gym/eventsView';
import { DateField, Field, Tick } from './ClassFields';
import { EVENT_LIMITS, EVENT_NOTES, cancelBox, dayAfter, detailsLine, draftOf, eventProblem, fieldsOf, newEventDraft, pastTitle, posterBox, posterProblem, sameAsSent, withStartDay } from './eventsView';
import { preparePostPhoto } from './gymPagePhotos';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';

// The gym's Events, for staff (ROADMAP 19c-i; spec Part 3 §15.4): add an event with its
// day, time, place, places and a poster; edit it; cancel or un-cancel it. `posts.manage`'s;
// the server refuses anyone else whatever this screen shows.

const newKey = () => globalThis.crypto.randomUUID();

/** A time on the gym's clock, in a field of its own. */
function TimeField({ label, value, clockFormat, onChange, disabled }) {
  return (
    <div className="c-field">
      <span className="c-label">{label}</span>
      <TimePick label={label} kind="opens" value={value} clockFormat={clockFormat} onChange={onChange} disabled={disabled} newLook />
    </div>
  );
}

function EventForm({ gymId, event, today, clockFormat, words, onSaved, onClose }) {
  const adding = event === null;
  const [draft, setDraft] = useState(() => (adding ? newEventDraft() : draftOf(event)));
  // One key an event: pressed again after a lost reply, the server answers with the event it kept.
  const [eventKey] = useState(newKey);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);
  const [error, setError] = useState(null);
  const pickerRef = useRef(null);
  const set = (change) => {
    setDraft((d) => ({ ...d, ...change }));
    setProblem(null);
    setError(null);
  };
  const chars = detailsLine(draft.details);
  const title = adding ? 'Add an event' : `Edit ${event.name}`;

  const pickPoster = async (file) => {
    setPreparing(true);
    try {
      const prepared = await preparePostPhoto(file);
      if (draft.poster.kind === 'new') URL.revokeObjectURL?.(draft.poster.preview);
      set({ poster: { kind: 'new', base64: prepared.base64, preview: prepared.preview } });
    } catch (err) {
      setProblem({ field: 'poster', text: posterProblem(err.message) });
    } finally {
      setPreparing(false);
    }
  };
  const removePoster = () => {
    if (draft.poster.kind === 'new') URL.revokeObjectURL?.(draft.poster.preview);
    set({ poster: { kind: 'none' } });
  };

  const save = async () => {
    const wrong = eventProblem(draft);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields = fieldsOf(draft, adding);
      let saved = adding ? await staffEventsService.add(gymId, eventKey, fields) : await staffEventsService.change(gymId, event.id, fields);
      // An earlier press of this form was kept and its reply lost: the server answered
      // with that event, so what the form holds now is sent as a change to it.
      if (adding && !sameAsSent(saved, fields)) saved = await staffEventsService.change(gymId, saved.id, fields);
      if (draft.poster.kind === 'new') URL.revokeObjectURL?.(draft.poster.preview);
      onSaved(saved, adding);
    } catch (err) {
      setError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const posterSrc =
    draft.poster.kind === 'new' ? draft.poster.preview : draft.poster.kind === 'kept' ? eventPosterUrl({ gymId, eventId: event.id, posterId: draft.poster.id }) : null;
  const busy = saving || preparing;

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label={title} data-testid="event-form">
      <h2 className="c-h2">{title}</h2>
      <Field label="Event name">
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} disabled={busy} maxLength={EVENT_LIMITS.name * 2} className="c-input" placeholder="Saturday Open Day" />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <DateField label="Starts on" value={draft.startsOn} min={adding ? today : undefined} max={dayAfter(today, 730)} today={today} onChange={(day) => { setDraft((d) => withStartDay(d, day)); setProblem(null); setError(null); }} disabled={busy} emptyText="Pick a day" />
        <TimeField label="Start time" value={draft.startTime} clockFormat={clockFormat} onChange={(startTime) => set({ startTime })} disabled={busy} />
        <DateField label="Ends on" value={draft.endsOn} min={draft.startsOn === '' ? today : draft.startsOn} max={dayAfter(draft.startsOn === '' ? today : draft.startsOn, EVENT_LIMITS.days)} today={today} onChange={(endsOn) => set({ endsOn })} disabled={busy} emptyText="Pick a day" />
        <TimeField label="End time" value={draft.endTime} clockFormat={clockFormat} onChange={(endTime) => set({ endTime })} disabled={busy} />
      </div>

      <Field label="Place (optional)">
        <input value={draft.place} onChange={(e) => set({ place: e.target.value })} disabled={busy} maxLength={EVENT_LIMITS.place * 2} className="c-input" placeholder="Main hall" />
      </Field>

      <div className="c-field">
        <span className="c-label">Places</span>
        <div className="flex items-center gap-4">
          <input
            value={draft.places}
            onChange={(e) => set({ places: e.target.value })}
            aria-label="Places"
            disabled={busy || draft.unlimited}
            inputMode="numeric"
            className="c-input"
            style={{ width: 104, opacity: draft.unlimited ? 0.5 : 1 }}
          />
          <Tick checked={draft.unlimited} onChange={(on) => set({ unlimited: on })} disabled={busy}>
            No limit
          </Tick>
        </div>
      </div>

      <label className="c-field">
        <span className="c-label">Details (optional)</span>
        <textarea className="c-area" rows={4} value={draft.details} onChange={(e) => set({ details: e.target.value })} disabled={busy} aria-describedby="event-chars" placeholder="What is happening, and what to bring" />
        <span id="event-chars" className="c-hint" style={chars.over ? { color: 'var(--bad)' } : undefined}>
          {chars.text}
        </span>
      </label>

      <div className="c-field">
        <span className="c-label">Poster (optional)</span>
        {posterSrc !== null ? (
          <img src={posterSrc} alt="The event's poster" className="rounded-[10px] object-contain self-start" style={{ maxHeight: 220, maxWidth: '100%', background: 'var(--raise)' }} />
        ) : null}
        <input
          ref={pickerRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          hidden
          aria-label="Choose a poster"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file !== undefined) pickPoster(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => pickerRef.current?.click()} disabled={busy} className="c-btn c-btn-s c-btn-sm">
            <ImagePlus aria-hidden="true" className="w-[18px] h-[18px]" />
            {preparing ? 'Adding…' : posterSrc === null ? 'Add a poster' : 'Change poster'}
          </button>
          {posterSrc !== null ? (
            <button type="button" onClick={removePoster} disabled={busy} className="c-btn c-btn-quiet c-btn-sm">
              Remove poster
            </button>
          ) : null}
        </div>
        <span className="c-hint">{`A picture your ${words.people} see with the event. Where a photo was taken is never kept.`}</span>
      </div>

      {problem !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {problem.text}
        </p>
      ) : null}
      {error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="c-btn c-btn-p">
          {saving ? 'Saving…' : adding ? 'Add event' : 'Save changes'}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="c-btn c-btn-s">
          Close
        </button>
      </div>
      <p className="c-hint">{`Every one of your ${words.people} in the app sees it straight away. Nobody is emailed.`}</p>
    </section>
  );
}

function EventCard({ gymId, event, words, today, past, readAt, readOnly, busy, asking, onEdit, onAsk, onCancel, onUncancel, onRemovePoster }) {
  const places = eventPlaces(event);
  const on = !past && !event.cancelled && eventIsOn(event, readAt);
  const box = !asking ? null : past ? posterBox(event) : cancelBox(event, words, today);
  return (
    <li className="c-card p-4 md:p-5 flex flex-col gap-3" data-testid="event">
      <div className="flex flex-col gap-4 md:flex-row">
        {event.poster !== null ? (
          <img
            src={eventPosterUrl({ gymId, eventId: event.id, posterId: event.poster.id })}
            alt={`Poster for ${event.name}`}
            loading="lazy"
            className="rounded-[10px] object-contain self-start flex-shrink-0"
            style={{ width: 132, maxHeight: 176, background: 'var(--raise)', opacity: event.cancelled ? 0.5 : 1 }}
          />
        ) : null}
        <div className="flex flex-col gap-1.5 min-w-0 flex-grow">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="c-s16 c-w6 c-t1 break-words min-w-0" style={event.cancelled ? { textDecoration: 'line-through' } : undefined}>
              {event.name}
            </h3>
            {event.cancelled ? <span className="c-tag c-tag-bad">Cancelled</span> : on ? <span className="c-tag c-tag-good">On now</span> : null}
          </div>
          <p className="c-s14 c-t1 flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-t3" />
            {eventWhen(event, today)}
          </p>
          {event.place !== '' ? (
            <p className="c-s14 c-t2 flex items-center gap-2">
              <MapPin aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-t3" />
              <span className="break-words min-w-0">{event.place}</span>
            </p>
          ) : null}
          <p className="c-s14 c-t2 flex items-center gap-2">
            <Users aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-t3" />
            {places ?? 'No limit on places'}
          </p>
          {event.details !== '' ? <p className="c-s14 c-t2 whitespace-pre-wrap break-words mt-1">{event.details}</p> : null}
        </div>
      </div>

      {!past && !readOnly && box === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onEdit(event)} disabled={busy} className="c-btn c-btn-s c-btn-sm" aria-label={`Edit ${event.name}`}>
            <Pencil aria-hidden="true" className="w-4 h-4" />
            Edit
          </button>
          {event.cancelled ? (
            <button type="button" onClick={() => onUncancel(event)} disabled={busy} className="c-btn c-btn-s c-btn-sm" aria-label={`Un-cancel ${event.name}`}>
              {busy ? 'Saving…' : 'Un-cancel'}
            </button>
          ) : (
            <button type="button" onClick={() => onAsk(event.id)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm" aria-label={`Cancel ${event.name}`}>
              Cancel event
            </button>
          )}
        </div>
      ) : null}

      {past && !readOnly && event.poster !== null && box === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAsk(event.id)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm" aria-label={`Remove the poster from ${event.name}`}>
            Remove poster
          </button>
        </div>
      ) : null}

      {box !== null ? (
        <div className="c-callout flex-col" role="group" aria-label={box.title}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          {box.lines.map((line) => (
            <p key={line} className="c-s14 c-t1">
              {line}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => (past ? onRemovePoster(event) : onCancel(event))} disabled={busy} className="c-btn c-btn-danger c-btn-sm">
              {busy ? 'Working…' : box.yes}
            </button>
            <button type="button" onClick={() => onAsk(null)} disabled={busy} className="c-btn c-btn-s c-btn-sm">
              {box.no}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function Events() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);

  // `readAt`: when the list was read, which is the moment "On now" is true of.
  const [state, setState] = useState({ loading: true, error: null, refused: false, list: null, readAt: 0 });
  /** The form that is open: `{ id }`, the event's id or null for a new one; null when none is. */
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [asking, setAsking] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(() => {
    if (gymId === null) return Promise.resolve();
    return staffEventsService.list(gymId).then(
      (list) => setState({ loading: false, error: null, refused: false, list, readAt: Date.now() }),
      (err) =>
        setState((s) => ({
          loading: false,
          error: errorText(err, "We couldn't load your events."),
          refused: errorStatus(err) === 403,
          list: s.list,
          readAt: s.readAt,
        })),
    );
  }, [gymId]);

  useEffect(() => {
    load();
    // Read again when the tab or window is shown again: an event may have ended meanwhile.
    const shown = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  }, [load]);

  const setCancelled = async (event, cancelled) => {
    setBusy(event.id);
    setNotice(null);
    setActionError(null);
    try {
      await staffEventsService.setCancelled(gymId, event.id, cancelled);
      setAsking(null);
      setNotice(cancelled ? EVENT_NOTES.cancelled(words) : EVENT_NOTES.uncancelled(words));
      await load();
    } catch (err) {
      setAsking(null);
      setActionError(errorText(err, "We couldn't change that. Please try again."));
      // Ended or changed somewhere else in the meantime: show what is true now.
      if (errorStatus(err) === 404 || errorStatus(err) === 409) await load();
    } finally {
      setBusy(null);
    }
  };

  const removePoster = async (event) => {
    setBusy(event.id);
    setNotice(null);
    setActionError(null);
    try {
      await staffEventsService.change(gymId, event.id, { ...fieldsOf(draftOf(event), false), poster: null });
      setNotice(EVENT_NOTES.posterRemoved);
    } catch (err) {
      setActionError(errorText(err, "We couldn't change that. Please try again."));
    } finally {
      setAsking(null);
      await load();
      setBusy(null);
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

  const list = state.list;
  // An event that has gone from the coming list (it ended) takes its open form with it.
  const formOpen = form !== null && list !== null && (form.id === null || list.coming.some((e) => e.id === form.id));
  const open = (event) => {
    setNotice(null);
    setActionError(null);
    setAsking(null);
    setForm({ id: event === null ? null : event.id });
  };
  const formFor = (event) =>
    formOpen && form.id === (event === null ? null : event.id) ? (
      <EventForm
        key={event === null ? 'new' : event.id}
        gymId={gymId}
        event={event}
        today={list.today}
        clockFormat={org.clockFormat}
        words={words}
        onClose={() => setForm(null)}
        onSaved={(saved, added) => {
          setForm(null);
          setNotice(added ? EVENT_NOTES.added(words) : EVENT_NOTES.saved(words));
          load();
        }}
      />
    ) : null;

  return (
    <div className="c-page">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between min-w-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Events</h1>
          <p className="c-sub">{`What's coming up at ${org.name}, shown to your ${words.people} in their app`}</p>
        </div>
        {!readOnly && !state.refused && list !== null && !formOpen ? (
          <button type="button" onClick={() => open(null)} className="c-btn c-btn-p self-start md:self-auto">
            <Plus aria-hidden="true" className="w-[18px] h-[18px]" />
            Add event
          </button>
        ) : null}
      </header>

      {readOnly && !state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{`${readOnlyNote(org?.orgType)} Your ${words.people} can't see these events until then.`}</p>
        </section>
      ) : null}

      {state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{state.error}</p>
        </section>
      ) : (
        <>
          {formFor(null)}

          {notice !== null ? (
            <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
              {notice}
            </p>
          ) : null}
          {actionError !== null ? (
            <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
              {actionError}
            </p>
          ) : null}

          {state.loading ? <ConsoleLoading label="Loading your events…" newLook /> : null}
          {!state.loading && list === null ? <ConsoleFailed message={state.error} onRetry={load} newLook /> : null}

          {list !== null && list.coming.length === 0 && !formOpen ? (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">{readOnly ? 'No events coming up.' : 'No events coming up. Add your first one with Add event.'}</p>
            </section>
          ) : null}

          {list !== null && list.coming.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Coming events">
              <h2 className="c-s15 c-w6 c-t1">{`Coming events (${list.coming.length})`}</h2>
              <ul className="flex flex-col gap-3">
                {list.coming.map((event) =>
                  formOpen && form.id === event.id ? (
                    <li key={event.id}>{formFor(event)}</li>
                  ) : (
                    <EventCard
                      key={event.id}
                      gymId={gymId}
                      event={event}
                      words={words}
                      today={list.today}
                      past={false}
                      readAt={state.readAt}
                      readOnly={readOnly}
                      busy={busy === event.id}
                      asking={asking === event.id}
                      onEdit={open}
                      onAsk={setAsking}
                      onCancel={(e) => setCancelled(e, true)}
                      onUncancel={(e) => setCancelled(e, false)}
                    />
                  ),
                )}
              </ul>
            </section>
          ) : null}

          {list !== null && list.pastTotal > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Past events">
              <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="c-btn c-btn-s c-btn-sm self-start">
                {showPast ? 'Hide past events' : pastTitle(list)}
              </button>
              {showPast ? (
                <>
                  <p className="c-s13 c-t2">{`Events that have ended. Your ${words.people} no longer see them, and they can't be changed.`}</p>
                  <ul className="flex flex-col gap-3">
                    {list.past.map((event) => (
                      <EventCard
                        key={event.id}
                        gymId={gymId}
                        event={event}
                        words={words}
                        today={list.today}
                        past
                        readAt={state.readAt}
                        readOnly={readOnly}
                        busy={busy === event.id}
                        asking={asking === event.id}
                        onAsk={setAsking}
                        onRemovePoster={removePoster}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
