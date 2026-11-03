import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DELETED_FORMS_SEARCH_MAX } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { agreementSignedBy } from '../../pages/console/agreementView';
import {
  deletedFormDeskLine,
  deletedFormKeptLine,
  deletedFormPerson,
  deletedFormSignedLine,
  deletedFormWhat,
  deletedFormsAbout,
  deletedFormsEmptyLine,
  deletedFormsNotOwner,
  deletedFormsShownLine,
  deletedFormsSummary,
} from '../../pages/console/deletedFormsView';
import { noteDay } from '../../pages/console/memberListPeople';
import { useCameBack } from '../../pages/console/useCameBack';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// SIGNED FORMS OF DELETED MEMBERS (ROADMAP 18u-iii; rulings/2026-10-23-18u-i.md). The desk waivers
// and membership agreements of people deleted for good, kept six years as the business's proof,
// for the gym's own owner alone, as the server gates it; anybody else who manages Settings reads
// who can. Nothing here changes or removes a form: the nightly purge ends each one.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const quietButton = { background: 'rgba(255,255,255,0.07)', color: '#fff' };

function Facts({ facts }) {
  return (
    <dl className="m-0 grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'minmax(7rem, max-content) 1fr' }}>
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-sm" style={softStyle}>
            {fact.label}
          </dt>
          <dd className="text-sm m-0" style={{ color: '#fff', overflowWrap: 'anywhere' }}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SignedForm({ gymId, form, when, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    orgService
      .getDeletedForm(gymId, form.kind, form.id)
      .then((res) => {
        if (live) setData(res.data);
      })
      .catch((err) => {
        if (live) setError(errorText(err, "We couldn't open this form."));
      });
    return () => {
      live = false;
    };
  }, [gymId, form.kind, form.id]);

  const desk = data === null ? null : deskLineOf(data);
  return (
    <div role="group" aria-label={`${deletedFormWhat(form)} signed for ${deletedFormPerson(form)}`} className="rounded-xl px-4 py-3 flex flex-col gap-3" style={boxStyle}>
      {error !== null ? (
        <ConsoleFailed message={error} />
      ) : data === null ? (
        <ConsoleLoading label="Opening the form…" />
      ) : (
        <>
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            {agreementSignedBy(data.signed, when)}
          </p>
          {desk !== null ? (
            <p className="text-sm m-0" style={labelStyle}>
              {desk}
            </p>
          ) : null}
          {data.kind === 'agreement' ? <Facts facts={data.signed.facts} /> : null}
          <div
            role="region"
            aria-label={data.kind === 'waiver' ? `${data.gymName}'s waiver, as signed` : `${data.gymName}'s terms, as signed`}
            tabIndex={0}
            className="rounded-xl px-4 py-3 text-sm leading-relaxed max-h-72 overflow-y-auto"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {data.signed.text}
          </div>
          <p className="text-sm m-0" style={softStyle}>
            {deletedFormKeptLine(data, when)}
          </p>
        </>
      )}
      <button type="button" onClick={onClose} className="self-start rounded-xl px-4 py-2.5 text-sm font-semibold min-h-11" style={quietButton}>
        Close
      </button>
    </div>
  );
}

const deskLineOf = (data) => deletedFormDeskLine({ by: data.signed.by, via: data.kind === 'agreement' ? data.signed.via : 'desk' });

export default function DeletedFormsPanel({ org, isOwner, startOpen = false }) {
  const gymId = org.id;
  const searchId = useId();
  const [forms, setForms] = useState(null);
  const [total, setTotal] = useState(0);
  // Where Show more starts: after the last form shown; null on the last page.
  const [next, setNext] = useState(null);
  const [kept, setKept] = useState(null);
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  // The newest read wins: a slower answer to an older search is dropped.
  const readNumber = useRef(0);
  const [timezone, setTimezone] = useState(org.timezone);
  const when = useCallback((iso) => noteDay(iso, timezone), [timezone]);

  const read = useCallback(
    (q, after) => {
      const number = ++readNumber.current;
      return orgService
        .getDeletedForms(gymId, { q, after })
        .then((res) => {
          if (number !== readNumber.current) return;
          setTimezone(res.data.timezone);
          setForms((before) => (after === null || before === null ? res.data.forms : [...before, ...res.data.forms]));
          setTotal(res.data.total);
          setNext(res.data.next);
          setSearched(q);
          setLoadError(null);
          if (q === '') setKept(res.data.total);
        })
        .catch((err) => {
          if (number === readNumber.current) setLoadError(errorText(err, "We couldn't load the signed forms."));
        })
        .finally(() => {
          if (number === readNumber.current) setBusy(false);
        });
    },
    [gymId],
  );

  useEffect(() => {
    if (!isOwner) return undefined;
    void read('', null);
    return () => {
      readNumber.current += 1;
    };
  }, [isOwner, read]);

  // A press says it is working at once; the first read, from the effect, shows Loading instead.
  const press = (q, after) => {
    setBusy(true);
    setLoadError(null);
    void read(q, after);
  };
  // Somebody may have deleted a member for good in another tab: read again on coming back.
  useCameBack(isOwner, () => void read(searched, null));
  const search = (event) => {
    event.preventDefault();
    setOpenId(null);
    press(typed.trim(), null);
  };
  const clear = () => {
    setTyped('');
    setOpenId(null);
    press('', null);
  };

  if (!isOwner) {
    return (
      <ConsoleSection title="Signed forms of deleted members" summary="Owner only" defaultOpen={startOpen}>
        <p className="text-sm m-0" style={labelStyle}>
          {deletedFormsNotOwner(org.name)}
        </p>
      </ConsoleSection>
    );
  }

  const shown = forms === null ? null : deletedFormsShownLine(forms.length, total);
  return (
    <ConsoleSection title="Signed forms of deleted members" summary={deletedFormsSummary(kept)} forceOpen={loadError !== null && forms === null} defaultOpen={startOpen}>
      <p className="text-sm m-0 mb-3" style={labelStyle}>
        {deletedFormsAbout(org.name)}
      </p>
      {forms === null && loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={() => press(searched, null)} />
      ) : forms === null ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <div className="flex flex-col gap-3">
          {kept !== 0 || searched !== '' ? (
            <form onSubmit={search} role="search" className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5 grow" style={{ minWidth: '12rem' }}>
                <label htmlFor={searchId} className="text-sm font-semibold" style={{ color: '#fff' }}>
                  Search by name
                </label>
                <input
                  id={searchId}
                  type="search"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  maxLength={DELETED_FORMS_SEARCH_MAX}
                  placeholder="Name of the member or who signed"
                  className="w-full rounded-xl px-4 py-2.5 text-sm min-h-11"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>
              <button type="submit" disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-semibold min-h-11 disabled:opacity-40" style={quietButton}>
                Search
              </button>
              {searched !== '' ? (
                <button type="button" onClick={clear} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-semibold min-h-11 disabled:opacity-40" style={quietButton}>
                  Clear
                </button>
              ) : null}
            </form>
          ) : null}

          {forms.length === 0 ? (
            <p className="text-sm m-0" style={softStyle}>
              {deletedFormsEmptyLine(searched)}
            </p>
          ) : (
            <ul className="m-0 p-0 flex flex-col gap-2" style={{ listStyle: 'none' }} aria-label="Signed forms">
              {forms.map((form) => {
                const key = `${form.kind}-${form.id}`;
                const open = openId === key;
                return (
                  <li key={key} className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="text-sm font-semibold m-0" style={{ color: '#fff', overflowWrap: 'anywhere' }}>
                          {deletedFormPerson(form)}
                        </p>
                        <p className="text-sm m-0" style={labelStyle}>
                          {deletedFormWhat(form)}. {deletedFormSignedLine(form, when)}
                        </p>
                        <p className="text-sm m-0" style={softStyle}>
                          {deletedFormKeptLine(form, when)}
                        </p>
                      </div>
                      {open ? null : (
                        <button type="button" onClick={() => setOpenId(key)} className="rounded-xl px-4 py-2.5 text-sm font-semibold min-h-11" style={quietButton}>
                          View
                        </button>
                      )}
                    </div>
                    {open ? <SignedForm gymId={gymId} form={form} when={when} onClose={() => setOpenId(null)} /> : null}
                  </li>
                );
              })}
            </ul>
          )}

          {loadError !== null ? <ConsoleFailed message={loadError} /> : null}
          {next !== null ? (
            <div className="flex flex-wrap items-center gap-3">
              {shown !== null ? (
                <span className="text-sm" style={softStyle}>
                  {shown}
                </span>
              ) : null}
              <button type="button" onClick={() => press(searched, next)} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-semibold min-h-11 flex items-center gap-2 disabled:opacity-40" style={quietButton}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Show more
              </button>
            </div>
          ) : null}
        </div>
      )}
    </ConsoleSection>
  );
}
