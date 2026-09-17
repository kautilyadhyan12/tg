// ROADMAP 7a-iv-e — the switch over the macro rings (RULINGS 2026-09-17).
// App's plan · My own. The numbers picked feed the rings, "Remaining today" and
// its "over" rows; "My own" starts from the app's numbers and switching back
// keeps what was typed. "Gym's plan" joins the row at Stage 2 item 10, when a
// gym can write one — an option with nothing behind it is not shown.
//
// The SERVER owns every rule here: which set is in use, whether typed calories
// are allowed (the app's floor, and no cut below what keeps the weight for a
// plan that holds none), and whether stored numbers are on hold because the
// answers under them changed. This file shows what it says and sends what was
// typed; it never decides a number.
import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { holdText, macroKcal } from './ringTargets';

/** The four fields, in the order the rings read them. */
const FIELDS = [
  { key: 'kcal',     label: 'Calories', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein',  unit: 'g' },
  { key: 'carbsG',   label: 'Carbs',    unit: 'g' },
  { key: 'fatG',     label: 'Fat',      unit: 'g' },
];

const asInt = (text) => {
  const n = Number.parseInt(String(text).trim(), 10);
  return String(text).trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** The editor: four numbers, pre-filled with whatever the person is starting
 *  from (their own if they have any, else the app's plan — never a number this
 *  file invented). */
function OwnEditor({ start, onCancel, onSave, saving, refusal }) {
  const [text, setText] = useState(() => ({
    kcal: String(start.kcal), proteinG: String(start.proteinG), carbsG: String(start.carbsG), fatG: String(start.fatG),
  }));
  const values = { kcal: asInt(text.kcal), proteinG: asInt(text.proteinG), carbsG: asInt(text.carbsG), fatG: asInt(text.fatG) };
  const complete = Object.values(values).every((v) => v !== null);

  return (
    <div className="mt-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.80)' }}>My own numbers</p>
        <button type="button" onClick={onCancel} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-xl" style={{ color: 'rgba(255,255,255,0.45)' }}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{f.label}</span>
            <span className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={text[f.key]}
                onChange={(e) => setText({ ...text, [f.key]: e.target.value })}
                aria-label={`${f.label} a day`}
                className="w-24 h-11 px-3 rounded-xl text-base text-right tabular-nums focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
              />
              <span className="text-xs w-8" style={{ color: 'rgba(255,255,255,0.40)' }}>{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {complete
          ? `Your protein, carbs and fat come to ${macroKcal(values)} kcal. They do not have to match your calories.`
          : 'Fill in all four numbers.'}
      </p>
      {refusal !== null && (
        <p className="text-xs mt-2" style={{ color: '#fbbf24' }}>{refusal}</p>
      )}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={!complete || saving}
          onClick={() => onSave(values)}
          className="min-h-11 px-4 rounded-xl text-sm font-semibold"
          style={{
            background: complete && !saving ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${complete && !saving ? 'rgba(255,138,31,0.40)' : 'rgba(255,255,255,0.06)'}`,
            color: complete && !saving ? '#FF8A1F' : 'rgba(255,255,255,0.35)',
          }}
        >
          {saving ? 'Saving…' : 'Use my numbers'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 px-4 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.60)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The switch, the hold line and the editor. `onSave` sends the PUT body and
 *  resolves with nothing, or rejects with the server's own message — which is
 *  shown as it was written, because the server is the one that knows the
 *  number that binds. */
export default function RingNumbers({ source, appTargets, own, ownHeld, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [refusal, setRefusal] = useState(null);

  // A refusal belongs to the attempt that earned it: opening or closing the
  // editor is a new attempt, so it goes with the move.
  const openEditor  = () => { setRefusal(null); setEditing(true); };
  const closeEditor = () => { setRefusal(null); setEditing(false); };

  const usingOwn = source === 'own';
  // What "My own" starts from: the person's own numbers if they have any, else
  // the app's plan. With neither there is nothing to start from and the switch
  // is not offered at all (the rings have no numbers to show either).
  const start = own ?? appTargets;
  if (start === null || start === undefined) return null;

  // `fromEditor` only decides where the answer lands: the editor closes on a
  // save it made, and a refusal is shown wherever the tap came from — a failed
  // switch back to the app's plan must not open an editor nobody asked for.
  const send = async (body, fromEditor) => {
    setSaving(true);
    try {
      await onSave(body);
      setRefusal(null);
      if (fromEditor) setEditing(false);
    } catch (err) {
      const message = err?.response?.data?.message;
      setRefusal(typeof message === 'string' && message !== '' ? message : 'Could not save those numbers.');
    } finally {
      setSaving(false);
    }
  };

  const pick = (wanted) => {
    if (saving) return;
    if (wanted === 'app') { void send({ source: 'app' }, false); return; }
    // Picking "My own" with numbers already stored and nothing holding them
    // puts them straight on the rings; otherwise it opens the editor, so
    // nobody is switched onto numbers they have not seen.
    if (own !== null && own !== undefined && (ownHeld === null || ownHeld === undefined)) {
      void send({ source: 'own', ...own }, false);
      return;
    }
    openEditor();
  };

  const pill = (selected) => ({
    background: selected ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
    border: selected ? '1px solid rgba(255,138,31,0.40)' : '1px solid rgba(255,255,255,0.06)',
    color: selected ? '#FF8A1F' : 'rgba(255,255,255,0.60)',
  });

  const hold = holdText(ownHeld);

  return (
    <div className="mb-4">
      <div className="flex gap-2">
        <button type="button" onClick={() => pick('app')} disabled={saving} aria-pressed={!usingOwn}
                className="flex-1 min-h-11 px-3 py-1.5 rounded-xl text-sm font-semibold leading-tight" style={pill(!usingOwn)}>
          App&apos;s plan
          <br />
          <span className="text-xs" style={{ opacity: 0.7 }}>
            {appTargets ? `${appTargets.kcal} kcal` : 'No number yet'}
          </span>
        </button>
        <button type="button" onClick={() => pick('own')} disabled={saving} aria-pressed={usingOwn}
                className="flex-1 min-h-11 px-3 py-1.5 rounded-xl text-sm font-semibold leading-tight" style={pill(usingOwn)}>
          My own
          <br />
          <span className="text-xs" style={{ opacity: 0.7 }}>
            {own ? `${own.kcal} kcal` : 'Set my own'}
          </span>
        </button>
        {own && (
          <button type="button" onClick={openEditor} aria-label="Edit my own numbers"
                  className="w-11 min-h-11 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.60)' }}>
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>
      {hold !== null && !editing && (
        <p className="text-xs mt-2 leading-relaxed" style={{ color: '#fbbf24' }}>{hold}</p>
      )}
      {refusal !== null && !editing && (
        <p className="text-xs mt-2 leading-relaxed" style={{ color: '#fbbf24' }}>{refusal}</p>
      )}
      {editing && (
        <OwnEditor
          start={start}
          saving={saving}
          refusal={refusal}
          onCancel={closeEditor}
          onSave={(values) => send({ source: 'own', ...values }, true)}
        />
      )}
    </div>
  );
}
