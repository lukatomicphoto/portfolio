/* Luka Tomić — portfolio
   Everything that moves is a damped spring: position + velocity, integrated every frame.
   Nothing is timed with fixed durations, so any motion can be interrupted at any moment
   and the next one continues from the current position and speed. */
(() => {
'use strict';

const SITE = window.SITE;
if (!SITE) return;

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ───────── Tuning: the feel of the whole site lives here ───────── */
const TUNE = {
  hoverGrow: 1.55,       // hovered column weight = 1 + hoverGrow
  pressure: 0.2,         // how much harder the direct neighbours are squeezed than the far columns
  pressGrow: 0.84,       // while the mouse button is held the column tightens before it lets go
  smooth: 300,           // the target itself eases in (two-stage spring) -> soft start, no snap
  kHover: 150, zHover: 0.64,   // divider stiffness / damping ratio on hover (<1 = overshoot, settles with a bounce)
  kOpen: 115, zOpen: 0.88,     // heavier when a column takes the whole screen
  falloff: 0.8,          // each divider further from the source is softer -> the push travels as a wave
  jellyK: 85, jellyZ: 0.5,     // the photo inside a column is elastic: it lags its frame, squashes and recovers
  zoomHover: 0.055, zoomOpen: 0.06,
  parallax: 0.07,
  depth: 0.028,          // depth parallax: how far the nearest parts travel (fraction of the photo)        // background travel relative to gallery scroll
};

/* ───────── Spring ───────── */
class Spring {
  constructor(x = 0, k = 170, z = 1) { this.x = x; this.v = 0; this.t = x; this.k = k; this.z = z; }
  set(k, z) { this.k = k; if (z != null) this.z = z; return this; }
  snap(x) { this.x = this.t = x; this.v = 0; return this; }
  step(dt) {
    const k = reduced ? this.k * 3 : this.k, z = reduced ? 1 : this.z;
    const c = 2 * z * Math.sqrt(k);
    if (!(dt > 0)) return this.x;
    let n = Math.ceil(dt / 0.004); const h = dt / n;
    while (n--) { this.v += (-k * (this.x - this.t) - c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
  near(eps) { return Math.abs(this.x - this.t) < eps && Math.abs(this.v) < eps * 20; }
}
const springs = [];
const spring = (x, k, z) => { const s = new Spring(x, k, z); springs.push(s); return s; };

// The same spring, baked into a CSS easing so fire-and-forget transitions match the JS physics.
(() => {
  const s = new Spring(0, 130, 0.78); s.t = 1;
  const pts = []; let t = 0;
  while (t < 2.5) { pts.push(s.x); s.step(1 / 60); t += 1 / 60; if (s.near(0.002)) break; }
  pts.push(1);
  if (CSS.supports('transition-timing-function', 'linear(0, 1)')) {
    document.documentElement.style.setProperty('--spring', `linear(${pts.map(p => p.toFixed(3)).join(',')})`);
    document.documentElement.style.setProperty('--spring-dur', t.toFixed(2) + 's');
  }
})();

/* ───────── DOM ───────── */
const root = document.documentElement;
const stage = $('#stage'), info = $('#info'), gal = $('#gallery'), grid = $('#grid');
const galMeta = $('#galMeta'), galNext = $('#galNext'), mark = $('#mark'), back = $('#back');
const cats = SITE.categories.filter(c => c.cover);
const N = cats.length;
const PATHS = location.protocol.startsWith('http'); // real URLs (/sport/) online, #sport when opened as a file


const panels = cats.map((c, i) => {
  const a = el('a', 'panel');
  a.href = PATHS ? `/${c.slug}/` : '#' + c.slug; a.draggable = false;
  a.setAttribute('aria-label', `${c.title} — ${c.photos.length} photographs`);
  a.style.zIndex = i + 1;
  const imgWrap = el('div', 'panel-img');
  const img = new Image(); img.alt = c.cover.alt || `${c.title} photography by ${SITE.name}`; img.draggable = false; img.decoding = 'async';
  img.src = c.cover.small && Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2) < 1700 ? c.cover.small : c.cover.src;
  imgWrap.append(img);
  const dim = el('div', 'panel-dim'), scrim = el('div', 'panel-scrim');
  const wrap = el('div', 'panel-labelwrap');
  const label = el('div', 'panel-label', `<span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="ttl">${esc(c.title)}</span>`);
  wrap.append(label);
  a.append(imgWrap, dim, scrim, wrap);
  stage.append(a);
  return {
    a, img, imgWrap, dim, scrim, wrap, label, ttl: label.lastChild, focus: c.focus ?? 0.5,
    hv: spring(0, 120, 1), op: spring(0, 90, 1), intro: spring(1, 80, 0.9), cache: {},
    lagC: spring(0, TUNE.jellyK, TUNE.jellyZ), lagS: spring(1, TUNE.jellyK, TUNE.jellyZ), aspect: c.cover.w / c.cover.h,
  };
});

// Info panel content
(() => {
  const rows = [];
  if (SITE.email) rows.push(['Mail', `<a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>`]);
  if (SITE.instagram) { const h = SITE.instagram.replace(/^@/, ''); rows.push(['Instagram', `<a href="https://instagram.com/${esc(h)}" target="_blank" rel="noopener">@${esc(h)}</a>`]); }
  if (SITE.phone) rows.push(['Phone', `<a href="tel:${esc(SITE.phone.replace(/\s/g, ''))}">${esc(SITE.phone)}</a>`]);
  if (SITE.location) rows.push(['Based', esc(SITE.location)]);
  const parts = [];
  if (SITE.portrait) parts.push(`<img class="portrait" src="${esc(SITE.portrait.src)}" alt="Portrait of ${esc(SITE.name)}">`);
  parts.push(`<p class="role">${esc(SITE.role || '')}</p>`);
  if (SITE.about) parts.push(`<p class="about">${esc(SITE.about)}</p>`);
  if (rows.length) parts.push(`<dl>${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>`);
  if (SITE.clients?.length) parts.push(`<p class="clients"><b>Selected clients</b>${SITE.clients.map(esc).join(' · ')}</p>`);
  info.innerHTML = parts.join('');
  [...info.children].forEach((c, i) => c.style.setProperty('--i', i));
})();

/* ───────── State ───────── */
let W = 0, H = 0, L = 0, axisX = true;
let state = 'intro';            // intro | home | opening | open | closing
let active = -1, source = 0, kbHover = -1;
let pressing = false, pressIdx = -1, explored = false, pressAt = [0, 0];
let infoOpen = false, infoSize = 0, infoLeaveAt = 0;
let openedAt = 0, closedAt = 0, pendingBuild = -1, built = -1;
let galY = 0, wheelPos = null, wheelTarget = 0;
let items = [], photos = [], cells = [];
const ptr = { x: -1, y: -1, inside: false, type: 'mouse', onStage: false, onPhoto: false, onUI: false };

const TS = Array.from({ length: N }, () => spring(0, TUNE.smooth, 1));            // eased targets
const B = Array.from({ length: N }, () => spring(0, TUNE.kHover, TUNE.zHover)); // B[0] = left origin, B[1..] = dividers
const warp = spring(0, 60, 1);
const parX = spring(0, 55, 1), parY = spring(0, 55, 1);
const infoLag = spring(0, 190, 0.66);   // contact content trails the column edge, then catches up
const infoHv = spring(0, 90, 1);
const GLS = window.createStageGL ? window.createStageGL($('#gl'), N) : null;
if (GLS) root.classList.add('has-gl');
const GU = GLS && { B: new Float32Array(N + 1), Q: new Float32Array(N), lag: new Float32Array(N), A: new Float32Array(N), F: new Float32Array(N),
  hv: new Float32Array(N), op: new Float32Array(N), intro: new Float32Array(N), zoom: new Float32Array(N), lod: new Float32Array(N) };
const anyHover = spring(0, 90, 1);
const press = spring(0, 520, 0.55);
const shift = spring(0, 380, 1);
const flat = spring(0, 160, 1);
const nx = spring(0.5, 120, 1);

const coord = () => (axisX ? ptr.x : ptr.y);
function idxAt(v) {
  if (v < B[0].x) return -1;
  for (let i = N - 1; i >= 0; i--) if (v >= B[i].x) return i;
  return -1;
}
function hoverIdx() {
  if (state !== 'home') return -1;
  if (kbHover >= 0) return kbHover;
  if (ptr.type === 'mouse') return ptr.inside && ptr.onStage && !infoOpen ? idxAt(coord()) : -1;
  return pressing ? idxAt(coord()) : -1;
}

function measure(snap) {
  W = innerWidth; H = innerHeight;
  axisX = W >= 720 && W > H * 0.9;
  L = axisX ? W : H;
  root.classList.toggle('rows', !axisX);
  infoSize = axisX ? clamp(W * 0.34, 320, 440) : Math.min(H * 0.68, 540);
  root.style.setProperty('--info', infoSize + 'px');
  if (GLS) GLS.resize(W, H);
  if (snap) {
    setTargets(-1);
    TS.forEach((s, i) => { s.snap(s.t); B[i].snap(s.t); });
    panels.forEach((p, i) => { const e = i < N - 1 ? B[i + 1].x : L; p.lagC.snap((B[i].x + e) / 2); p.lagS.snap(Math.max(1, e - B[i].x)); });
  }
  if (built >= 0) layoutGrid();
}

function setTargets(h) {
  if (active >= 0) {
    for (let i = 0; i < N; i++) {
      const d = i <= active ? active - i : i - active - 1;
      TS[i].t = i <= active ? 0 : L;
      B[i].set(TUNE.kOpen * Math.pow(TUNE.falloff, d), TUNE.zOpen);
    }
    return;
  }
  if (h >= 0) source = h;
  const o = infoOpen ? infoSize : 0;
  const touch = ptr.type !== 'mouse' && kbHover < 0;
  const grow = TUNE.hoverGrow * (touch ? 1.3 : 1) * (pressing && !touch ? TUNE.pressGrow : 1);
  // pressure: the columns right next to the growing one give way the most
  const wt = j => (h < 0 ? 1 : j === h ? 1 + grow : 1 - TUNE.pressure * Math.pow(0.5, Math.abs(j - h) - 1));
  let sum = 0; for (let j = 0; j < N; j++) sum += wt(j);
  TS[0].t = o; B[0].set(140, 0.8);
  let cum = 0;
  for (let i = 1; i < N; i++) {
    cum += wt(i - 1);
    const d = i <= source ? source - i : i - source - 1;
    TS[i].t = o + (L - o) * cum / sum;
    B[i].set(TUNE.kHover * Math.pow(TUNE.falloff, d), TUNE.zHover);
  }
}

/* ───────── Open / close / routing ───────── */
function openCat(i) {
  if (i === active && state !== 'closing') return;
  setInfo(false);
  if (LB.on) LB.close(true);
  active = i; source = i; state = 'opening'; openedAt = performance.now();
  kbHover = -1; pressing = false;
  document.body.classList.add('is-open');
  stage.inert = true;
  if (gal.classList.contains('on')) { gal.classList.remove('on'); gal.inert = true; pendingBuild = i; }
  else { buildGallery(i); pendingBuild = -1; }
}
function closeCat() {
  if (active < 0 || state === 'closing') return;
  if (LB.on) LB.close(true);
  state = 'closing'; closedAt = performance.now();
  gal.classList.remove('on'); gal.inert = true;
  stage.inert = false;
  document.body.classList.remove('is-open');
  wheelPos = null;
}
function currentSlug() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h && cats.some(c => c.slug === h)) return h;
  return PATHS ? decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] || '') : '';
}
function route() {
  const slug = currentSlug();
  const i = cats.findIndex(c => c.slug === slug);
  if (PATHS && location.hash && i >= 0) history.replaceState(null, '', `/${slug}/`); // old #sport links keep working
  document.title = i >= 0 ? cats[i].pageTitle || `${cats[i].title} — ${SITE.name}` : SITE.pageTitle || document.title;
  if (i >= 0) openCat(i); else closeCat();
}
function go(slug) {
  if (slug !== currentSlug()) history.pushState(null, '', PATHS ? (slug ? `/${slug}/` : '/') : (slug ? '#' + slug : location.pathname + location.search));
  route();
}
addEventListener('popstate', route);
addEventListener('hashchange', route);

