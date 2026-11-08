import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Lock, LogOut, Search } from 'lucide-react';
import { adminService, isDoorShut } from '../../api/adminApi';
import { errorText } from '../../api/orgsApi';
import { useAuth } from '../../context/AuthContext';
import { consoleLook } from '../console/consoleMenu';
import { CodeStep, PasswordStep } from './AdminDoor';
import { FEATURES, allowanceWords, confirmWords, dateTimeWords, dateWords, doneWords, openUntilWords, planWords } from './adminView';
import '../../components/console/console.css';

// THE ADMIN PAGE (ROADMAP Stage 2 item 14a-i; Kd, 2026-11-07 and 2026-11-08): Kd's own, on
// the website only. The people using the app, newest first, and their meal scans and route
// plans a day, which he sets for the people he ticks. A plain page in the console's look (Kd:
// "simple style is enough"). Its own door, never a gym's menu: a fresh sign-in code and his own
// password open it for 12 hours (AdminDoor.jsx). Anybody else reads that the page is not there:
// the server answers them "not found" whatever this page does.

const NUMBERS = Array.from({ length: 101 }, (_x, n) => n);

function Tick({ on, label, onToggle }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={onToggle} className={`c-check${on ? ' c-check-on' : ''}`}>
      {on ? <Check size={14} aria-hidden="true" /> : null}
    </button>
  );
}

/** The list, asked once the door is open; a refusal because the door shut sends it back to the door. */
function usePeople(search, onShut) {
  const [state, setState] = useState({ loading: true, error: null, people: [], next: null, more: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    adminService
      .people({ search })
      .then((page) => {
        if (!cancelled) setState({ loading: false, error: null, people: page.people, next: page.next, more: false });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isDoorShut(err)) onShut();
        else setState({ loading: false, error: errorText(err, "We couldn't load the people."), people: [], next: null, more: false });
      });
    return () => {
      cancelled = true;
    };
  }, [search, attempt, onShut]);
  const showMore = async () => {
    if (state.next === null) return;
    setState((s) => ({ ...s, more: true }));
    try {
      const page = await adminService.people({ search, after: state.next });
      setState((s) => ({ ...s, people: [...s.people, ...page.people], next: page.next, more: false }));
    } catch (err) {
      if (isDoorShut(err)) onShut();
      else setState((s) => ({ ...s, more: false, error: errorText(err, "We couldn't load more people.") }));
    }
  };
  return { ...state, reload: () => setAttempt((n) => n + 1), showMore };
}

