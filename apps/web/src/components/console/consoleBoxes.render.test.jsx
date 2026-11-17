// THE FOUR WAYS A BOX OPENS and the side list (V1-b; spec Part 3 §17.10). The worst thing
// first: somebody closes a long form with changes not saved and loses what they typed.
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpenUnder, Question, SidePanel, StepsPage } from './ConsoleBoxes';
import { placeUnder } from './consoleBoxesView';
import SideList from './SideList';

afterEach(cleanup);

function Panel({ onClose = () => {}, onSave = () => {} }) {
  const [typed, setTyped] = useState('Maya Patel');
  return (
    <div className="c-console t-dark">
      <SidePanel title="Edit details" unsaved={typed !== 'Maya Patel'} onClose={onClose} onSave={onSave} saveLabel="Save changes">
        <label>
          Name
          <input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
      </SidePanel>
    </div>
  );
}

describe('from the right: a form never loses what was typed', () => {
  it('X with changes not saved asks first, and keeps the typing until the answer', () => {
    const onClose = vi.fn();
    render(<Panel onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Maya P.' } });
    expect(screen.getByRole('status').textContent).toContain("You have changes that aren't saved.");
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Close without saving?' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('group', { name: 'Close without saving?' })).toBeNull();
    expect(screen.getByLabelText('Name').value).toBe('Maya P.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape with changes not saved asks first too; Close without saving closes', () => {
    const onClose = vi.fn();
    render(<Panel onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Maya P.' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close without saving' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with nothing changed, X closes at once', () => {
    const onClose = vi.fn();
    render(<Panel onClose={onClose} />);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pressing the page behind it closes nothing', () => {
    const onClose = vi.fn();
    const { container } = render(<Panel onClose={onClose} />);
    fireEvent.click(container.querySelector('.c-scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Save sits in the foot that stays, and saves', () => {
    const onSave = vi.fn();
    render(<Panel onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.closest('.c-panel-f')).not.toBeNull();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('is drawn inside the console root, so it keeps the page look', () => {
    const { container } = render(<Panel />);
    expect(container.querySelector('.c-console .c-panel')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit details' }).getAttribute('aria-modal')).toBe('true');
  });

  it('keys go into the panel, stay inside it, and go back to the button after', () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <div className="c-console t-dark">
          <button type="button" onClick={() => setOpen(true)}>
            Edit details
          </button>
          {open ? <SidePanel title="Edit details" onClose={() => setOpen(false)} onSave={() => {}}>
            <input aria-label="Name" />
          </SidePanel> : null}
        </div>
      );
    }
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Edit details' });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole('dialog', { name: 'Edit details' });
    expect(panel.contains(document.activeElement)).toBe(true);
    within(panel).getByRole('button', { name: 'Save' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('in the middle: a question before a change to people or money', () => {
  const ask = (props = {}) =>
    render(
      <div className="c-console t-dark">
        <Question title="Cancel Maya Patel's membership?" confirmLabel="Cancel membership" cancelLabel="Keep membership" onConfirm={() => {}} onCancel={() => {}} {...props}>
          <p>Maya Patel's Monthly Unlimited ends today.</p>
        </Question>
      </div>,
    );

  it('names who changes, and its answer is the only solid red', () => {
    ask();
    const box = screen.getByRole('alertdialog', { name: "Cancel Maya Patel's membership?" });
    expect(document.getElementById(box.getAttribute('aria-describedby')).textContent).toBe("Maya Patel's Monthly Unlimited ends today.");
    expect(within(box).getByRole('button', { name: 'Cancel membership' }).classList.contains('c-btn-ds')).toBe(true);
    expect(within(box).getByRole('button', { name: 'Keep membership' }).classList.contains('c-btn-s')).toBe(true);
  });

  it('the safe answer has the keys first, so Enter changes nobody', () => {
    ask();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep membership' }));
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['pressing outside', () => fireEvent.click(screen.getByTestId('box-outside'))],
    ['the cancel answer', () => fireEvent.click(screen.getByRole('button', { name: 'Keep membership' }))],
  ])('%s changes nothing', (_name, act) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    ask({ onConfirm, onCancel });
    act();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('while it is working, neither answer can be pressed again and Escape does nothing', () => {
    const onCancel = vi.fn();
    ask({ busy: true, onCancel });
    expect(screen.getByRole('button', { name: 'Cancel membership' }).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a question that takes nothing away answers in orange', () => {
    ask({ danger: false });
    expect(screen.getByRole('button', { name: 'Cancel membership' }).classList.contains('c-btn-p')).toBe(true);
  });
});

describe('under its button', () => {
  function Under() {
    const button = useRef(null);
    const [open, setOpen] = useState(false);
    return (
      <div className="c-console t-dark">
        <button ref={button} type="button" onClick={() => setOpen(true)}>
          Record payment
        </button>
        {open ? (
          <OpenUnder anchorRef={button} label="Record payment" onClose={() => setOpen(false)}>
            <input aria-label="Amount" />
          </OpenUnder>
        ) : null}
      </div>
    );
  }

  it('opens with the keys in it; Escape closes it and gives them back to the button', () => {
    render(<Under />);
    const button = screen.getByRole('button', { name: 'Record payment' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(screen.getByLabelText('Amount'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('pressing outside it closes it', () => {
    render(<Under />);
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.click(screen.getByTestId('box-outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('where the box under a button goes, on every width (a table)', () => {
  // A button 40 px tall; the box 300 px tall unless said.
  const at = (left, top, width = 120) => ({ left, top, bottom: top + 40, right: left + width });
  it.each([
    ['a laptop, room below', at(300, 200), 300, { width: 1366, height: 768 }, { left: 300, width: 380, top: 250 }],
    ['a button near the right edge stays on screen', at(1300, 200), 300, { width: 1366, height: 768 }, { left: 970, width: 380 }],
    ['a button at the left edge keeps 16 px', at(4, 200), 300, { width: 1366, height: 768 }, { left: 16 }],
    ['a narrow window is never wider than the screen', at(100, 100), 300, { width: 400, height: 900 }, { width: 368, left: 16 }],
    ['no room below, more above: it opens above', at(300, 600), 300, { width: 1366, height: 768 }, { top: 290 }],
    ['a short window sideways: it scrolls inside', at(300, 160), 500, { width: 844, height: 390 }, { top: 210, maxHeight: 164 }],
  ])('%s', (_name, anchor, height, view, want) => {
    const got = placeUnder(anchor, height, view);
    expect(got).toMatchObject(want);
    expect(got.left).toBeGreaterThanOrEqual(16);
    expect(got.left + got.width).toBeLessThanOrEqual(view.width - 16);
    expect(got.top).toBeGreaterThanOrEqual(16);
  });
});

describe('a page of its own', () => {
  it('numbers its parts and says what is not chosen yet', () => {
    render(
      <StepsPage
        summary={[
          { label: 'Name', value: 'Monthly Unlimited' },
          { label: 'Kind', value: null },
        ]}
        parts={[
          { key: 'a', title: 'Name and price', children: <p>one</p> },
          { key: 'b', title: 'How it is paid', children: <p>two</p> },
        ]}
      />,
    );
    const parts = screen.getAllByRole('region');
    expect(parts).toHaveLength(2);
    expect(parts[1].textContent).toContain('2How it is paid');
    const summary = screen.getByRole('complementary', { name: 'Summary' });
    expect(summary.textContent).toContain('NameMonthly Unlimited');
    expect(summary.textContent).toContain('KindNot set yet');
  });
});

describe('the side list', () => {
  const ITEMS = [
    { id: 'details', label: 'Gym details' },
    { id: 'hours', label: 'When we’re open' },
    { id: 'pay', label: 'Payments', to: '/console/demo/settings#payments' },
  ];

  it('lights the part shown, and a press picks another', () => {
    const onPick = vi.fn();
    render(
      <MemoryRouter>
        <SideList title="Settings" items={ITEMS} current="hours" onPick={onPick}>
          <p>body</p>
        </SideList>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('button', { name: 'When we’re open' }).getAttribute('aria-current')).toBe('true');
    expect(within(nav).getByRole('button', { name: 'Gym details' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: 'Gym details' }));
    expect(onPick).toHaveBeenCalledWith('details');
    expect(within(nav).getByRole('link', { name: 'Payments' }).getAttribute('href')).toBe('/console/demo/settings#payments');
    expect(screen.getByText('body')).not.toBeNull();
  });
});
