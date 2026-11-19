import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, CalendarDays, CreditCard, LayoutList, Palette, Type } from 'lucide-react';
import '../components/console/console.css';
import { consoleLook } from '../pages/console/consoleMenu';
import { OpenUnder, Question, SidePanel, StepsPage } from '../components/console/ConsoleBoxes';
import SideList from '../components/console/SideList';

/* The second look's building blocks on one page, for the terminal's walks and Kd's
   click-through (V1-b). A development build only: App.jsx adds its address only when
   `import.meta.env.DEV`, so a production build has no such page. The person and the gym
   are made up. Nothing here saves or sends anything. */

const PARTS = [
  { id: 'text', label: 'Text and buttons', icon: Type },
  { id: 'status', label: 'Status words', icon: Palette },
  { id: 'form', label: 'A form', icon: LayoutList },
  { id: 'boxes', label: 'Where boxes open', icon: CalendarDays },
  { id: 'setup', label: 'A page of its own', icon: CreditCard },
];

function Field({ label, hint = null, children }) {
  return (
    <label className="c-field">
      <span className="c-label">{label}</span>
      {children}
      {hint !== null ? <span className="c-hint">{hint}</span> : null}
    </label>
  );
}

function PaymentUnder() {
  const button = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={button} type="button" className="c-btn c-btn-p" onClick={() => setOpen(true)} aria-expanded={open}>
        Record payment
      </button>
      {open ? (
        <OpenUnder anchorRef={button} label="Record payment" onClose={() => setOpen(false)}>
          <h2 className="c-h2">Record payment</h2>
          <Field label="Amount">
            <input className="c-input" inputMode="decimal" defaultValue="49.00" />
          </Field>
          <Field label="Paid by">
            <select className="c-sel">
              <option>Cash</option>
              <option>Card</option>
            </select>
          </Field>
          <div className="c-flow">
            <button type="button" className="c-btn c-btn-p" onClick={() => setOpen(false)}>
              Record payment
            </button>
            <button type="button" className="c-btn c-btn-s" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </OpenUnder>
      ) : null}
    </>
  );
}

function EditPanel() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Maya Patel');
  const [typed, setTyped] = useState('Maya Patel');
  return (
    <>
      <button type="button" className="c-btn c-btn-s" onClick={() => setOpen(true)}>
        Edit details
      </button>
      {open ? (
        <SidePanel
          title="Edit details"
          sub={name}
          unsaved={typed !== name}
          saveLabel="Save changes"
          onSave={() => {
            setName(typed);
            setOpen(false);
          }}
          onClose={() => {
            setTyped(name);
            setOpen(false);
          }}
        >
          <div className="c-form">
            <div className="c-fgroup">
              <h3 className="c-h3">Contact</h3>
              <Field label="Name">
                <input className="c-input" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="c-input" type="email" defaultValue="maya.patel@gmail.com" />
              </Field>
              <div className="c-frow">
                <Field label="Phone">
                  <input className="c-input" type="tel" defaultValue="+1 512 555 0142" />
                </Field>
                <Field label="Member number">
                  <input className="c-input" defaultValue="1" />
                </Field>
              </div>
            </div>
            <div className="c-fgroup">
              <h3 className="c-h3">Details</h3>
              <Field label="Date of birth (optional)" hint="Used for birthday messages.">
                <input className="c-input" defaultValue="12 March 1994" />
              </Field>
              <Field label="Notes">
                <textarea className="c-area" rows={4} defaultValue="" />
              </Field>
            </div>
          </div>
        </SidePanel>
      ) : null}
    </>
  );
}

function CancelQuestion() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(null);
  return (
    <div className="c-stack-xs">
      <div className="c-flow">
        <button type="button" className="c-btn c-btn-d" onClick={() => setOpen(true)}>
          Cancel membership
        </button>
      </div>
      {done !== null ? (
        <p role="status" className="c-s14 c-t2">
          {done}
        </p>
      ) : null}
      {open ? (
        <Question
          title="Cancel Maya Patel's membership?"
          confirmLabel="Cancel membership"
          cancelLabel="Keep membership"
          onConfirm={() => {
            setOpen(false);
            setDone("This sample changes nothing: Maya Patel's membership is as it was.");
          }}
          onCancel={() => setOpen(false)}
        >
          <p className="c-body">Maya Patel's Monthly Unlimited ends today. She won't be charged again.</p>
          <p className="c-s13 c-t3">Nobody else changes.</p>
        </Question>
      ) : null}
    </div>
  );
}

