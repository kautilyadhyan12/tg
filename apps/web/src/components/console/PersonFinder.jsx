import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { personOption } from '../../pages/console/sellView';
import { Refusal } from '../../pages/console/MemberListTags';
import PlaceLink from './PlaceLink';

// FINDING SOMEBODY ON THE GYM'S LIST BY NAME (Sell's, 18b-i; Match's, 18d-iii-b-ii-a): the register's own
// search (`billing.members`), a name, a member number or an email, and the people it finds as buttons.
// `query`: what the box starts with (Square's name for the customer, on Match). `nobody`: the line where
// nobody on the list matches.
export default function PersonFinder({ gymId, onPick, disabled = false, addMemberTo = null, query: startWith = '', label = 'Find them by name or member number', nobody }) {
  const [query, setQuery] = useState(startWith);
  const [found, setFound] = useState({ for: '', people: null, error: null });
  const searchId = useId();
  const asked = query.trim();

  useEffect(() => {
    if (asked.length < 2) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      registerService.findPeople(gymId, asked).then(
        (people) => live && setFound({ for: asked, people, error: null }),
        (err) => live && setFound({ for: asked, people: null, error: errorText(err, "We couldn't search your list. Try again.") }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, asked]);

  const results = asked.length >= 2 && found.for === asked ? found : null;

  return (
    <div className="flex flex-col gap-2">
      <label className="c-s14 c-t2" htmlFor={searchId}>
        {label}
      </label>
      <div className="c-search">
        <Search aria-hidden="true" className="w-4 h-4" />
        <input id={searchId} className="c-input" value={query} disabled={disabled} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {results !== null && results.error !== null ? <Refusal>{results.error}</Refusal> : null}
      {results !== null && results.people !== null && results.people.length > 0 ? (
        <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="People found">
          {results.people.map((p) => (
            <li key={p.entryId}>
              <button
                type="button"
                className="c-btn c-btn-s w-full justify-start text-left"
                style={{ height: 'auto', minHeight: 44, padding: '8px 14px' }}
                disabled={disabled}
                onClick={() => {
                  onPick(p);
                  setQuery('');
                }}
              >
                {personOption(p)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {results !== null && results.people !== null && results.people.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="c-s14 c-t2 m-0">{nobody}</p>
          {addMemberTo !== null ? (
            <PlaceLink to={addMemberTo} guard>
              Add a member
            </PlaceLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
