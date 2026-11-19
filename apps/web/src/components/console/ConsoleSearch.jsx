import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { readRecent, searchResults, searchStart, writeRecent } from '../../pages/console/searchPlaces';
import { asksForPeople, peopleGroup } from '../../pages/console/searchPeople';
import { gymToday } from '../../pages/console/memberListPeople';
import { errorText, orgService } from '../../api/orgsApi';

// SEARCH (spec Part 3 §17.11, the Search board). The box in the bar across the top IS the
// search: click it and type, and the results drop down under it. Ctrl K (⌘K on a Mac) puts the
// cursor in it. On a phone the search button turns the top bar into the same box. ↑ ↓ move,
// Enter opens, Esc or a press outside closes; each line opens its place as the page's own
// buttons do. `people`: where this person may find people (V1-e-ii), the business and its
// words; null where they may not, and nothing is asked.

/** Why people could not be searched, in a sentence: over the hour's searches, or the usual words. */
function searchRefusal(err) {
  if (err?.response?.status === 429) return "You've searched a lot in the last hour. Try again in a few minutes.";
  return errorText(err, "We couldn't search your people. Try again.");
}

function deviceStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The box and its results. `phone`: drawn in the phone's top bar, open from the start, with a
 *  close button; `onLeave` is told when it closes. `inputRef`: so Ctrl K can reach the box. */
