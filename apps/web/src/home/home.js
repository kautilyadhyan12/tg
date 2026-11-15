// THE FRONT PAGE'S SCRIPT (ROADMAP Stage 4 item 12a). Everything on the page reads without it: it adds the motion
// (the rooms coming alive, the liquid between them, the look-around) and the menu's smooth jumps.
import clip1 from './img/w1-clip.mp4';
import clip2 from './img/w2-clip.mp4';
import clip3 from './img/w3-clip.mp4';
import clip4 from './img/w4-clip.mp4';
import clip5 from './img/w5-clip.mp4';
import clip6 from './img/w6-clip.mp4';
import clip7 from './img/w7-clip.mp4';
import clip8 from './img/w8-clip.mp4';
import { mayLoadClip, picturesOnly } from './clipRules.js';

const CLIPS = { 1: clip1, 2: clip2, 3: clip3, 4: clip4, 5: clip5, 6: clip6, 7: clip7, 8: clip8 };

(() => {
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  // The computer layout's one condition; the stylesheet's phone layout is its exact negation (`not all and ...`).
  const WIDE = matchMedia('(min-width:821px) and (min-aspect-ratio:3/2) and (min-height:540px)');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (x) => x * x * (3 - 2 * x);
  const navLinks = [...document.querySelectorAll('.top nav a')];
  const cue = document.getElementById('cue'), reps = document.getElementById('reps');

  const S = [...document.querySelectorAll('.scene')].map((el, i) => ({
    el, i, nav: el.dataset.nav, stage: el.querySelector('.stage'), rim: el.querySelector('.rim'), shot: el.querySelector('.shot'),
    world: el.querySelector('.world'), front: el.querySelector('.front'), copy: el.querySelector('.copy'), clip: el.querySelector('.clip'),
    pins: [...el.querySelectorAll('.st')].map((p) => ({ p, at: +p.dataset.at })), top: 0, state: '', since: -1, seenAt: -1, asked: false, live: false, inView: false,
    // each transition has its own set of bubbles: along the liquid's surface, and loose ones rising ahead of it
    foam: Array.from({ length: 10 }, (_, k) => ({ x: (k + 0.5) / 10 + (rnd(i * 31 + k) - 0.5) * 0.05, r: 0.55 + rnd(i * 17 + k * 3) * 0.5, w: 0.7 + rnd(i * 7 + k) * 0.9, ph: rnd(i + k * 13) * 6.28 })),
    loose: Array.from({ length: 9 }, (_, k) => ({ x: 0.04 + rnd(i * 53 + k * 7) * 0.92, r: 0.012 + rnd(i * 11 + k * 5) * 0.03, sp: 0.16 + rnd(i * 3 + k * 19) * 0.2, ph: rnd(i * 29 + k), span: 0.22 + rnd(i * 13 + k * 2) * 0.3 })),
  }));
  function rnd(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  // A link in the bar goes to its scene at the moment the scene is fully there.
  const stopOf = (s) => (s.i === 0 || !WIDE.matches || REDUCE ? s.el.offsetTop : s.el.offsetTop + s.stage.offsetHeight * 0.55);
  document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
    const s = S.find((x) => x.el.id === a.dataset.go); if (!s) return;
    e.preventDefault(); window.scrollTo({ top: s.i === 0 ? 0 : stopOf(s), behavior: REDUCE ? 'auto' : 'smooth' });
  }));

  // THE CLIPS NEVER HOLD THE PAGE UP: the rule is `clipRules.js`. Here, leaving a room before its clip is ready stops
  // that download, leaving after pauses it, and a hidden browser tab pauses everything.
  let LIGHT = true, clipsOK = false;   // nothing downloads until the page has loaded and the rule has been asked
  const allow = () => setTimeout(() => {
    LIGHT = picturesOnly({ reduceMotion: REDUCE, connection: navigator.connection || null, entries: performance.getEntriesByType('resource') });
    clipsOK = true;
  }, 500);
  if (document.readyState === 'complete') allow(); else addEventListener('load', allow, { once: true });
  function want(s, on, time) {
    const c = s.clip; if (!c || REDUCE || (clipsOK && LIGHT)) return;
    if (on) {
      if (s.seenAt < 0) s.seenAt = time;
      if (!mayLoadClip({ pageLoaded: clipsOK, hidden: document.hidden, onScreenFor: time - s.seenAt })) return;
      if (!c.getAttribute('src')) { c.preload = 'auto'; c.src = CLIPS[c.dataset.clip]; c.addEventListener('playing', () => { c.classList.add('playing'); s.live = true; }, { once: true }); }
      if (!s.asked) { s.asked = true; const p = c.play(); if (p && p.catch) p.catch(() => { s.asked = false; }); }
    } else if (s.seenAt >= 0) {
      s.seenAt = -1; s.asked = false;
      if (!c.getAttribute('src')) return;
      if (!s.live) { c.removeAttribute('src'); c.load(); } else c.pause();
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) for (const s of S) if (s.clip && !s.clip.paused) { s.clip.pause(); s.asked = false; } });

  // The menu lights the room being read, in every layout. On the computer layout a room counts once it has half risen
  // over the one before; elsewhere once its top is in the upper third of the screen.
  let active = '';
  function lightNav() {
    const vh = window.innerHeight, rising = WIDE.matches && !REDUCE; let best = S[0].nav;
    for (const s of S) { if (s.i > 0 && s.el.getBoundingClientRect().top <= (rising ? -0.275 * vh : 0.35 * vh)) best = s.nav; }
    if (best !== active) { navLinks.forEach((a) => a.classList.toggle('on', a.dataset.go === best)); active = best; }
  }
  addEventListener('scroll', lightNav, { passive: true });

  // The bar gets out of the way while reading down the page, and comes back the moment the reader scrolls up.
  const bar = document.querySelector('.top'); let lastY = window.scrollY;
  addEventListener('scroll', () => { const y = window.scrollY, d = y - lastY; if (y < 90) { bar.classList.remove('away'); lastY = y; } else if (d > 6) { bar.classList.add('away'); lastY = y; } else if (d < -6) { bar.classList.remove('away'); lastY = y; } }, { passive: true });

  // Reduce motion: everything shown at once and still, but fitted to the screen like any other visit.
  if (REDUCE) {
    S.forEach((s) => s.pins.forEach(({ p }) => p.classList.add('on')));
    addEventListener('resize', measure); addEventListener('load', measure); measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    if (document.fonts) document.fonts.addEventListener('loadingdone', measure);
    return;
  }

  // The liquid with bubbles: everything under the level line, bubbles riding on it, loose bubbles rising above it.
  function liquid(s, q, time, W, H, grow, maxUnit = Infinity) {
    const unit = Math.min(W / 10, maxUnit), rmax = unit * 1.05;
    const lvl = (H + 0.8 * rmax) + (-0.45 * rmax - (H + 0.8 * rmax)) * q - grow;
    let d = 'M-20,' + lvl.toFixed(1) + ' H' + (W + 20) + ' V' + (H + 60) + ' H-20 Z';
    // in a band (a phone), a bubble never passes the band's top: it shrinks away there, as if it popped
    const top = maxUnit < Infinity ? 1 : -Infinity;
    const dot = (cx, cy, r) => { r = Math.min(r, cy - top); if (r > 1) d += ' M' + (cx - r).toFixed(1) + ',' + cy.toFixed(1) + ' a' + r.toFixed(1) + ',' + r.toFixed(1) + ' 0 1,1 ' + (2 * r).toFixed(1) + ',0 a' + r.toFixed(1) + ',' + r.toFixed(1) + ' 0 1,1 ' + (-2 * r).toFixed(1) + ',0 Z'; };
    for (const b of s.foam) { const r = unit * b.r * (1 + 0.07 * Math.sin(time * b.w * 1.7 + b.ph)); dot(b.x * W, lvl + r * 0.28 + 9 * Math.sin(time * b.w + b.ph), r + grow); }
    const live = clamp(q * 5, 0, 1);
    for (const b of s.loose) { const u = (time * b.sp + b.ph) % 1; dot(b.x * W + 14 * Math.sin(time * 1.3 + b.ph * 9), lvl - u * b.span * H * live, (b.r * W * (1 - u * u * u) * live) + (u < 0.97 ? grow * live : 0)); }
    return 'path("' + d + '")';
  }

  // The band each room rises through on a phone (shown by the stylesheet only there).
  for (const s of S) {
    if (s.i === 0) continue;
    s.riseR = document.createElement('div'); s.riseR.className = 'rise rise-rim'; s.riseR.setAttribute('aria-hidden', 'true');
    s.riseF = document.createElement('div'); s.riseF.className = 'rise rise-fill'; s.riseF.setAttribute('aria-hidden', 'true');
    s.stage.prepend(s.riseF); s.stage.prepend(s.riseR);
  }
  document.documentElement.classList.add('rise-on');

  let mx = -999, my = -999, lx = 0, ly = 0, wasWide = null;
  if (FINE) {
    addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; });
    document.documentElement.addEventListener('pointerleave', () => { mx = -999; my = -999; });
  }
  function fit() {
    for (const s of S) { const view = s.el.querySelector('.view'), vw = view.clientWidth, vh = view.clientHeight, wl = s.world.offsetLeft, wt = s.world.offsetTop;
      // stickers and the labels on a drawn screen alike: one that does not fit inside its picture is left out
      for (const p of s.el.querySelectorAll('.st, .tag')) { p.classList.remove('nofit'); if (WIDE.matches) continue; const x = wl + p.offsetLeft, y = wt + p.offsetTop;
        if (x < 8 || y < 8 || x + p.offsetWidth > vw - 8 || y + p.offsetHeight > vh - 8) p.classList.add('nofit'); } }
  }
  function fitHeads() {
    for (const s of S) { const h = s.copy.querySelector('.head'); h.style.fontSize = ''; if (!WIDE.matches) continue;
      const room = s.copy.clientWidth, lines = [...h.children]; let fs = parseFloat(getComputedStyle(h).fontSize), n = 0;
      const wide = () => lines.some((l) => l.getBoundingClientRect().width + fs * 0.14 > room);
      while (n++ < 40 && fs > 30 && wide()) { fs *= 0.96; h.style.fontSize = fs.toFixed(1) + 'px'; } }
  }
  // A short computer screen: each room's words shrink just enough that the last button or question stays on the screen
  // (the stage is one screen tall and cannot be scrolled), never below 70%.
  function fitCopy() {
    if (!WIDE.matches) return;
    const room = window.innerHeight - 10;
    for (const s of S) {
      // The words shrink in place: the box keeps its own top (zooming the box itself would move it up under the bar,
      // round one's re-check H5), and only the space below that top is shared out.
      const top = s.stage.getBoundingClientRect().top, from = s.copy.getBoundingClientRect().top - top; let bottom = 0;
      for (const k of s.copy.children) bottom = Math.max(bottom, k.getBoundingClientRect().bottom - top);
      if (bottom > room) {
        // the first guess can overshoot (shrunk buttons fit more to a row): find the largest size that still fits
        const fits = (z) => { for (const k of s.copy.children) k.style.zoom = z; let b = 0; for (const k of s.copy.children) b = Math.max(b, k.getBoundingClientRect().bottom - top); return b <= room; };
        let lo = Math.max(0.7, (room - from) / (bottom - from)), hi = 1;
        for (let n = 0; n < 6; n++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
        const z = (Math.floor(lo * 1000) / 1000).toFixed(3); for (const k of s.copy.children) k.style.zoom = z;   // rounded down: up could cross a line's wrap
      }
    }
  }
  function measure() {
    for (const s of S) { for (const k of s.copy.children) k.style.zoom = ''; s.copy.style.transform = 'none'; }
    for (const s of S) s.top = s.el.offsetTop;
    fit(); fitHeads(); fitCopy();
    for (const s of S) s.copy.style.transform = '';
    lightNav();
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  // each weight of the text font is its own file and may arrive later: the words are measured again when one does
  if (document.fonts) document.fonts.addEventListener('loadingdone', measure);
  addEventListener('resize', measure); addEventListener('load', measure); measure();

  // Phones: stickers pop and the clip plays while its room is on screen.
  const io = new IntersectionObserver((list) => { for (const en of list) { const s = S.find((x) => x.el === en.target); if (!s) continue; s.inView = en.isIntersecting; if (WIDE.matches) continue; s.pins.forEach(({ p }, k) => setTimeout(() => p.classList.toggle('on', en.isIntersecting), en.isIntersecting ? 250 + k * 180 : 0)); } }, { threshold: 0.25 });
  S.forEach((s) => io.observe(s.el));

  const t0 = performance.now();
  function frame(now) {
    const time = (now - t0) / 1000, big = WIDE.matches;
    if (big !== wasWide) { wasWide = big; measure(); if (!big) for (const s of S) { s.shot.style.clipPath = ''; s.rim.style.display = ''; s.state = ''; s.world.style.transform = ''; s.front.style.transform = ''; s.copy.style.transform = ''; s.copy.style.opacity = ''; } }
    if (big) {
      const y = window.scrollY, H = S[0].stage.offsetHeight, W = S[0].stage.offsetWidth, T = H * 0.55;
      const wantX = mx > -900 ? (mx / W - 0.5) * 2 : 0, wantY = my > -900 ? (my / H - 0.5) * 2 : 0;
      lx += (wantX - lx) * 0.06; ly += (wantY - ly) * 0.06;
      for (const s of S) {
        const next = S[s.i + 1];
        const q = s.i === 0 ? 1 : clamp((y - s.top) / T, 0, 1);              // how far this scene has risen over the one before
        const qn = next ? clamp((y - next.top) / T, 0, 1) : 0;                // how far the next one has risen over this one
        // the liquid edge
        const state = q <= 0 ? 'off' : q >= 1 ? 'full' : 'rise';
        if (state === 'rise') { s.rim.style.display = 'block'; s.rim.style.clipPath = liquid(s, q, time, W, H, 10); s.shot.style.clipPath = liquid(s, q, time, W, H, 0); }
        else if (state !== s.state) { s.rim.style.display = 'none'; s.shot.style.clipPath = state === 'off' ? 'inset(100% 0 0 0)' : 'none'; }
        s.state = state;
        const seen = q > 0 && qn < 0.98;                                 // a room fully covered by the next one stops its clip
        want(s, seen, time);
        if (!seen) { if (q <= 0.2 || qn >= 1) { s.since = -1; s.pins.forEach(({ p }) => p.classList.remove('on')); } continue; }
        // the camera walks in from the moment the scene is fully there until the next one has covered it
        const from = s.top + (s.i === 0 ? 0 : T), to = next ? next.top + T : s.top + H * 1.35;
        const p = clamp((y - from) / Math.max(1, to - from), 0, 1), e = ease(p), last = !next;
        const zoom = s.el.dataset.zoom ? +s.el.dataset.zoom : last ? 0.04 : 0.12;
        s.world.style.transform = 'translate(' + (-lx * 12).toFixed(1) + 'px,' + (-ly * 7).toFixed(1) + 'px) scale(' + (1.035 + zoom * e).toFixed(4) + ')';
        s.front.style.transform = 'translate(' + (-lx * 26).toFixed(1) + 'px,' + (0.028 * H - ly * 14 + e * (last ? 0.04 : 0.16) * H).toFixed(1) + 'px) scale(' + (1.05 + (last ? 0.1 : 0.5) * e).toFixed(4) + ')';
        // the words stay readable until the next scene starts to rise, then lift away with it
        s.copy.style.transform = 'translateY(' + ((1 - ease(q)) * 46 - ease(qn) * 0.16 * H).toFixed(1) + 'px)';
        s.copy.style.opacity = (1 - clamp(qn * 1.5, 0, 1)).toFixed(3);
        if (q >= 0.8 && s.since < 0) s.since = time;
        for (const { p: el, at } of s.pins) el.classList.toggle('on', s.since >= 0 && time - s.since > at);
        if (reps && s.el.id === 'camera') reps.textContent = String(clamp(1 + Math.floor(p * 9), 1, 8)).padStart(2, '0');
      }
      if (cue) cue.style.opacity = y > 30 ? '0' : '1';
    } else {
      // Phones and upright screens: each room's colour rises into the band above it as the scroll brings it in.
      const vh = window.innerHeight, seen = [];
      for (const s of S) {
        want(s, s.inView, time);
        if (!s.riseF) continue;
        const r = s.riseF.getBoundingClientRect();
        if (r.bottom > -20 && r.top < vh + 20) seen.push([s, clamp((vh - r.top) / (vh * 0.45), 0, 1), r.width, r.height]);
      }
      // the liquid never fills its band: a living row of bubbles stays on every border, rising as the room comes in
      for (const [s, q, w, h] of seen) { const k = 0.62 * q; s.riseR.style.clipPath = liquid(s, k, time, w, h, 8, h / 3.2); s.riseF.style.clipPath = liquid(s, k, time, w, h, 0, h / 3.2); }   // bubbles sized to the band, so a wide screen never cuts them flat
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
