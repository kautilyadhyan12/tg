// Which pages another site may show in a frame (`FrameGuard.jsx`).

/** Whether this window is inside another page's frame. A frame we may not ask about is one. */
export function isFramed(win = globalThis) {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** The pages another site may frame: a gym's public page as its embed. */
export function mayBeFramed(pathname, search) {
  return /^\/gyms\/[^/]+\/?$/.test(pathname) && new URLSearchParams(search).get('embed') === '1';
}
