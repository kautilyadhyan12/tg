import { useCallback, useEffect, useState } from 'react';
import { staffEventsService } from '../../api/eventsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { peopleHeading, removeBox } from '../../pages/console/eventsView';
import { ConsoleLoading } from './ConsoleStates';

// WHO IS COMING TO AN EVENT, for staff (ROADMAP 19c-ii; spec Part 3 §15.4): the people
// with a place and the waitlist, first in line first, and Remove on each. Drawn inside
// the event's card on the console's Events page.

function PersonRow({ person, waiting, eventName, canRemove, busy, onAsk }) {
  const name = person.name ?? 'No name yet';
  return (
    <li className="flex items-center justify-between gap-3 min-w-0">
      <span className="c-s14 c-t1 break-words min-w-0">{name}</span>
      {canRemove ? (
        <button type="button" onClick={() => onAsk({ person, waiting })} disabled={busy} className="c-btn c-btn-quiet c-btn-sm flex-shrink-0" aria-label={`Remove ${name} from ${eventName}`}>
          Remove
        </button>
      ) : null}
    </li>
  );
}

/** `canRemove`: the event has not ended and the console can be changed. `onChanged`: a
 *  person was removed, so the event's numbers have changed. */
export default function EventPeople({ gymId, event, canRemove, onChanged }) {
  const [state, setState] = useState({ loading: true, error: null, people: null });
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(
    () =>
      staffEventsService.people(gymId, event.id).then(
        (people) => setState({ loading: false, error: null, people }),
        (err) => setState((s) => ({ loading: false, error: errorText(err, "We couldn't load who is coming."), people: s.people })),
      ),
    [gymId, event.id],
  );
  useEffect(() => {
    load();
    // The numbers on the card changed (somebody said they are coming): read the names again.
  }, [load, event.coming, event.waiting]);

  const remove = async (person) => {
    setBusy(true);
    setActionError(null);
    try {
      const people = await staffEventsService.removePerson(gymId, event.id, person.id);
      setState({ loading: false, error: null, people });
      onChanged();
    } catch (err) {
      setActionError(errorText(err, "We couldn't remove them. Please try again."));
      // Gone or ended somewhere else in the meantime: show what is true now.
      if (errorStatus(err) === 404 || errorStatus(err) === 409) {
        await load();
        onChanged();
      }
    } finally {
      setAsking(null);
      setBusy(false);
    }
  };

  const { people } = state;
  const box = asking === null || people === null ? null : removeBox(asking.person, asking.waiting, event, people);
  const lists =
    people === null
      ? []
      : [
          { key: 'coming', title: peopleHeading('coming', people), rows: people.coming, total: people.comingTotal },
          { key: 'waiting', title: peopleHeading('waiting', people), rows: people.waiting, total: people.waitingTotal },
        ].filter((list) => list.total > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="event-people">
      {state.loading && people === null ? <ConsoleLoading label="Loading who is coming…" newLook /> : null}
      {state.error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {state.error}
        </p>
      ) : null}
      {people !== null && lists.length === 0 ? <p className="c-s14 c-t2">{`Nobody has said they're coming yet.`}</p> : null}
      {lists.map((list) => (
        <section key={list.key} className="flex flex-col gap-2" aria-label={list.title}>
          <h4 className="c-s14 c-w6 c-t1">{list.title}</h4>
          <ul className="flex flex-col gap-1.5">
            {list.rows.map((person) => (
              <PersonRow key={person.id} person={person} waiting={list.key === 'waiting'} eventName={event.name} canRemove={canRemove && box === null} busy={busy} onAsk={setAsking} />
            ))}
          </ul>
          {list.total > list.rows.length ? <p className="c-s13 c-t2">{`and ${(list.total - list.rows.length).toLocaleString('en-GB')} more`}</p> : null}
        </section>
      ))}
      {box !== null ? (
        <div className="c-callout flex-col" role="group" aria-label={box.title}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          {box.lines.map((line) => (
            <p key={line} className="c-s14 c-t1">
              {line}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => remove(asking.person)} disabled={busy} className="c-btn c-btn-danger c-btn-sm">
              {busy ? 'Working…' : box.yes}
            </button>
            <button type="button" onClick={() => setAsking(null)} disabled={busy} className="c-btn c-btn-s c-btn-sm">
              {box.no}
            </button>
          </div>
        </div>
      ) : null}
      {actionError !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
