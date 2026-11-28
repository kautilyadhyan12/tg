import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

// One photo at full size over the page, the whole picture and never cropped, with
// Previous, Next and Close (Esc and the arrow keys too). Used by a gym's public page and
// by the photos in "Your gym page" (ROADMAP 20c-iv-b). `photos` is `[{ key, src, alt }]`.
// Over a console panel too: its keys are read before the panel's, so Escape closes the photo
// alone and Tab stays among its buttons; the keys go back to the photo pressed when it closes.
export default function PhotoViewer({ photos, index, onIndex, onClose }) {
  const count = photos.length;
  const closeRef = useRef(null);
  const boxRef = useRef(null);
  const photo = photos[index];

  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowRight' && count > 1) onIndex((index + 1) % count);
      if (e.key === 'ArrowLeft' && count > 1) onIndex((index - 1 + count) % count);
      if (e.key === 'Tab' && boxRef.current !== null) {
        e.stopPropagation();
        const all = [...boxRef.current.querySelectorAll('button')];
        const at = all.indexOf(document.activeElement);
        e.preventDefault();
        const next = at === -1 ? (e.shiftKey ? all.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + all.length) % all.length;
        all[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, count, onIndex, onClose]);

  if (photo === undefined) return null;
  const arrow = { background: 'rgba(0,0,0,0.45)' };
  // Drawn on the page's body: a box that is moved into place would otherwise hold it inside itself.
  return createPortal(
    <div ref={boxRef} role="dialog" aria-modal="true" aria-label={photo.alt} className="fixed inset-0 z-[70] flex flex-col" style={{ background: 'rgba(12, 11, 10, 0.94)' }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm">
          {index + 1} of {count}
        </span>
        <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-full">
          <X aria-hidden="true" className="w-6 h-6" />
        </button>
      </div>
      <div className="relative flex-grow min-h-0 flex items-center justify-center px-2 pb-6">
        <img src={photo.src} alt={photo.alt} className="max-w-full max-h-full object-contain" />
        {count > 1 ? (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => onIndex((index - 1 + count) % count)} className="absolute left-2 w-11 h-11 flex items-center justify-center rounded-full text-white" style={arrow}>
              <ChevronLeft aria-hidden="true" className="w-6 h-6" />
            </button>
            <button type="button" aria-label="Next photo" onClick={() => onIndex((index + 1) % count)} className="absolute right-2 w-11 h-11 flex items-center justify-center rounded-full text-white" style={arrow}>
              <ChevronRight aria-hidden="true" className="w-6 h-6" />
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