export default function ConsoleKit() {
  const { search } = useLocation();
  const [part, setPart] = useState('text');
  const [kind, setKind] = useState(null);
  const pick = (id) => {
    setPart(id);
    document.getElementById(`kit-${id}`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className={`c-console t-${consoleLook(search, import.meta.env.DEV)}`}>
      <main className="c-page">
        <div className="c-stack-xs">
          <h1 className="c-h1">Building blocks</h1>
          <p className="c-sub">The second look's pieces, on one page. A sample: nothing here is saved.</p>
        </div>
        <SideList title="On this page" items={PARTS} current={part} onPick={pick}>
          <section id="kit-text" className="c-card c-stack" style={{ padding: 24 }}>
            <div className="c-stack-xs">
              <span className="c-s13 c-t3">Page title 32 · box title 18 · words 15 · small print 13 · the number 40</span>
              <span className="c-big c-num">$10,400</span>
              <h2 className="c-h2">Box title</h2>
              <p className="c-body">Words people read, and buttons.</p>
              <p className="c-s13 c-t3">Small print and hints.</p>
            </div>
            <div className="c-flow">
              <button type="button" className="c-btn c-btn-p">
                Record payment
              </button>
              <button type="button" className="c-btn c-btn-soft">
                Invite to app
              </button>
              <button type="button" className="c-btn c-btn-s">
                Edit
              </button>
              <button type="button" className="c-btn c-btn-quiet">
                Cancel
              </button>
            </div>
            <div className="c-flow">
              <button type="button" className="c-btn c-btn-p" disabled>
                Save changes
              </button>
              <span className="c-s13 c-t3">Type an amount first.</span>
            </div>
            <div className="c-flow">
              <button type="button" className="c-btn c-btn-d">
                Cancel membership
              </button>
              <button type="button" className="c-btn c-btn-d c-btn-sm">
                Remove
              </button>
              <button type="button" className="c-btn c-btn-s c-btn-sm">
                Small, in a list
              </button>
            </div>
          </section>

          <section id="kit-status" className="c-card c-stack" style={{ padding: 24 }}>
            <h2 className="c-h2">Status words</h2>
            <div className="c-flow-s">
              <span className="c-tag c-tag-good">Active</span>
              <span className="c-tag c-tag-good">Paid</span>
              <span className="c-tag c-tag-warn">Payment due</span>
              <span className="c-tag c-tag-bad">Overdue</span>
              <span className="c-tag c-tag-info">Frozen</span>
              <span className="c-tag c-tag-plain">Ended</span>
              <span className="c-tag c-tag-line">Not in the app</span>
              <span className="c-tag c-tag-soft">New</span>
            </div>
            <div className="c-callout">
              <Bell aria-hidden="true" className="w-5 h-5" style={{ color: 'var(--warn)' }} />
              <p className="c-body">Maya Patel's card expires this month.</p>
            </div>
            <div className="c-callout c-callout-bad">
              <p className="c-body">Payment failed on 3 Nov.</p>
            </div>
            <div className="c-callout c-callout-info">
              <p className="c-body">Frozen until 1 Dec.</p>
            </div>
            <div className="c-callout c-callout-good">
              <p className="c-body">Paid until 27 Dec.</p>
            </div>
          </section>

          <section id="kit-form" className="c-card c-form" style={{ padding: 24 }}>
            <div className="c-fgroup">
              <h2 className="c-h2">Contact</h2>
              <Field label="Email">
                <input className="c-input" type="email" defaultValue="maya.patel@gmail.com" />
              </Field>
              <div className="c-frow">
                <Field label="Phone">
                  <input className="c-input" type="tel" defaultValue="+1 512 555 0142" />
                </Field>
                <Field label="Member number">
                  <input className="c-input c-input-err" defaultValue="" />
                  <span className="c-err">Enter a member number.</span>
                </Field>
              </div>
            </div>
            <div className="c-fgroup">
              <h2 className="c-h2">Details</h2>
              <Field label="Date of birth (optional)" hint="Used for birthday messages.">
                <input className="c-input" defaultValue="12 March 1994" />
              </Field>
            </div>
          </section>

          <section id="kit-boxes" className="c-card c-stack" style={{ padding: 24 }}>
            <h2 className="c-h2">Where boxes open</h2>
            <div className="c-stack-xs">
              <h3 className="c-h3">Under the button</h3>
              <p className="c-s13 c-t3">One to three questions. On a phone it rises from the bottom.</p>
              <div className="c-flow">
                <PaymentUnder />
              </div>
            </div>
            <div className="c-stack-xs">
              <h3 className="c-h3">From the right</h3>
              <p className="c-s13 c-t3">A form of four fields or more. Change the name, then press X.</p>
              <div className="c-flow">
                <EditPanel />
              </div>
            </div>
            <div className="c-stack-xs">
              <h3 className="c-h3">In the middle</h3>
              <p className="c-s13 c-t3">A question before a change to people or money, naming who changes.</p>
              <CancelQuestion />
            </div>
          </section>

          <section id="kit-setup" className="c-stack">
            <h2 className="c-h2">A page of its own</h2>
            <StepsPage
              summaryTitle="Summary"
              summary={[
                { label: 'Name', value: 'Monthly Unlimited' },
                { label: 'Price', value: '$49.00 a month' },
                { label: 'Kind', value: kind },
              ]}
              parts={[
                {
                  key: 'name',
                  title: 'Name and price',
                  children: (
                    <div className="c-frow">
                      <Field label="Name">
                        <input className="c-input" defaultValue="Monthly Unlimited" />
                      </Field>
                      <Field label="Price">
                        <input className="c-input" defaultValue="49.00" />
                      </Field>
                    </div>
                  ),
                },
                {
                  key: 'kind',
                  title: 'How it is paid',
                  children: (
                    <div className="c-flow-s" role="radiogroup" aria-label="How it is paid">
                      {['Every month', 'Paid once'].map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={kind === k}
                          className={`c-chip ${kind === k ? 'c-chip-on' : ''}`}
                          onClick={() => setKind(k)}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </section>
        </SideList>
      </main>
    </div>
  );
}