function setInfo(v) {
  if (v === infoOpen) return;
  if (v && state !== 'home') return;
  infoOpen = v;
  mark.setAttribute('aria-expanded', v);
  if (v) info.classList.add('on');
}

/* ───────── Gallery: justified rows computed from each photo's shape ───────── */
function buildGallery(i) {
  const c = cats[i];
  built = i; photos = c.photos; items = []; cells = [];
  grid.textContent = '';
  let n = 0;
  (c.items || c.photos).forEach(p => {
    let node;
    if (p.text) {
      node = el('div', 'ph ph-text', `<h2>${esc(p.title)}</h2>${p.note ? `<p>${esc(p.note)}</p>` : ''}`);
    } else {
      const k = n++;
      node = el('button', 'ph'); node.type = 'button';
      node.setAttribute('aria-label', `${p.alt || c.title}, photograph ${k + 1} of ${photos.length} — open fullscreen`);
      const im = new Image(); im.alt = p.alt || ''; im.loading = 'lazy'; im.decoding = 'async'; im.draggable = false; im.src = p.thumb || p.src;
      node.append(im);
      node.addEventListener('click', () => LB.open(k));
      items.push(node);
    }
    grid.append(node);
    cells.push({ node, p });
  });
  galMeta.innerHTML = `<span>${esc(c.title)}</span><span>${String(photos.length).padStart(2, '0')} frames</span>`;
  const nxt = cats[(i + 1) % N];
  galNext.innerHTML = `<small>Next</small><strong>${esc(nxt.title)}</strong>`;
  galNext.onclick = () => go(nxt.slug);
  gal.scrollTop = 0; galY = 0; wheelPos = null;
  layoutGrid();
}

