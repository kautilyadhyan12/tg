import { useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { OpenUnder } from './ConsoleBoxes';
import { readRecent, searchResults, searchStart, writeRecent } from '../../pages/console/searchPlaces';

// SEARCH (spec Part 3 §17.11, the Search board): opened from the bar across the top, Ctrl K
// (⌘K on a Mac) or the phone's search button. Results come in groups; ↑ ↓ move, Enter opens,
// Esc closes. Each line opens its place as the page's own buttons do.

function deviceStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The search box in the bar on a computer: it opens search. */
export function SearchBar({ buttonRef, placeholder, keys, onOpen }) {
  return (
    <button ref={buttonRef} type="button" className="c-findbar" aria-haspopup="dialog" onClick={onOpen} data-testid="console-search">
      <Search size={18} aria-hidden="true" />
      <span className="c-findbar-words">{placeholder}</span>
      <kbd className="c-findbar-keys">{keys}</kbd>
    </button>
  );
}

/** The phone's search button, in its top bar. */
export function SearchIcon({ buttonRef, onOpen }) {
  return (
    <button ref={buttonRef} type="button" className="c-bell" aria-label="Search" aria-haspopup="dialog" onClick={onOpen} data-testid="console-search-phone">
      <Search size={20} aria-hidden="true" />
    </button>
  );
}

/** What search shows, opened under its button. `catalogue`: every place this person may open. */
export function SearchBox({ anchorRef, orgSlug, catalogue, placeholder, onClose }) {
  const navigate = useNavigate();
  const listId = useId();
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(0);
  const recent = useMemo(() => readRecent(deviceStore(), orgSlug), [orgSlug]);
  const groups = typed.trim() === '' ? searchStart(catalogue, recent) : searchResults(catalogue, typed);
  const lines = groups.flatMap((g) => g.lines);
  const at = lines.length === 0 ? -1 : Math.min(active, lines.length - 1);
  const optionId = (i) => `${listId}-${String(i)}`;

  const choose = (line) => {
    writeRecent(deviceStore(), orgSlug, line.key);
    onClose();
  };
  const onKey = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (lines.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at + step + lines.length) % lines.length);
    } else if (event.key === 'Enter' && at >= 0) {
      event.preventDefault();
      const line = lines[at];
      choose(line);
      navigate(line.to);
    }
  };

  // Where each group's lines start in the one list the arrows walk.
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((total, g) => total + g.lines.length, 0));
  return (
    <OpenUnder anchorRef={anchorRef} label="Search" onClose={onClose}>
      <div className="c-find" data-testid="search-box">
        <div className="c-search">
          <Search aria-hidden="true" className="w-4 h-4" />
          <input
            data-autofocus
            className="c-input"
            role="combobox"
            aria-label={placeholder}
            aria-expanded={lines.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={at >= 0 ? optionId(at) : undefined}
            placeholder={placeholder}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
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
                    <span className="c-s14 c-w6 c-t1">{line.title}</span>
                    {line.where !== '' ? <span className="c-s13 c-t3">{line.where}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        {typed.trim() !== '' && lines.length === 0 ? (
          <p className="c-s14 c-t2" role="status">
            Nothing matches &ldquo;{typed.trim()}&rdquo;. Try another word, such as payments or classes.
          </p>
        ) : null}
        <p className="c-find-foot c-s12 c-t3">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    </OpenUnder>
  );
}