export default function SearchField({ orgSlug, catalogue, placeholder, people = null, keys = null, phone = false, inputRef = null, onLeave = null }) {
  const navigate = useNavigate();
  const listId = useId();
  const ownInput = useRef(null);
  const input = inputRef ?? ownInput;
  const wrap = useRef(null);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(phone);
  const [active, setActive] = useState(0);
  const [dropTop, setDropTop] = useState(null);
  const [room, setRoom] = useState(null);
  /** What the server found, and for which words: a late answer for older words is not shown. */
  const [found, setFound] = useState({ for: '', gymId: null, people: null, error: null });

  const gymId = people?.gymId ?? null;
  const asked = typed.trim();
  // People are asked for after a pause in typing, never for every key.
  useEffect(() => {
    if (gymId === null || !open || !asksForPeople(asked)) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => orgService.searchPeople(gymId, asked))
        .then(
          (res) => live && setFound({ for: asked, gymId, people: res.data, error: null }),
          (err) => live && setFound({ for: asked, gymId, people: null, error: searchRefusal(err) }),
        );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, asked, open]);
  // An answer is for the words AND the business it was asked for: switching business never shows the last one's people.
  const answer = people !== null && open && asksForPeople(asked) && found.for === asked && found.gymId === gymId ? found : null;
  const peopleLines =
    answer === null || answer.people === null
      ? null
      : peopleGroup(answer.people, { orgSlug, orgType: people.orgType, privileges: people.privileges, typed: asked, membersName: people.membersName, today: gymToday(people.timezone) });

  const placeGroups = !open ? [] : typed.trim() === '' ? searchStart(catalogue, readRecent(deviceStore(), orgSlug)) : searchResults(catalogue, typed);
  // People first, as the board draws them: a name typed is most often somebody to open.
  const groups = peopleLines !== null ? [peopleLines, ...placeGroups] : placeGroups;
  const lines = groups.flatMap((g) => g.lines);
  const at = lines.length === 0 ? -1 : Math.min(active, lines.length - 1);
  const optionId = (i) => `${listId}-${String(i)}`;
  // Where each group's lines start in the one list the arrows walk.
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((total, g) => total + g.lines.length, 0));

  const close = () => {
    setOpen(false);
    setTyped('');
    setActive(0);
    input.current?.blur();
    onLeave?.();
  };
  const choose = (line) => {
    // Recent keeps places only, never a person (V1-e-i's ruling: never a name on the device).
    if (line.kind !== 'person') writeRecent(deviceStore(), orgSlug, line.key);
    close();
  };

  // A press anywhere outside the box and its results closes them.
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (wrap.current !== null && !wrap.current.contains(event.target)) closeRef.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  // On a phone the results fill the screen under the top bar.
  useLayoutEffect(() => {
    if (!phone || wrap.current === null) return;
    const bar = wrap.current.closest('.c-topbar') ?? wrap.current;
    setDropTop(Math.round(bar.getBoundingClientRect().bottom));
  }, [phone]);
  useEffect(() => {
    if (phone) input.current?.focus();
  }, [phone, input]);
  // On a computer the results never run past the bottom of the window: they scroll inside the
  // room left under the box (a short window, a laptop zoomed in, a tablet sideways).
  useLayoutEffect(() => {
    if (phone || !open) return undefined;
    const measure = () => {
      if (wrap.current === null) return;
      setRoom(Math.max(160, Math.floor(window.innerHeight - wrap.current.getBoundingClientRect().bottom - 8 - 12)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phone, open]);

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (lines.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (at + step + lines.length) % lines.length;
      setActive(next);
      // The lit line stays in view when the results scroll (a short window, a long list).
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter' && at >= 0) {
      event.preventDefault();
      const line = lines[at];
      choose(line);
      navigate(line.to);
    }
  };

  const showDrop = open && (lines.length > 0 || typed.trim() !== '');
  return (
    // A press anywhere on the box, its magnifying glass too, puts the cursor in it.
    <div
      ref={wrap}
      className={`c-findbar${phone ? ' c-findbar-phone' : ''}${open ? ' c-findbar-open' : ''}`}
      data-testid={phone ? 'console-search-phone-box' : 'console-search'}
      onBlur={(event) => {
        // Tab, or anything else that moves the cursor out of the box and its results, closes them.
        // Not on a phone: an iPhone's Done leaves the box only to put the keyboard away, and the
        // phone's box has its own close button.
        if (phone) return;
        if (open && !(event.relatedTarget instanceof Node && wrap.current?.contains(event.relatedTarget))) close();
      }}
      onMouseDown={(event) => {
        if (event.target === wrap.current || event.target.closest?.('.c-findbar-icon')) {
          event.preventDefault();
          input.current?.focus();
        } else if (event.target.closest?.('.c-find-drop')) {
          // A press on the results keeps the cursor in the box, so the box is not closed by
          // losing it before the press lands (Safari never moves the cursor onto a link).
          event.preventDefault();
        }
      }}
    >
      <Search size={18} aria-hidden="true" className="c-findbar-icon" />
      <input
        ref={input}
        className="c-findbar-input"
        role="combobox"
        aria-label={placeholder}
        aria-expanded={showDrop}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showDrop && at >= 0 ? optionId(at) : undefined}
        placeholder={placeholder}
        value={typed}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTyped(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
        autoComplete="off"
        spellCheck={false}
        data-testid="search-input"
      />
      {phone ? (
        <button type="button" className="c-findbar-close" aria-label="Close search" onClick={close}>
          <X size={20} aria-hidden="true" />
        </button>
      ) : keys !== null && !open ? (
        <kbd className="c-findbar-keys" aria-hidden="true">
          {keys}
        </kbd>
      ) : null}

      {showDrop ? (
        <div className="c-find-drop" style={phone ? (dropTop !== null ? { top: dropTop } : undefined) : room !== null ? { maxHeight: `min(${String(room)}px, 640px)` } : undefined} data-testid="search-box">
          <div id={listId} role="listbox" aria-label="Results" className="c-find-list">
            {groups.map((group, gi) => (
              <div key={group.key} role="group" aria-label={group.label} className="c-find-group">
                <p className="c-eyebrow" aria-hidden="true">
                  {group.label}
                </p>
                {group.lines.map((line, li) => {
                  const mine = starts[gi] + li;
                  return (
                    <Link
                      key={line.key}
                      id={optionId(mine)}
                      to={line.to}
                      role="option"
                      tabIndex={-1}
                      aria-selected={mine === at}
                      className={`c-find-row${mine === at ? ' c-find-on' : ''}`}
                      onMouseMove={() => setActive(mine)}
                      onClick={() => choose(line)}
                      data-testid="search-line"
                    >
                      {line.kind === 'person' ? (
                        <span className="c-find-person">
                          {line.initials !== null ? (
                            <span className="c-avatar c-find-av" aria-hidden="true">
                              {line.initials}
                            </span>
                          ) : null}
                          <span className="c-find-text">
                            <span className="c-s14 c-w6 c-t1">{line.title}</span>
                            {line.where !== '' ? <span className="c-s13 c-t3">{line.where}</span> : null}
                          </span>
                          {line.tag !== null ? <span className={`c-tag ${line.tag.tone}`}>{line.tag.text}</span> : null}
                        </span>
                      ) : (
                        <>
                          <span className="c-s14 c-w6 c-t1">{line.title}</span>
                          {line.where !== '' ? <span className="c-s13 c-t3">{line.where}</span> : null}
                        </>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          {answer !== null && answer.error !== null ? (
            <p className="c-s14 c-t2 m-0" role="status">
              {answer.error}
            </p>
          ) : null}
          {typed.trim() !== '' && lines.length === 0 && (answer === null || answer.error === null) ? (
            <p className="c-s14 c-t2 m-0" role="status">
              Nothing matches &ldquo;{typed.trim()}&rdquo;. Try another word, such as payments or classes.
            </p>
          ) : null}
          <p className="c-find-foot c-s12 c-t3">↑ ↓ to move · Enter to open · Esc to close</p>
        </div>
      ) : null}
    </div>
  );
}
