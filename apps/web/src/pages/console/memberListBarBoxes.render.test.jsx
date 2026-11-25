// The Members bar's boxes in the middle (V3a-ii; spec Part 3 §17.11, the board `Boxes`, way 3).
// The worst thing, first: Escape, pressing outside or the X deleting somebody, or the box
// closing while it is deleting. Then: only the newest box takes Escape, so a member's page
// opened over Invite to app closes alone.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import MemberListDelete from './MemberListDelete';
import { AskSheet, SidePanel } from '../../components/console/ConsoleBoxes';

const words = { person: 'member', people: 'members' };
const DIGEST = 'a'.repeat(64);
const preview = { count: 2, names: ['Bina Das', 'Chitra Menon'], onList: 0, tooMany: false, digest: DIGEST, square: { deletes: 0, stays: 0, shared: 0, notReached: 0 }, squareNames: { deletes: [], stays: [], shared: [], notReached: [] } };

afterEach(cleanup);

function DeleteHost({ press }) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter>
      {open ? <MemberListDelete words={words} load={() => Promise.resolve(preview)} press={press} onSelectionChanged={vi.fn()} onDeleted={vi.fn()} onClose={() => setOpen(false)} /> : <p>Closed</p>}
    </MemoryRouter>
  );
}

describe('Delete permanently from the bar, in the middle', () => {
  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['pressing outside', () => fireEvent.click(screen.getByTestId('box-outside'))],
    ['the X', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ["Don't delete", () => fireEvent.click(screen.getByRole('button', { name: "Don't delete" }))],
  ])('the worst thing: %s closes it and deletes nobody', async (_how, leave) => {
    const press = vi.fn();
    render(<DeleteHost press={press} />);
    expect(await screen.findByText('Delete 2 past members permanently?')).toBeTruthy();
    const box = screen.getByTestId('delete-box');
    expect(box.className.split(' ')).toContain('c-ask');
    expect(box.getAttribute('aria-modal')).toBe('true');
    leave();
    expect(await screen.findByText('Closed')).toBeTruthy();
    expect(press).not.toHaveBeenCalled();
  });

  it("while it is deleting, Don't delete, Escape, outside and the X do not close it, and what happened is said in it", async () => {
    let finish;
    const press = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    render(<DeleteHost press={press} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 2 permanently' }));
    expect(press).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledWith(DIGEST);
    expect(screen.getByRole('button', { name: "Don't delete" }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: "Don't delete" }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('box-outside'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('delete-box')).toBeTruthy();
    finish({ deleted: 2, version: 4 });
    expect((await screen.findByTestId('delete-done')).textContent).toBe('2 past members deleted permanently.');
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('its title, close X and foot are drawn as the third look draws a box in the middle', async () => {
    render(<DeleteHost press={vi.fn()} />);
    await screen.findByText('Delete 2 past members permanently?');
    const box = screen.getByTestId('delete-box');
    expect(box.querySelector('.c-ask-head h2').textContent).toBe('Delete permanently');
    expect(box.querySelector('.c-ask-foot').contains(screen.getByRole('button', { name: 'Delete 2 permanently' }))).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Delete permanently' })).toBe(box);
  });
});

describe('two boxes open at once', () => {
  function Stack() {
    const [middle, setMiddle] = useState(true);
    const [panel, setPanel] = useState(true);
    return (
      <>
        {middle ? (
          <AskSheet title="Invite members to the app" testId="ask" onClose={() => setMiddle(false)} footer={<button type="button">Send</button>}>
            <p>Who gets it</p>
          </AskSheet>
        ) : null}
        {panel ? (
          <SidePanel title="Ada Lovelace" saveLabel={null} onClose={() => setPanel(false)}>
            <p>Their page</p>
          </SidePanel>
        ) : null}
      </>
    );
  }

  it('Escape closes only the newest, then the one under it', async () => {
    render(<Stack />);
    await screen.findByText('Their page');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Their page')).toBeNull());
    expect(screen.getByTestId('ask')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ask')).toBeNull());
  });
});
