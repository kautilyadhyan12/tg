import { useLocation } from 'react-router-dom';
import { isFramed, mayBeFramed } from './framing';

// NO PAGE OF OURS INSIDE ANOTHER SITE'S FRAME (ROADMAP 18d-ii, round one): a hostile page could
// show the console, a manager signed in, under its own and steer their clicks onto Remove card
// or Save card. The web host's header (`frame-ancestors 'self'`) is the real stop, once the site
// is online (Stage 4 item 1); a page policy written into the page cannot carry it. Until then,
// and as a second stop after, a page drawn inside another site's frame draws nothing to press.
// A gym's public page as its embed (`?embed=1`, the code a gym pastes on its own site) is the
// one page meant to be framed.

export default function FrameGuard({ children, framed = isFramed() }) {
  const location = useLocation();
  if (!framed || mayBeFramed(location.pathname, location.search)) return children;
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
      <p className="text-sm text-center m-0">
        This page opens in its own tab.{' '}
        <a href={`${location.pathname}${location.search}`} target="_blank" rel="noopener noreferrer" className="text-orange-400 underline">
          Open it
        </a>
      </p>
    </main>
  );
}
