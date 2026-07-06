import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const TransitionContext = createContext(null);

export function TransitionProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const activeRef = useRef(false);
  const timer1Ref = useRef(null);
  const timer2Ref = useRef(null);

  useEffect(() => {
    return () => {
      if (timer1Ref.current) clearTimeout(timer1Ref.current);
      if (timer2Ref.current) clearTimeout(timer2Ref.current);
    };
  }, []);

  const triggerTransition = useCallback((callback) => {
    if (activeRef.current) {
      if (callback) callback();
      return;
    }

    activeRef.current = true;
    setVisible(true);

    if (timer1Ref.current) clearTimeout(timer1Ref.current);
    if (timer2Ref.current) clearTimeout(timer2Ref.current);

    timer1Ref.current = setTimeout(() => {
      if (callback) callback();
    }, 500);

    timer2Ref.current = setTimeout(() => {
      setVisible(false);
      activeRef.current = false;
    }, 1000);
  }, []);

  return (
    <TransitionContext.Provider value={{ triggerTransition }}>
      {children}
      <TransitionOverlay show={visible} />
    </TransitionContext.Provider>
  );
}

function TransitionOverlay({ show }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background:    '#000000',
        opacity:       show ? 1 : 0,
        pointerEvents: show ? 'auto' : 'none',
        transition:    'opacity 0.25s ease',
        willChange:    'opacity',
      }}
    >
      <style>{`
        .robot-glow {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .robot-glow::after {
          content: '';
          position: absolute;
          inset: -80px;
          background: radial-gradient(circle at center, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.04) 30%, transparent 60%);
          pointer-events: none;
          z-index: 0;
        }
        .robot-vid {
          position: relative;
          z-index: 1;
          width:  220px;
          height: 220px;
          object-fit: contain;
          filter: invert(1);
          mix-blend-mode: lighten;
        }
      `}</style>
      <div className="robot-glow">
        <video
          src="/images/loader.webm"
          autoPlay
          loop
          muted
          playsInline
          className="robot-vid"
        />
      </div>
    </div>
  );
}

export function useTransition() {
  const ctx = useContext(TransitionContext);
  if (!ctx) throw new Error('useTransition must be used inside TransitionProvider');
  return ctx;
}