// PRINTING ONE RECEIPT (ROADMAP 18g-i): the receipt's own page (`receiptPrintHtml`) goes in a
// frame nobody sees, and that frame is printed, so the paper holds the receipt alone, laid
// out for paper, whatever the console behind it shows. The frame goes once the print window
// has closed.

/** How long a frame whose print window never said it closed is kept, at most. */
const FRAME_KEPT_MS = 60_000;

export function printHtml(html) {
  const doc = globalThis.document;
  if (doc === undefined) return;
  const frame = doc.createElement('iframe');
  frame.setAttribute('title', 'Receipt to print');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  doc.body.appendChild(frame);
  const win = frame.contentWindow;
  if (win === null) {
    frame.remove();
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    frame.remove();
  };
  win.addEventListener('afterprint', remove);
  globalThis.setTimeout(remove, FRAME_KEPT_MS);
  // On the next turn, once the frame has drawn what it was given.
  globalThis.setTimeout(() => {
    win.focus();
    win.print();
  }, 0);
}
