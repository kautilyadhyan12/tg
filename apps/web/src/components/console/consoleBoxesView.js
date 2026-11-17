const GAP = 10;
const EDGE = 16;

/** Where the box under a button goes on a computer: under it, or above it when there is
 *  more room there, inside the window by 16 px on each side. A phone needs nothing: the
 *  box rises from the bottom (console.css). */
export function placeUnder(anchor, boxHeight, view) {
  const width = Math.min(380, view.width - EDGE * 2);
  const left = Math.min(Math.max(anchor.left, EDGE), view.width - width - EDGE);
  const below = view.height - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  if (boxHeight > below && above > below) {
    const room = Math.max(above, 120);
    return { left, width, top: Math.max(EDGE, anchor.top - GAP - Math.min(boxHeight, room)), maxHeight: room };
  }
  return { left, width, top: anchor.bottom + GAP, maxHeight: Math.max(below, 120) };
}