function layoutGrid() {
  const width = grid.clientWidth;
  if (!width || !cells.length) return;
  const gap = axisX ? 10 : 6;
  const target = axisX ? clamp(H * 0.44, 220, 480) : clamp(W * 0.62, 150, 300);
  // a text tile takes one cell of the grid on wide screens and a full-width strip on phones
  const ratio = c => (c.p.text ? (axisX ? 0.8 : width / 150) : c.p.w / c.p.h);
  let row = [], ar = 0, y = 0;
  const commit = (h, stretch) => {
    let x = 0;
    row.forEach((c, j) => {
      const w = h * ratio(c);
      const s = c.node.style;
      s.left = x + 'px'; s.top = y + 'px';
      s.width = (stretch && j === row.length - 1 ? width - x : w) + 'px'; s.height = h + 'px';
      s.setProperty('--d', j * 70 + 'ms');
      x += w + gap;
    });
    y += h + gap; row = []; ar = 0;
  };
  cells.forEach(c => {
    row.push(c); ar += ratio(c);
    const h = (width - gap * (row.length - 1)) / ar;
    if (h <= target) commit(h, true);
  });
  if (row.length) commit(Math.min(target, (width - gap * (row.length - 1)) / ar), false);
  grid.style.height = Math.max(0, y - gap) + 'px';
}

