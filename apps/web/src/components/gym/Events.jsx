import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Loader2, MapPin, Users } from 'lucide-react';
import { eventPosterUrl, eventsService } from '../../api/eventsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { eventIsOn, eventPlaces, eventWhen, eventsZoneNote, noEvents } from './eventsView';

// A GYM'S EVENTS FOR ITS MEMBER (spec Part 3 §15.4; ROADMAP 19c-i): the coming events,
// soonest first, each with its poster where the gym added one. The member web's screen
// until the phone app has its own.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';
const GREEN = '#4ade80';

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

function EventCard({ gymId, event, today, readAt }) {
  const places = eventPlaces(event);
  const on = !event.cancelled && eventIsOn(event, readAt);
  return (
    <li className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'rgba(255,255,255,0.03)' }}>
      {event.poster !== null && (
        <img
          src={eventPosterUrl({ gymId, eventId: event.id, posterId: event.poster.id })}
          alt={`Poster for ${event.name}`}
          loading="lazy"
          className="w-full object-contain"
          style={{ background: 'rgba(255,255,255,0.04)', aspectRatio: `${event.poster.width} / ${event.poster.height}`, maxHeight: 420, opacity: event.cancelled ? 0.5 : 1 }}
        />
      )}
      <div className="p-3 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-semibold text-white break-words" style={event.cancelled ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
            {event.name}
          </p>
          {event.cancelled ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(239,68,68,0.15)', color: RED }}>Cancelled</span>
          ) : on ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(74,222,128,0.15)', color: GREEN }}>On now</span>
          ) : null}
        </div>
        <p className="text-sm flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.8)' }}>
          <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} />
          {eventWhen(event, today)}
        </p>
        {event.place !== '' && (
          <p className="text-sm flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <MapPin aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} />
            <span className="break-words min-w-0">{event.place}</span>
          </p>
        )}
        {places !== null && !event.cancelled && (
          <p className="text-sm flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <Users aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} />
            {places}
          </p>
        )}
        {event.details !== '' && (
          <p className="text-sm whitespace-pre-wrap break-words mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>{event.details}</p>
        )}
        {event.cancelled && <p className="text-xs" style={{ color: MUTED }}>This event has been cancelled.</p>}
      </div>
    </li>
  );
}

export default function Events({ gym }) {
  // `readAt`: when the list was read, which is the moment "On now" is true of.
  const [state, setState] = useState({ loading: true, error: null, list: null, readAt: 0 });
  const asked = useRef(0);

  const load = useCallback(() => {
    const mine = ++asked.current;
    eventsService
      .list(gym.id)
      .then((list) => {
        if (mine === asked.current) setState({ loading: false, error: null, list, readAt: Date.now() });
      })
      .catch((err) => {
        if (mine !== asked.current) return;
        // The server's 404 is for anybody who is not a member of this gym.
        const error = errorStatus(err) === 404 ? `${gym.name}'s events aren't available right now.` : errorText(err, "Couldn't load the events.");
        setState({ loading: false, error, list: null, readAt: 0 });
      });
  }, [gym.id, gym.name]);
  useEffect(() => {
    load();
    // Read again when the tab or window is shown again: an event may have ended meanwhile.
    const shown = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      document.removeEventListener('visibilitychange', shown);
      asked.current += 1;
    };
  }, [load]);

  const tryAgain = () => {
    setState({ loading: true, error: null, list: null, readAt: 0 });
    load();
  };

  const list = state.list;
  const note = list === null ? null : eventsZoneNote(list.events, gym.name, list.timezone, deviceZone());

  return (
    <section aria-label={`${gym.name}'s events`} className="flex flex-col gap-3 mt-3">
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <div className="flex flex-col gap-2 items-start">
          <p className="text-sm" style={{ color: RED }}>{state.error}</p>
          <button type="button" onClick={tryAgain} className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11" style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}>
            Try again
          </button>
        </div>
      ) : list.status === 'paused' ? (
        <p className="text-sm" style={{ color: MUTED }}>{`${gym.name}'s events aren't available right now.`}</p>
      ) : list.events.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>{noEvents(gym.name)}</p>
      ) : (
        <>
          {note !== null && <p className="text-xs" style={{ color: ORANGE }}>{note}</p>}
          <ul className="flex flex-col gap-3" aria-label="Coming events">
            {list.events.map((event) => (
              <EventCard key={event.id} gymId={gym.id} event={event} today={list.today} readAt={state.readAt} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
