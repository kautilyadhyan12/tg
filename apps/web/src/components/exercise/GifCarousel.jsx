import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function GifCarousel({
  gifs = [],
  interval = 3500,
  autoPlay = true,
  playing = true,
  alt = 'exercise demonstration',
  rounded = 'rounded-2xl',
  bg = 'rgba(17,17,27,0.97)',
}) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto]   = useState(autoPlay);
  const timerRef = useRef(null);

  useEffect(() => {
    setIndex(0);
    setAuto(autoPlay);
  }, [gifs.join('|'), autoPlay]);

  useEffect(() => {
    if (!auto || !playing || gifs.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % gifs.length);
    }, interval);
    return () => clearInterval(timerRef.current);
  }, [auto, playing, gifs.length, interval]);

  if (!gifs || gifs.length === 0) return null;

  const goPrev = (e) => {
    e.stopPropagation();
    setAuto(false);
    setIndex((i) => (i - 1 + gifs.length) % gifs.length);
  };

  const goNext = (e) => {
    e.stopPropagation();
    setAuto(false);
    setIndex((i) => (i + 1) % gifs.length);
  };

  return (
    <div
      className={'relative w-full h-full overflow-hidden ' + rounded}
      style={{ background: bg }}
    >
      <img
        src={gifs[index]}
        alt={alt}
        className="w-full h-full object-contain select-none"
        draggable={false}
        style={{ filter: playing ? 'none' : 'grayscale(100%)' }}
      />

      {gifs.length > 1 && (
        <>
          <button
            onClick={goPrev}
            aria-label="Previous GIF"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <ChevronLeft className="w-4 h-4 text-white" />
          </button>

          <button
            onClick={goNext}
            aria-label="Next GIF"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <ChevronRight className="w-4 h-4 text-white" />
          </button>

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {gifs.map((_, i) => (
              <span
                key={i}
                className="rounded-full transition-all"
                style={{
                  width:      i === index ? 18 : 6,
                  height:     6,
                  background: i === index ? '#FF8A1F' : 'rgba(255,255,255,0.35)',
                }}
              />
            ))}
          </div>

          <div
            className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-2xs font-semibold tracking-wider"
            style={{
              background:     auto ? 'rgba(34,197,94,0.18)' : 'rgba(255,138,31,0.18)',
              color:          auto ? '#4ade80' : '#FF8A1F',
              border:         '1px solid ' + (auto ? 'rgba(34,197,94,0.3)' : 'rgba(255,138,31,0.3)'),
              backdropFilter: 'blur(6px)',
            }}
          >
            {auto ? 'AUTO' : 'MANUAL'}
          </div>
        </>
      )}

      {!playing && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <span className="text-white/70 text-sm font-medium">Paused</span>
        </div>
      )}
    </div>
  );
}