const reveal = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); } });
}, { root: gal, rootMargin: '0px 0px -4% 0px' });

gal.addEventListener('scroll', () => { galY = gal.scrollTop; }, { passive: true });
gal.addEventListener('wheel', e => {
  if (!fine || reduced || e.ctrlKey) return;
  e.preventDefault();
  const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * H : e.deltaY;
  if (wheelPos === null) { wheelPos = gal.scrollTop; wheelTarget = wheelPos; }
  wheelTarget = clamp(wheelTarget + d, 0, gal.scrollHeight - gal.clientHeight);
}, { passive: false });
grid.addEventListener('pointerover', e => { ptr.onPhoto = !!e.target.closest('.ph'); });
grid.addEventListener('pointerleave', () => { ptr.onPhoto = false; });

/* ───────── Lightbox: the photo is physically lifted out of the grid ───────── */
const LB = (() => {
  const box = $('#lb'), bgEl = $('.lb-bg', box), count = $('#lbCount');
  let [cur, old] = box.querySelectorAll('.lb-img');
  const x = spring(0, 240, 0.8), y = spring(0, 240, 0.8), s = spring(1, 240, 0.8);
  const ox = spring(0, 260, 0.82), oy = spring(0, 260, 0.82), bg = spring(0, 190, 1), nav = spring(1, 170, 0.9);
  const api = { on: false, zone: '' };
  let idx = 0, closing = false, fade = false, navDir = 0, fit = null, oldFit = null, closeAt = 0;
  let drag = null;

  const fitRect = p => {
    const mw = W * (axisX ? 0.9 : 1), mh = H * (axisX ? 0.88 : 0.82);
    const sc = Math.min(mw / p.w, mh / p.h), w = p.w * sc, h = p.h * sc;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  };
  const place = (im, f, p) => {
    im.style.width = f.w + 'px'; im.style.height = f.h + 'px'; im.alt = p.alt || '';
    if (im.dataset.full === p.src) return;
    im.dataset.full = p.src; im.src = p.thumb || p.src;
    if (p.thumb) { const full = new Image(); full.src = p.src; (full.decode ? full.decode() : Promise.resolve()).then(() => { if (im.dataset.full === p.src) im.src = p.src; }).catch(() => {}); }
  };
  const prevB = $('#lbPrev'), nextB = $('#lbNext'), ui = [count, $('#lbClose'), prevB, nextB];
  const label = () => { count.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(photos.length).padStart(2, '0')}`; prevB.disabled = idx === 0; nextB.disabled = idx === photos.length - 1; };

  api.open = n => {
    idx = n; api.on = true; closing = false; fade = false; navDir = 0;
    fit = fitRect(photos[n]);
    const r = items[n].getBoundingClientRect();
    place(cur, fit, photos[n]); cur.style.opacity = 1; cur.style.display = ''; old.style.display = 'none';
    x.snap(r.left); y.snap(r.top); s.snap(r.width / fit.w);
    x.t = fit.x; y.t = fit.y; s.t = 1; bg.t = 1; ox.snap(0); oy.snap(0); nav.snap(1);
    items[n].classList.add('lifted');
    box.hidden = false; gal.inert = true; label(); render();
    $('#lbClose').focus({ preventScroll: true });
  };

  api.close = instant => {
    if (!api.on || closing) return;
    if (instant) return finish();
    closing = true; closeAt = performance.now(); navDir = 0; old.style.display = 'none';
    x.snap(x.x + ox.x); y.snap(y.x + oy.x); y.v = oy.v; ox.snap(0); oy.snap(0);
    const r = items[idx].getBoundingClientRect();
    if (r.bottom < 0 || r.top > H) { fade = true; s.t = 0.9; x.t = x.x + fit.w * 0.05; y.t = y.x + fit.h * 0.05; }
    else { x.t = r.left; y.t = r.top; s.t = r.width / fit.w; }
    bg.t = 0;
  };
  function finish() {
    api.on = false; closing = false; box.hidden = true;
    items.forEach(i => i.classList.remove('lifted'));
    gal.inert = !(state === 'open');
    items[idx]?.focus({ preventScroll: true });
  }

  api.go = (d, from = 0) => {
    if (!api.on || closing) return;
    const n = idx + d;
    if (n < 0 || n >= photos.length) { ox.v -= d * 900; ox.t = 0; return; } // nothing there: a nudge that bounces back
    items[idx].classList.remove('lifted');
    [cur, old] = [old, cur]; oldFit = fit;
    idx = n; fit = fitRect(photos[n]);
    place(cur, fit, photos[n]); cur.style.display = ''; cur.style.opacity = 1; old.style.display = '';
    items[n].classList.add('lifted');
    x.snap(fit.x); y.snap(fit.y); s.snap(1); ox.snap(0); oy.snap(0);
    navDir = d; nav.snap(from); nav.t = 1; label();
  };

  function render() {
    const p = navDir ? clamp(nav.x, 0, 1.2) : 1;
    const travel = W * 0.72;
    cur.style.transform = `translate3d(${x.x + ox.x + navDir * (1 - p) * travel}px,${y.x + oy.x}px,0) scale(${s.x})`;
    if (navDir) {
      cur.style.opacity = clamp(p * 1.6, 0, 1);
      old.style.transform = `translate3d(${oldFit.x - navDir * p * travel}px,${oldFit.y}px,0) scale(${1 - 0.06 * p})`;
      old.style.opacity = clamp(1 - p * 1.4, 0, 1);
      if (nav.near(0.002)) { navDir = 0; old.style.display = 'none'; }
    } else if (fade) cur.style.opacity = bg.x;
    const pull = Math.abs(oy.x) / (H * 0.7);
    bgEl.style.opacity = clamp(bg.x * 0.96 * (1 - pull), 0, 1);
    for (const u of ui) u.style.opacity = bg.x;
  }
  api.tick = now => {
    if (!api.on) return;
    render();
    if (closing && ((s.near(0.004) && x.near(0.6) && y.near(0.6)) || now - closeAt > 1100)) finish();
  };
  api.resize = () => { if (api.on) { fit = fitRect(photos[idx]); place(cur, fit, photos[idx]); x.snap(fit.x); y.snap(fit.y); s.snap(1); navDir = 0; old.style.display = 'none'; } };

  box.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || closing) return;
    box.setPointerCapture(e.pointerId);
    drag = { onImg: e.target.classList.contains('lb-img'), x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, vx: 0, vy: 0, axis: null };
  });
  box.addEventListener('pointermove', e => {
    api.zone = e.clientX < W * 0.3 ? 'Prev' : e.clientX > W * 0.7 ? 'Next' : 'Close';
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, e.timeStamp - drag.lt);
    drag.vx = lerp(drag.vx, (e.clientX - drag.lx) / dt, 0.5); drag.vy = lerp(drag.vy, (e.clientY - drag.ly) / dt, 0.5);
    drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = e.timeStamp;
    if (!drag.axis && Math.hypot(dx, dy) > 8) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (drag.axis === 'x') ox.snap(dx);
    if (drag.axis === 'y') oy.snap(dy);
  });
  const end = e => {
    if (!drag) return;
    const d = drag; drag = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.axis) {
      if (e.type === 'pointercancel') return;
      return d.onImg ? undefined : api.close(); // a click anywhere outside the photograph returns to the gallery
    }
    if (d.axis === 'x') {
      const dir = dx < 0 ? 1 : -1, has = idx + dir >= 0 && idx + dir < photos.length;
      if (has && (Math.abs(dx) > W * 0.12 || Math.abs(d.vx) > 0.45)) {
        const from = clamp(Math.abs(dx) / (W * 0.72), 0, 0.9);
        api.go(dir, from); nav.v = Math.abs(d.vx) * 1000 / (W * 0.72);
      } else { ox.t = 0; ox.v = d.vx * 1000; }
    } else if (Math.abs(dy) > 90 || Math.abs(d.vy) > 0.6) { oy.v = d.vy * 1000; api.close(); }
    else { oy.t = 0; oy.v = d.vy * 1000; }
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  $('#lbClose').addEventListener('click', () => api.close());
  prevB.addEventListener('click', () => api.go(-1));
  nextB.addEventListener('click', () => api.go(1));
  return api;
})();

/* ───────── Input ───────── */
function track(e) {
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.type = e.pointerType === 'mouse' || e.pointerType === 'pen' ? 'mouse' : 'touch';
  ptr.inside = true;
  const t = e.target instanceof Element ? e.target : null;
  ptr.onStage = !!t?.closest('.stage');
  ptr.onUI = !!t?.closest('.mark, .back, .info, .lb button, .gal-next');
  ptr.onMark = !!t?.closest('.mark');
}
let pvx = 0, pvy = 0, pvt = 0, ptrSpeed = 0;
addEventListener('pointermove', e => {
  const dtm = Math.max(4, e.timeStamp - pvt);
  ptrSpeed = Math.min(3, Math.hypot(e.clientX - pvx, e.clientY - pvy) / dtm); pvx = e.clientX; pvy = e.clientY; pvt = e.timeStamp;
  track(e);
  if (pressing && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 14) explored = true;
}, { passive: true });
addEventListener('pointerdown', e => {
  track(e);
  if (state !== 'home' || !ptr.onStage || e.button > 0) return;
  if (infoOpen && ptr.type === 'touch') { setInfo(false); return; }
  pressing = true; explored = false; pressAt = [e.clientX, e.clientY];
  pressIdx = idxAt(coord());
  press.t = 1;
});
const release = e => {
  if (!pressing) return;
  pressing = false; press.t = 0;
  if (e.type === 'pointerup' && state === 'home') {
    const i = idxAt(coord());
    if (i >= 0 && (ptr.type === 'mouse' ? i === pressIdx : !explored)) { press.v = -9; go(cats[i].slug); }
  }
  if (ptr.type === 'touch') ptr.inside = false;
};
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
document.documentElement.addEventListener('pointerleave', () => { ptr.inside = false; });
addEventListener('blur', () => { ptr.inside = false; pressing = false; press.t = 0; });

panels.forEach((p, i) => {
  p.a.addEventListener('click', e => { e.preventDefault(); if (e.detail === 0) go(cats[i].slug); }); // keyboard activation
  p.a.addEventListener('focus', () => { if (p.a.matches(':focus-visible')) kbHover = i; });
  p.a.addEventListener('blur', () => { if (kbHover === i) kbHover = -1; });
  p.a.addEventListener('dragstart', e => e.preventDefault());
});

mark.addEventListener('click', () => { setInfo(ptr.type === 'mouse' && fine && ptr.inside ? true : !infoOpen); });
back.addEventListener('click', () => go(''));

addEventListener('keydown', e => {
  if (LB.on) {
    if (e.key === 'Escape') LB.close();
    else if (e.key === 'ArrowRight') LB.go(1);
    else if (e.key === 'ArrowLeft') LB.go(-1);
    else if (e.key === 'Tab') e.preventDefault();
    return;
  }
  if (e.key === 'Escape') { if (infoOpen) setInfo(false); else if (active >= 0) go(''); }
});
addEventListener('resize', () => { measure(state === 'home' || state === 'intro'); LB.resize(); });

/* ───────── Frame ───────── */
const put = (p, key, node, prop, val) => { if (p.cache[key] !== val) { p.cache[key] = val; node.style[prop] = val; } };
let last = performance.now(), introAt = 0, loaded = 0;
const loaderBar = $('.loader i');

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1); last = now; // real time, so slow frames never become slow motion

  // state machine driven by time + physics, never by stacked timeouts
  if (state === 'intro' && introAt) {
    panels.forEach((p, i) => { if (p.ready && now >= introAt + 120 * i) { if (reduced) p.intro.snap(0); else p.intro.t = 0; } });
    if (now > introAt + 120 * N + 300 && panels[0].intro.t === 0) { document.body.classList.remove('intro'); state = 'home'; route(); }
  }
  if (state === 'opening') {
    if (pendingBuild >= 0 && now - openedAt > 230) { buildGallery(pendingBuild); pendingBuild = -1; }
    const settled = B.every(b => Math.abs(b.x - b.t) < L * 0.012);
    if (pendingBuild < 0 && now - openedAt > 260 && (settled || now - openedAt > 1400)) {
      state = 'open';
      gal.classList.add('on'); gal.inert = false;
      cells.forEach(c => reveal.observe(c.node));
    }
  } else if (state === 'closing' && now - closedAt > 150) {
    active = -1; state = 'home'; built = -1;
  }
  if (!infoOpen && state === 'home' && ptr.type === 'mouse' && ptr.inside && !pressing && (ptr.onMark || (axisX && ptr.x <= 5))) setInfo(true);
  if (infoOpen && ptr.type === 'mouse') {
    if (!ptr.inside || coord() > infoSize + 10) { if (!infoLeaveAt) infoLeaveAt = now; else if (now - infoLeaveAt > 160) setInfo(false); }
    else infoLeaveAt = 0;
  } else infoLeaveAt = 0;

  // smooth wheel in the gallery
  if (wheelPos !== null) {
    wheelPos += (wheelTarget - wheelPos) * (1 - Math.exp(-dt * 10));
    if (Math.abs(wheelTarget - wheelPos) < 0.4) { gal.scrollTop = wheelTarget; wheelPos = null; }
    else gal.scrollTop = wheelPos;
    galY = gal.scrollTop;
  }

  const h = hoverIdx();
  setTargets(h);
  for (let i = 0; i < N; i++) B[i].t = TS[i].x;
  warp.t = performance.now() - pvt < 60 ? ptrSpeed : 0;
  infoLag.t = clamp(B[0].x, 0, infoSize * 1.2);
  infoHv.t = infoOpen && ptr.inside && coord() < B[0].x ? 1 : 0;
  parX.t = ptr.inside && ptr.type === 'mouse' ? clamp(ptr.x / W * 2 - 1, -1, 1) : 0;
  parY.t = (ptr.inside && ptr.type === 'mouse' ? clamp(ptr.y / H * 2 - 1, -1, 1) : 0) + (state === 'open' ? clamp(galY / H, 0, 1) * 0.9 : 0);
  const opened = state === 'open' || state === 'opening';
  const scrollP = opened ? clamp(galY / (H * 0.55), 0, 1) : 0;
  anyHover.t = h >= 0 ? 1 : 0;
  shift.t = opened ? -Math.min(galY * TUNE.parallax, H * 0.027) : 0;
  flat.t = opened ? 0.16 + scrollP * 0.56 : 0;
  nx.t = ptr.inside ? clamp(coord() / L, 0, 1) : 0.5;
  panels.forEach((p, i) => { p.hv.t = i === h ? 1 : 0; p.op.t = i === active && state !== 'closing' ? 1 : 0; });

  for (let i = 0; i < springs.length; i++) springs[i].step(dt);

  // render
  const cross = axisX ? H : W;
  const infoP = clamp(B[0].x / infoSize, 0, 1);
  const any = Math.max(anyHover.x, infoP);
  const dpr = GLS ? GLS.dpr : 1;
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const p = panels[i];
    const pos = Math.max(prev, clamp(B[i].x, 0, L));
    const end = i < N - 1 ? Math.max(pos, clamp(B[i + 1].x, 0, L)) : L;
    const size = end - pos; prev = pos;
    const io = p.intro.x * cross;
    const hv = clamp(p.hv.x, 0, 1), op = clamp(p.op.x, 0, 1);
    const zoom = 1 + TUNE.zoomHover * hv * (1 - 0.45 * press.x) * (1 - op) + TUNE.zoomOpen * op + (GLS && GLS.depth[i] ? GLS.depth[i] * 1.2 * Math.max(hv, op) : 0);

    // the elastic photo: its own centre and size chase the frame; the mismatch is squash, stretch and lag
    p.lagC.t = pos + size / 2; p.lagS.t = Math.max(1, size);
    const q = clamp(Math.max(1, size) / Math.max(1, p.lagS.x), 0.74, 1.38);

    if (GLS) {
      put(p, 't', p.a, 'transform', axisX ? `translate3d(${pos.toFixed(2)}px,0,0)` : `translate3d(0,${pos.toFixed(2)}px,0)`);
      const sw = axisX ? size : W, shh = axisX ? H : size;
      GU.B[i] = (i === 0 ? clamp(B[0].x, 0, L) : pos) * dpr;
      GU.Q[i] = reduced ? 1 : q;
      GU.lag[i] = reduced ? 0 : clamp((p.lagC.x - (pos + size / 2)) * 0.55, -90, 90) * dpr;
      GU.A[i] = p.aspect; GU.F[i] = p.focus; GU.hv[i] = hv; GU.op[i] = op; GU.intro[i] = clamp(p.intro.x, 0, 1); GU.zoom[i] = zoom;
      GU.lod[i] = Math.max(0, Math.log2(GLS.texH[i] / (Math.max(shh, sw / p.aspect, 1) * zoom * dpr)) - 0.2);
    } else {
      put(p, 't', p.a, 'transform', axisX ? `translate3d(${pos.toFixed(2)}px,${io.toFixed(1)}px,0)` : `translate3d(${io.toFixed(1)}px,${pos.toFixed(2)}px,0)`);
      const along = p.focus * (size - L);
      put(p, 'i', p.imgWrap, 'transform', axisX
        ? `translate3d(${along.toFixed(2)}px,${(shift.x * op).toFixed(2)}px,0) scale(${(zoom + 0.03).toFixed(4)})`
        : `translate3d(0,${(along + shift.x * op).toFixed(2)}px,0) scale(${(zoom + 0.03).toFixed(4)})`);
      const idle = lerp(lerp(0.3, 0.6, any), 0.02, hv);
      put(p, 'd', p.dim, 'opacity', lerp(idle, flat.x, op).toFixed(3));
      put(p, 's', p.scrim, 'opacity', op.toFixed(3));
    }

    const lo = lerp(lerp(0.8, 0.4, any), 1, Math.max(hv, op)) * (axisX ? 1 : 1 - op * clamp(scrollP * 3, 0, 1)) * (1 - clamp(p.intro.x, 0, 1)) * clamp((size - 30) / 60, 0, 1);
    put(p, 'l', p.label, 'opacity', clamp(lo, 0, 1).toFixed(3));
    put(p, 'w', p.wrap, 'transform', `translate3d(0,${(axisX ? H : size).toFixed(1)}px,0)`);
    const ratio = size / (L / N);
    put(p, 'v', p.ttl, 'fontVariationSettings', `"wdth" ${Math.round(clamp(100 + (ratio - 1) * 42, 58, 150))}`);
  }
  if (GLS) {
    GU.B[N] = L * dpr;
    GU.axisX = axisX; GU.time = now / 1000; GU.any = any; GU.dark = flat.x; GU.blur = reduced ? 0 : clamp((flat.x - 0.16) / 0.56, 0, 1) * 3.4;
    GU.shift = shift.x; GU.press = press.x; GU.warp = 0;
    GU.info = infoSize; GU.pOff = Math.min(infoSize * 0.2, infoLag.x - infoSize) * 1.25; GU.pIn = clamp(infoLag.x / infoSize * 1.6 - 0.2, 0, 1); GU.pHv = clamp(infoHv.x, 0, 1);
    GU.pSplit = reduced ? 0 : clamp((B[0].x - infoLag.x) / Math.max(1, infoSize), -0.3, 0.3) * 0.02;
    GU.pLod = GLS.portraitH ? Math.max(0, Math.log2(GLS.portraitH / (Math.max(axisX ? H * 0.76 : infoSize, (axisX ? infoSize : W * 0.6) / GLS.portraitA) * dpr)) - 0.3) : 0;
    GU.parX = reduced ? 0 : parX.x; GU.parY = reduced ? 0 : parY.x;
    GU.ptrX = ptr.inside ? ptr.x : W / 2; GU.ptrY = ptr.inside ? ptr.y : H / 2;
    GLS.draw(GU);
  }

  const ip = infoP;
  const off = Math.min(infoSize * 0.2, infoLag.x - infoSize);
  if (info._off !== off) { info._off = off; info.style.setProperty('--off', off.toFixed(1) + 'px'); }
  if (info._p !== ip) { info._p = ip; info.style.setProperty('--p', ip.toFixed(3)); if (ip < 0.002 && !infoOpen) info.classList.remove('on'); }

  LB.tick(now);
  requestAnimationFrame(frame);
}

/* ───────── Boot ───────── */
document.body.classList.add('intro');
measure(true);
requestAnimationFrame(frame);

if (GLS && SITE.portrait) { const pi = new Image(); pi.src = SITE.portrait.src; (pi.decode ? pi.decode() : Promise.resolve()).then(() => GLS.setPortrait(pi)).catch(() => {});
  if (SITE.portrait.depth) { const pd = new Image(); pd.src = SITE.portrait.depth; (pd.decode ? pd.decode() : Promise.resolve()).then(() => GLS.setPortraitDepth(pd, SITE.portrait.parallax ?? SITE.parallax ?? TUNE.depth)).catch(() => {}); } }

// Each column enters as soon as its own photograph is decoded (in order, never before its turn),
// so one heavy file can't hold the whole page hostage.
panels.forEach((p, i) => {
  (p.img.decode ? p.img.decode().catch(() => {}) : Promise.resolve()).then(() => {
    if (GLS && p.img.naturalWidth) GLS.setImage(i, p.img);
    if (GLS && cats[i].cover.depth) { const d = new Image(); d.src = cats[i].cover.depth; (d.decode ? d.decode() : Promise.resolve()).then(() => GLS.setDepth(i, d, cats[i].cover.parallax ?? SITE.parallax ?? TUNE.depth)).catch(() => {}); }
    p.ready = true;
    if (!introAt) introAt = performance.now() + 80;
    loaded++; if (loaderBar) loaderBar.style.transform = `scaleX(${loaded / N})`;
    document.body.classList.add('loaded');
  });
});
setTimeout(() => { panels.forEach(p => { p.ready = true; }); if (!introAt) introAt = performance.now(); document.body.classList.add('loaded'); }, 5000);
})();
