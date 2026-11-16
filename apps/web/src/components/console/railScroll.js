/** Scrolls `box` the least it can so that `line` is wholly inside it, with `margin` px to
 *  spare: the lit page in the menu's list, when it was opened from somewhere else than the
 *  menu (a button on another page, a link, a reload). A line already in view stays put. */
export function scrollToShow(box, line, margin = 8) {
  if (!box || !line) return;
  const b = box.getBoundingClientRect();
  const l = line.getBoundingClientRect();
  if (l.top < b.top) box.scrollTop -= b.top - l.top + margin;
  else if (l.bottom > b.bottom) box.scrollTop += l.bottom - b.bottom + margin;
}

/** Which of the two scrolls the menu: its list, or (in a short window) the whole menu. */
export function railScroller(rail, nav) {
  if (nav && nav.scrollHeight > nav.clientHeight + 1) return nav;
  return rail ?? null;
}
