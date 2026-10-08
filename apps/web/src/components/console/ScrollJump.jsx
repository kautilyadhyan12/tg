import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

// Two small round buttons at the bottom right of a long page (Kd, 2026-09-28): Back to top,
// once staff have scrolled down; Go to the bottom, while there is more below. Each shows
// only when it would move the page. `raised` lifts them over the phone's selection bar ('rows' for a bar of two rows).

/** How far from either end before its button shows, in pixels. */
const EDGE = 400;

function where() {
  if (typeof window === 'undefined') return { up: false, down: false };
  const height = document.documentElement.scrollHeight;
  return { up: window.scrollY > EDGE, down: window.scrollY + window.innerHeight < height - EDGE };
}

function jump(top) {
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
}

export default function ScrollJump({ raised = false }) {
  const [at, setAt] = useState(where);
  useEffect(() => {
    const on = () => setAt(where());
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    // The page grows as a list loads; read again when it does.
    const grow = typeof ResizeObserver === 'function' ? new ResizeObserver(on) : null;
    grow?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      grow?.disconnect();
    };
  }, []);
  if (!at.up && !at.down) return null;
  return (
    <div className={`c-jump ${raised === 'rows' ? 'c-jump-raised-rows' : raised ? 'c-jump-raised' : ''}`} data-testid="scroll-jump">
      {at.up ? (
        <button type="button" aria-label="Back to top" title="Back to top" onClick={() => jump(0)} className="c-jump-btn">
          <ArrowUp aria-hidden="true" className="w-5 h-5" />
        </button>
      ) : null}
      {at.down ? (
        <button
          type="button"
          aria-label="Go to the bottom"
          title="Go to the bottom"
          onClick={() => jump(document.documentElement.scrollHeight)}
          className="c-jump-btn"
        >
          <ArrowDown aria-hidden="true" className="w-5 h-5" />
        </button>
      ) : null}
    </div>
  );
}
