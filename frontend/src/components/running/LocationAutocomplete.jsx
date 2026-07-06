import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';

/*
 * LocationAutocomplete — type-ahead place search.
 *
 * Primary provider: LocationIQ (set VITE_LOCATIONIQ_KEY in frontend/.env).
 *   - Free tier: 5,000 req/day, no card, hard-stops with 429 (no surprise bills).
 *   - Results may be stored (their terms allow it), so saving a chosen
 *     location to the backend is fine.
 * Fallback provider: OpenStreetMap / Nominatim (keyless) — used automatically
 *   when no LocationIQ key is configured, or if a LocationIQ call errors/limits.
 *
 * Calls onSelect({ lat, lng, label }) when the user picks a suggestion.
 * Self-contained: only imported by the running planner, so it can't affect
 * any other screen. Requires no backend changes.
 */

const LIQ_KEY = import.meta.env.VITE_LOCATIONIQ_KEY || '';
const ACCENT = '#FF8A1F';
const DEBOUNCE_MS = 350;

async function searchLocationIQ(query, signal) {
  const url =
    `https://api.locationiq.com/v1/autocomplete?key=${LIQ_KEY}` +
    `&q=${encodeURIComponent(query)}&limit=5&dedupe=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`LocationIQ ${res.status}`);
  const data = await res.json();
  return (data || []).map((d) => ({
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
    label: d.display_name,
  }));
}

async function searchNominatim(query, signal) {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=` +
    encodeURIComponent(query);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  return (data || []).map((d) => ({
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
    label: d.display_name,
  }));
}

export default function LocationAutocomplete({ onSelect }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [provider, setProvider] = useState(LIQ_KEY ? 'locationiq' : 'osm');

  const abortRef   = useRef(null);
  const timerRef   = useRef(null);
  const wrapperRef = useRef(null);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Debounced search as the user types.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(runSearch, DEBOUNCE_MS);
    return () => timerRef.current && clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const runSearch = async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      let found = [];
      if (LIQ_KEY) {
        try {
          found = await searchLocationIQ(query, controller.signal);
          setProvider('locationiq');
        } catch (e) {
          if (e.name === 'AbortError') return;
          // LocationIQ failed (limit/error) → fall back to OSM silently.
          found = await searchNominatim(query, controller.signal);
          setProvider('osm');
        }
      } else {
        found = await searchNominatim(query, controller.signal);
        setProvider('osm');
      }
      setResults(found);
      setOpen(found.length > 0);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setResults([]);
        setOpen(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const pick = (r) => {
    onSelect(r);
    setQuery(r.label.split(',').slice(0, 2).join(','));
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
           style={{ background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)' }}>
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search a place, e.g. Rowriah Jorhat"
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: '#fff' }}
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0"
                             style={{ color: ACCENT }} />}
      </div>

      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 rounded-xl overflow-hidden z-30"
             style={{ background: '#1c1a18',
                      border: '1px solid rgba(255,255,255,0.1)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => pick(r)}
              className="w-full flex items-start gap-2 px-3 py-2.5 text-left transition"
              style={{ borderBottom: i < results.length - 1
                        ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {r.label}
              </span>
            </button>
          ))}
          {/* Attribution — required for LocationIQ free tier; harmless for OSM. */}
          <div className="px-3 py-1.5 text-2xs text-right"
               style={{ color: 'rgba(255,255,255,0.25)',
                        borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {provider === 'locationiq'
              ? <>Search by <a href="https://locationiq.com" target="_blank" rel="noreferrer"
                               style={{ color: 'rgba(255,255,255,0.4)' }}>LocationIQ</a></>
              : <>Search by OpenStreetMap</>}
          </div>
        </div>
      )}
    </div>
  );
}
