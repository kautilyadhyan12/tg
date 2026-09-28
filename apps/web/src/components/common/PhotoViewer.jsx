import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

// One photo at full size over the page, the whole picture and never cropped, with
// Previous, Next and Close (Esc and the arrow keys too). Used by a gym's public page and
// by the photos in "Your gym page" (ROADMAP 20c-iv-b). `photos` is `[{ key, src, alt }]`.
export default function PhotoViewer({ photos, index, onIndex, onClose }) {
  const count = photos.length;
  const closeRef = useRef(null);
  const photo = photos[index];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && count > 1) onIndex((index + 1) % count);
      if (e.key === 'ArrowLeft' && count > 1) onIndex((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onIndex, onClose]);

  if (photo === undefined) return null;
  const arrow = { background: 'rgba(0,0,0,0.45)' };
  return (
    <div role="dialog" aria-modal="true" aria-label={photo.alt} className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'rgba(12, 11, 10, 0.94)' }}>
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
    </div>
  );
}
