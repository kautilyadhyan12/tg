import { AlertTriangle, CheckCircle2, Circle, HelpCircle, Info, Loader2 } from 'lucide-react';
import { SQUARE_APP_WORDS } from '@app/shared';
import ScreenWords from './ScreenWords';
import { labelStyle, lineStyle, softStyle } from './squareChecklistStyles';

// The Square Point of Sale checklist's own pieces (ROADMAP 18d-iii-b-i): each line says whether it is done,
// what it is, and what to do. Used by its box (SquareAppPayments) and by Members in Square's line
// (SquareMembers, 18d-iii-b-ii-b-i).

const W = SQUARE_APP_WORDS;
const ICONS = {
  done: <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--good)' }} aria-hidden="true" />,
  fix: <AlertTriangle className="w-5 h-5" style={{ color: 'var(--warn)' }} aria-hidden="true" />,
  todo: <Circle className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  // Done on each sale, in Square: nothing here can tick it.
  each: <Info className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  unknown: <HelpCircle className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  checking: <Loader2 className="w-5 h-5 animate-spin" style={softStyle} aria-hidden="true" />,
};
// The word that goes with a line's colour.
const STATUS = {
  done: { word: W.done, style: { color: 'var(--good)' } },
  fix: { word: W.needsFixing, style: { color: 'var(--warn)' } },
};

/** One line of the checklist: whether it is done, what it is, and what to do. */
export function Step({ icon, title, children, first = false, testId }) {
  const status = STATUS[icon];
  return (
    <li className="flex gap-3 px-4 py-3" style={first ? undefined : lineStyle} data-testid={testId}>
      <span className="shrink-0 pt-0.5">{ICONS[icon]}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {status ? (
          <span className="text-xs font-semibold" style={status.style}>
            {status.word}
          </span>
        ) : null}
        <span className="text-sm font-semibold" style={{ color: '#fff' }}>
          {title}
        </span>
        {children}
      </div>
    </li>
  );
}

export const Line = ({ children, soft = false }) => (
  <span className="text-sm" style={soft ? softStyle : labelStyle}>
    {children}
  </span>
);
export const Words = ({ text, soft = false }) => <ScreenWords text={text} className="text-sm" style={soft ? softStyle : labelStyle} />;