function People({ onShut }) {
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const list = usePeople(search, onShut);
  const [ticked, setTicked] = useState(() => new Set());
  const [feature, setFeature] = useState('meal_scan');
  const [perDay, setPerDay] = useState(15);
  // The box under the bar: what is about to happen (`ask`), or what did (`done`).
  const [box, setBox] = useState(null);
  const [saving, setSaving] = useState(false);

  // A new search starts again from the top.
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const chosen = useMemo(() => list.people.filter((p) => ticked.has(p.id)), [list.people, ticked]);
  const allOn = list.people.length > 0 && list.people.every((p) => ticked.has(p.id));
  const toggle = useCallback((id) => {
    setBox(null);
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const toggleAll = () => {
    setBox(null);
    setTicked(allOn ? new Set() : new Set(list.people.map((p) => p.id)));
  };

  const ask = (value) => setBox({ kind: 'ask', perDay: value, feature, words: confirmWords(chosen, feature, value) });
  const confirm = async () => {
    if (box?.kind !== 'ask') return;
    setSaving(true);
    try {
      const result = await adminService.setLimits({ userIds: box.words.change.map((p) => p.id), feature: box.feature, perDay: box.perDay });
      setBox({ kind: 'done', text: doneWords({ ...result, unchanged: result.unchanged + box.words.stay.length }, box.feature, box.perDay) });
      setTicked(new Set());
      list.reload();
    } catch (err) {
      if (isDoorShut(err)) onShut();
      setBox({ kind: 'error', text: errorText(err, "That didn't save. Nothing was changed; please try again.") });
    } finally {
      setSaving(false);
    }
  };

  return (
          <>
            <div>
              <h2 className="c-s16 c-w6" style={{ margin: 0 }}>
                People using the app
              </h2>
              <p className="c-hint" style={{ margin: '4px 0 0' }}>
                Newest first. Tick people to set their meal scans or route plans a day.
              </p>
            </div>

            <label className="c-search" style={{ maxWidth: 420 }}>
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search by name or email</span>
              <input
                className="c-input"
                type="search"
                placeholder="Search by name or email"
                value={typed}
                maxLength={100}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setTicked(new Set());
                  setBox(null);
                }}
              />
            </label>

            {chosen.length > 0 ? (
              <section aria-label="Change the ticked people" className="c-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="c-s15 c-w6">{chosen.length === 1 ? '1 person ticked' : `${String(chosen.length)} people ticked`}</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="c-s14 c-t2">Change</span>
                    <select className="c-input" style={{ width: 'auto' }} value={feature} onChange={(e) => { setFeature(e.target.value); setBox(null); }}>
                      <option value="meal_scan">{FEATURES.meal_scan.label}</option>
                      <option value="route_gen">{FEATURES.route_gen.label}</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="c-s14 c-t2">to</span>
                    <select className="c-input" style={{ width: 'auto' }} value={perDay} onChange={(e) => { setPerDay(Number(e.target.value)); setBox(null); }}>
                      {NUMBERS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span className="c-s14 c-t2">a day</span>
                  </label>
                  <button type="button" className="c-btn c-btn-p" onClick={() => ask(perDay)}>
                    Set {FEATURES[feature].words}
                  </button>
                  <button type="button" className="c-btn c-btn-s" onClick={() => ask(null)}>
                    Back to their plan&apos;s number
                  </button>
                  <button type="button" className="c-btn c-btn-quiet" onClick={() => { setTicked(new Set()); setBox(null); }}>
                    Clear ticks
                  </button>
                </div>
                {box?.kind === 'ask' ? (
                  <div role="dialog" aria-label="Check before saving" className="c-banner-info" style={{ padding: 14, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className="c-s15 c-w6">{box.words.change.length === 0 ? 'Nobody to change.' : box.words.question}</span>
                    {box.words.changeLine ? <span className="c-s14">{box.words.changeLine}</span> : null}
                    {box.words.stayLine ? <span className="c-s14 c-t2">{box.words.stayLine}</span> : null}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {box.words.change.length > 0 ? (
                        <button type="button" className="c-btn c-btn-p" disabled={saving} onClick={confirm}>
                          {saving ? 'Saving…' : 'Yes, save'}
                        </button>
                      ) : null}
                      <button type="button" className="c-btn c-btn-s" disabled={saving} onClick={() => setBox(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            {box !== null && box.kind !== 'ask' ? (
              <p role="status" className={`c-s15 c-w6 ${box.kind === 'error' ? 'c-tc-warn' : ''}`} style={{ margin: 0 }}>
                {box.text}
              </p>
            ) : null}

            {list.error ? (
              <div className="c-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="c-s15">{list.error}</span>
                <button type="button" className="c-btn c-btn-s" onClick={list.reload}>
                  Try again
                </button>
              </div>
            ) : null}

            <div className="c-card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="c-th" style={{ textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', width: 22 }}>
                      <Tick on={allOn} label="Tick everybody shown" onToggle={toggleAll} />
                    </th>
                    <th style={{ padding: '12px 8px' }}>Name</th>
                    <th style={{ padding: '12px 8px' }}>Email</th>
                    <th style={{ padding: '12px 8px' }}>Signed up</th>
                    <th style={{ padding: '12px 8px' }}>Last seen</th>
                    <th style={{ padding: '12px 8px' }}>Plan</th>
                    <th style={{ padding: '12px 8px' }}>Meal scans</th>
                    <th style={{ padding: '12px 16px 12px 8px' }}>Route plans</th>
                  </tr>
                </thead>
                <tbody>
                  {list.people.map((p) => (
                    <tr key={p.id} className="c-s14" style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 16px' }}>
                        <Tick on={ticked.has(p.id)} label={`Tick ${p.name || p.email || 'this person'}`} onToggle={() => toggle(p.id)} />
                      </td>
                      <td className="c-w6" style={{ padding: '10px 8px' }}>{p.name}</td>
                      <td style={{ padding: '10px 8px' }}>{p.email ?? 'No email'}</td>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{dateWords(p.signedUpAt)}</td>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{dateTimeWords(p.lastSeenAt)}</td>
                      <td style={{ padding: '10px 8px' }}>{planWords(p)}</td>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{allowanceWords(p.mealScans)}</td>
                      <td style={{ padding: '10px 16px 10px 8px', whiteSpace: 'nowrap' }}>{allowanceWords(p.routePlans)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.loading ? <p className="c-hint" style={{ padding: 16, margin: 0 }}>Loading…</p> : null}
              {!list.loading && !list.error && list.people.length === 0 ? (
                <p className="c-s15" style={{ padding: 16, margin: 0 }}>
                  {search === '' ? 'Nobody has signed up yet.' : `Nobody matches “${search}”.`}
                </p>
              ) : null}
            </div>
            {list.next !== null ? (
              <button type="button" className="c-btn c-btn-s" style={{ alignSelf: 'flex-start' }} disabled={list.more} onClick={list.showMore}>
                {list.more ? 'Loading…' : 'Show more'}
              </button>
            ) : null}
          </>
  );
}

export default function Admin() {
  const { user, logout } = useAuth();
  const { search: address } = useLocation();
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id ?? null;
  // The door's answer for this account and this asking: null while asking, 'none' when this
  // account is not the admin, else the door's state. An answer to an older asking is not shown.
  const key = `${String(userId)}:${String(attempt)}`;
  const [answer, setAnswer] = useState({ key: null, door: null, problem: '' });
  useEffect(() => {
    if (userId === null) return undefined;
    let cancelled = false;
    adminService
      .door()
      .then((state) => {
        if (!cancelled) setAnswer({ key, door: state ?? 'none', problem: '' });
      })
      .catch((err) => {
        if (!cancelled) setAnswer({ key, door: null, problem: errorText(err, "We couldn't reach the server. Please try again.") });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, key]);
  const door = answer.key === key ? answer.door : null;
  const problem = answer.key === key ? answer.problem : '';
  const setDoor = (state) => setAnswer({ key, door: state, problem: '' });
  const readAgain = useCallback(() => setAttempt((n) => n + 1), []);
  const lock = async () => {
    try {
      await adminService.lock();
    } finally {
      readAgain();
    }
  };

  let inside;
  if (userId === null) {
    inside = <CodeStep heading="Admin sign-in" line="We'll email you a sign-in code." />;
  } else if (problem) {
    inside = (
      <div className="c-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', maxWidth: 420 }}>
        <span className="c-s15">{problem}</span>
        <button type="button" className="c-btn c-btn-s" onClick={readAgain}>Try again</button>
      </div>
    );
  } else if (door === null) {
    inside = <p className="c-hint">Loading…</p>;
  } else if (door === 'none') {
    inside = (
      <section className="c-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
        <h2 className="c-s16 c-w6" style={{ margin: 0 }}>This page isn't available</h2>
        <p className="c-s14 c-t2" style={{ margin: 0 }}>You're signed in as {user.email ?? user.displayName}.</p>
        <button type="button" className="c-btn c-btn-s" onClick={() => void logout()}>Sign out</button>
      </section>
    );
  } else if (!door.open && !door.fresh) {
    inside = <CodeStep key={`code-${String(attempt)}`} heading="Sign in again" line="For your safety the admin page asks for a new sign-in code each time." email={user.email ?? ''} onSignedIn={readAgain} />;
  } else if (!door.open) {
    inside = <PasswordStep make={!door.passwordSet} onOpened={(state) => setDoor(state)} onStale={readAgain} />;
  } else {
    inside = <People onShut={readAgain} />;
  }

  return (
    <div className={`c-console t-${consoleLook(address, import.meta.env.DEV)}`}>
      <main className="c-page" style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 className="c-h1" style={{ margin: 0 }}>Admin</h1>
          {door !== null && door !== 'none' && door.open && door.openUntil ? (
            <span className="c-s14 c-t2" data-testid="open-until">Open until {openUntilWords(door.openUntil)}</span>
          ) : null}
          <span style={{ flexGrow: 1 }} />
          {door !== null && door !== 'none' && door.open ? (
            <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={() => void lock()}>
              <Lock size={16} aria-hidden="true" />
              Lock
            </button>
          ) : null}
          {userId !== null ? (
            <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={() => void logout()}>
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          ) : null}
        </div>
        {inside}
      </main>
    </div>
  );
}
