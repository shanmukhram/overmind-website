// The page builds itself on a first visit.
//
// The page starts as a plain canvas with rulers, and a team of agent
// cursors builds it section by section while the view follows: guides are
// dragged out of the rulers, some agents draw the boxes and the rest work
// inside the boxes already drawn, all at once. One Lead takes the headline,
// the demo window and the three figures; 19 workers do the rest. The
// inline script in index.html decides whether this runs at all (never with
// reduced motion, in a background tab, under automation, with a #link, or
// twice in one tab). When it ends, or is skipped, everything added here is
// removed and every touched element gets its own style attribute back, so
// the page is then exactly what it is without the intro.

import { animate, spring } from "./vendor/motion.js";

// Tuning. `?seed=123` overrides the seed. The same seed and window size give
// the same choreography on every load.
const CONFIG = {
  seed: 20261102,
  workers: 19,
  pace: 1, // gesture length; lower is faster
  touring: true,
  sound: false,
  flocking: true,
  leadName: "Lead · Opus 5.5",
  workerName: (n) => "Worker " + n + " · DeepSeek V4.1 Flash",
};

const STEP = 1 / 120; // simulation step, seconds
const SPLASH = 1.2; // phase 0
const REVEAL = 0.6; // phase 1
const SEP = 40; // minimum distance between agents in transit, px
const HOLD = 0.9; // share of a stop built before the next one opens
const DRAFT = 0.5; // share built before the next stop's guides and frames start
const DRAWERS = 7; // most agents drawing boxes at once
const SEGMENT = 230; // longest piece of a line one agent types, px
const SPEED = 2; // the owner's chosen pace; every gesture and glide runs at it

const QUEUED = 0, CLAIMED = 1, WORKING = 2, DONE = 3;

const root = document.documentElement;
const params = new URLSearchParams(location.search);
const rand = mulberry32(Number(params.get("seed")) || CONFIG.seed);

const S = {
  t: 0, phase: -1, speed: SPEED, touring: CONFIG.touring, sound: CONFIG.sound,
  layers: [], hosts: [], agents: [], active: new Set(), done: 0,
  stops: [], secs: [], tasks: [], open: -1, draft: -1, cur: 0, drawing: 0,
  camY: 0, camV: 0, vw: 0, vh: 0, docH: 0, tick: 0,
  last: 0, acc: 0, raf: 0, ended: false, end: null,
};
const ui = {};
const touched = new Map();
const everTouched = new Set();

window.__praxisIntro = true;
if (params.has("debug")) {
  window.__praxisIntroState = S;
  S.prof = { n: 0, sum: 0, max: 0, slow: 0 };
}
start().catch(fail);

// ---------------------------------------------------------------- start

async function start() {
  if (document.readyState === "loading") {
    await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (scrollY !== 0) scrollTo({ top: 0, behavior: "instant" });
  await loadCss();
  buildChrome();
  root.classList.remove("intro-cover");
  // Measure and hide only after the browser has drawn the real page once,
  // under the cover, so the largest paint is the page's own.
  await frame();
  await frame();
  measure();
  S.layers = collect();
  if (!S.layers.length) return cleanup();
  buildStops();
  for (const L of S.layers) hideLayer(L);
  buildFrames();
  buildRulers();
  buildHud();
  buildAgents();
  buildRoster();
  listen();
  S.phase = 0;
  S.last = performance.now();
  S.raf = requestAnimationFrame(loop);
}

function loadCss() {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("intro.css", import.meta.url).href;
    link.onload = link.onerror = () => resolve();
    link.dataset.intro = "";
    document.head.appendChild(link);
    ui.css = link;
  });
}

function measure() {
  S.vw = root.clientWidth;
  S.vh = innerHeight;
  S.docH = root.scrollHeight;
}

// ---------------------------------------------------------------- layers
//
// Every visible part of the page becomes a layer, in reading order: a box
// with its own background or border, each line of text, each icon, chip,
// button and logo. A box comes before the parts inside it.

const SKIP = "script,template,style,noscript,.sr-only,.skip,[hidden],[data-intro-skip]";
const ATOMIC = "svg,img,video,canvas,input,select,textarea,button,hr,.button,.header-cta,.chip,.file-chip,.file-card,.app-pill,.meter,.figure-num,.wait-dot";

function collect() {
  const out = [];
  const ctx = { out, prev: null, bg: getComputedStyle(document.body).backgroundColor };
  for (const sel of [".site-header", "#main", ".site-footer"]) {
    const el = document.querySelector(sel);
    if (el) walk(el, null, ctx.bg, ctx);
  }
  out.forEach((L, i) => {
    L.qi = i;
    L.g = gestureFor(L);
  });
  return out;
}

function walk(el, dep, inheritedBg, ctx) {
  if (el.matches(SKIP)) return;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return;
  if (cs.display !== "contents") {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
  }
  const own = hasOwnLook(cs, inheritedBg);
  const bg = alpha(cs.backgroundColor) > 0 ? cs.backgroundColor : inheritedBg;
  if (el.matches(ATOMIC) || (own && isTextHost(el))) {
    leaf(el, dep, own ? "box" : "media", cs, ctx);
  } else if (isTextHost(el)) {
    if (isItemRow(el)) for (const c of el.children) leaf(c, dep, "item", getComputedStyle(c), ctx);
    else rows(el, dep, ctx);
  } else {
    const shell = own ? add(ctx, { el, dep, kind: "shell", ...docRect(el) }) : dep;
    for (const c of el.children) walk(c, shell, bg, ctx);
  }
}

function add(ctx, L) {
  L.state = QUEUED;
  L.lead = false;
  ctx.out.push(L);
  return L;
}

function leaf(el, dep, kind, cs, ctx) {
  if (el.matches(SKIP) || cs.display === "none") return;
  const r = docRect(el);
  if (r.w < 2 || r.h < 2) return;
  const L = add(ctx, { el, dep, kind, inline: cs.display === "inline", ...r });
  const p = ctx.prev;
  if (p && p.el === el.previousElementSibling && p.el.tagName === el.tagName &&
      p.el.getAttribute("class") === el.getAttribute("class")) L.from = p;
  ctx.prev = L;
}

// One layer per line of text. The element is the line's "host": its
// clip-path shows the lines typed so far.
function rows(el, dep, ctx) {
  const box = el.getBoundingClientRect();
  const lines = lineRects(el);
  if (!lines.length) return;
  const host = { el, w: box.width, h: box.height, rows: [], p: [], left: 0, dirty: false };
  const lead = el.matches(".hero h1");
  S.hosts.push(host);
  // A long line is cut into pieces that several agents type at once; the
  // Lead types its headline lines whole.
  lines.forEach((l, i) => {
    const prev = lines[i - 1], next = lines[i + 1];
    const y0 = prev ? (prev.bottom + l.top) / 2 - box.top : -60;
    const y1 = next ? (l.bottom + next.top) / 2 - box.top : box.height + 60;
    const w = l.right - l.left;
    const n = lead ? 1 : Math.max(1, Math.round(w / SEGMENT));
    for (let j = 0; j < n; j++) {
      const x = l.left - box.left + (w * j) / n;
      host.rows.push({ x, w: w / n, y0, y1, first: j === 0, last: j === n - 1 });
      host.p.push(0);
      add(ctx, {
        el, dep, kind: "row", host, ri: host.rows.length - 1,
        x: box.left + x + scrollX, y: l.top + scrollY, w: w / n, h: l.bottom - l.top,
      }).lead = lead;
      host.left++;
    }
  });
  ctx.prev = null;
}

function lineRects(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const r of rects) {
    const mid = (r.top + r.bottom) / 2;
    const line = lines.find((l) => mid > l.top && mid < l.bottom);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
  }
  return lines;
}

function isTextHost(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return true;
  if (!el.children.length || !el.textContent.trim()) return false;
  for (const c of el.children) {
    if (c.matches(SKIP)) continue;
    const d = getComputedStyle(c).display;
    if (d !== "none" && !d.startsWith("inline")) return false;
  }
  return true;
}

// A row of four or more inline items and no loose text, such as the model
// names: each item is its own layer.
function isItemRow(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return false;
  return el.children.length >= 4;
}

function hasOwnLook(cs, inheritedBg) {
  if (alpha(cs.backgroundColor) > 0 && cs.backgroundColor !== inheritedBg) return true;
  if (cs.backgroundImage !== "none") return true;
  if (cs.boxShadow !== "none") return true;
  for (const s of ["Top", "Right", "Bottom", "Left"]) {
    if (parseFloat(cs["border" + s + "Width"]) > 0 && cs["border" + s + "Style"] !== "none" &&
        alpha(cs["border" + s + "Color"]) > 0) return true;
  }
  return false;
}

function gestureFor(L) {
  if (L.kind === "row") return L.lead ? "headline" : "type";
  if (L.el.matches(".app")) { L.lead = true; return "drag"; }
  if (L.el.matches(".figure-num")) { L.lead = true; return "stamp"; }
  if (L.kind === "shell") return "fill";
  if (L.inline) return "pop";
  if (L.from && L.w * L.h < 40000) return "dup";
  if (L.el.tagName === "svg" && L.el.getAnimations({ subtree: true }).length) return "draw";
  if (L.kind === "box") {
    if (L.w / Math.max(L.h, 1) > 6) return "size";
    return L.w * L.h < 9000 ? "pop" : "fill";
  }
  return L.w * L.h > 40000 ? "size" : "pop";
}

function hideLayer(L) {
  if (L.kind === "row") {
    if (L.ri === 0) style(L.el).clipPath = "inset(50%)";
  } else if (L.inline) {
    style(L.el).opacity = "0";
  } else {
    style(L.el).clipPath = "inset(50%)";
  }
}

// ---------------------------------------------------------------- gestures
//
// Each gesture says where its agent starts, how long it takes, where the
// cursor is at progress k (0 to 1) and how the part looks meanwhile.

const center = (L) => [L.x + L.w / 2, L.y + L.h / 2];

const G = {
  // A guide dragged out of a ruler to an edge of the section.
  ruler: {
    dur: () => 0.8,
    start: (L) => L.dir === "h" ? [L.at, scrollY + 9] : [9, scrollY + S.vh * L.at],
    begin(L, a) {
      L.from = L.dir === "h" ? scrollY + 9 : 9;
      L.fixed = L.dir === "h" ? a.x : a.y;
      L.line = guides.get();
      L.line.className = L.dir === "h" ? "ib-gh" : "ib-gv";
    },
    point(L, k) {
      const p = L.from + (L.pos - L.from) * ease(k);
      return L.dir === "h" ? [L.fixed, p] : [p, L.fixed];
    },
    draw(L, k) {
      const p = (L.from + (L.pos - L.from) * ease(k)).toFixed(1);
      L.line.style.transform = L.dir === "h" ? "translate(0px," + p + "px)" : "translate(" + p + "px,0px)";
    },
    end(L) { L.sec.lines.push(L.line); },
  },
  // A box dragged out corner to corner, its size counting up. It stays as a
  // blueprint outline until the work inside it is done.
  frame: {
    dur: (L) => clamp(0.4 + Math.hypot(L.w, L.dh) * 0.0004, 0.45, 0.85),
    start: (L) => [L.x, L.y],
    begin(L) { L.sel = sels.get(); L.sel.chip.textContent = ""; },
    point(L, k) { const e = ease(k); return [L.x + L.w * e, L.y + L.dh * e]; },
    draw(L, k) { const e = ease(k); selRect(L.sel, L.x, L.y, L.w * e, L.dh * e, true); },
    end(L) {
      sels.put(L.sel);
      L.wire = h("div", "ib-f" + (L.shell ? " is-shell" : ""), ui.frames);
      L.wire.style.cssText = "left:" + L.x.toFixed(1) + "px;top:" + L.y.toFixed(1) + "px;width:" + L.w.toFixed(1) + "px;height:" + L.h.toFixed(1) + "px";
    },
  },
  type: {
    dur: (L) => clamp(0.25 + L.w / 380, 0.35, 0.95),
    start: (L) => [L.x, L.y + L.h * 0.62],
    begin(L) { L.sel = sel(L, false); L.caret = carets.get(); },
    point: (L, k) => [L.x + L.w * typed(L, k) + 3, L.y + L.h * 0.66],
    draw(L, k) {
      const e = typed(L, k);
      setRow(L, e);
      selRect(L.sel, L.x - 2, L.y, L.w * e + 4, L.h, false);
      place(L.caret, L.x + L.w * e, L.y, 2, L.h);
    },
    end(L) { setRow(L, 1); carets.put(L.caret); sels.put(L.sel); },
  },
  fill: {
    dur: (L) => clamp(0.45 + Math.sqrt(L.w * L.h) * 0.0005, 0.5, 0.85),
    start: (L) => [L.x + 10, L.y + 10],
    begin(L) { L.sel = sel(L, true); L.R = Math.hypot(L.w, L.h) + 60; },
    point(L, k) {
      const e = ease(k);
      return [L.x + 10 + (L.w / 2 - 10) * e, L.y + 10 + (Math.min(L.h, S.vh * 0.6) / 2 - 10) * e];
    },
    draw(L, k) { L.el.style.clipPath = "circle(" + (L.R * easeOut(k)).toFixed(1) + "px at 10px 10px)"; },
    end(L) { sels.put(L.sel); restore(L.el); },
  },
  size: {
    dur: (L) => clamp(0.45 + Math.hypot(L.w, L.h) * 0.0003, 0.5, 0.8),
    start: (L) => [L.x, L.y],
    begin(L) { L.sel = sel(L, true); },
    point(L, k) { const e = ease(k); return [L.x + L.w * e, L.y + L.h * e]; },
    draw(L, k) {
      const e = ease(k);
      L.el.style.clipPath = "inset(0px " + (L.w * (1 - e)).toFixed(1) + "px " + (L.h * (1 - e)).toFixed(1) + "px 0px)";
      selRect(L.sel, L.x, L.y, L.w * e, L.h * e, true);
    },
    end(L) { sels.put(L.sel); restore(L.el); },
  },
  pop: {
    dur: () => 0.42,
    start: center,
    begin(L) {
      L.sel = sel(L, true);
      reveal(L, { opacity: [0, 1], transform: ["scale(0.8)", "none"] }, { type: spring, bounce: 0.4, duration: 0.5 });
    },
    point: (L) => [L.x + L.w / 2 + 3, L.y + L.h / 2 + 3],
    draw() {},
    end(L) { sels.put(L.sel); settle(L); },
  },
  dup: {
    dur: () => 0.55,
    start: (L) => center(L.from),
    begin(L) {
      L.sel = sel(L, true);
      const dx = L.from.x - L.x, dy = L.from.y - L.y;
      reveal(L, { opacity: [0.4, 1], transform: ["translate(" + dx + "px," + dy + "px)", "none"] },
        { type: spring, bounce: 0.2, duration: 0.65 });
    },
    point(L, k) {
      const e = easeOut(k), [fx, fy] = center(L.from), [tx, ty] = center(L);
      return [fx + (tx - fx) * e + 3, fy + (ty - fy) * e + 3];
    },
    draw(L, k) {
      const e = easeOut(k);
      selRect(L.sel, L.from.x + (L.x - L.from.x) * e, L.from.y + (L.y - L.from.y) * e, L.w, L.h, true);
    },
    end(L) { sels.put(L.sel); settle(L); },
  },
  draw: {
    dur: () => 0.5,
    start: center,
    begin(L) {
      L.sel = sel(L, true);
      L.el.style.clipPath = "none";
      for (const a of L.el.getAnimations({ subtree: true })) { a.currentTime = 0; a.play(); }
      reveal(L, { opacity: [0, 1] }, { duration: 0.3 });
    },
    point: center,
    draw() {},
    end(L) { sels.put(L.sel); settle(L); },
  },
  // The Lead's three showpieces, each with its own frame and guides.
  headline: {
    dur: (L) => clamp(0.8 + L.w * 0.0008, 0.9, 1.4),
    start: (L) => [L.x, L.y],
    begin(L) {
      L.sel = sel(L, true);
      L.guides = guideSet(L);
      L.caret = carets.get();
      L.caret.classList.add("is-lead");
    },
    point(L, k) {
      if (k < 0.3) { const e = ease(k / 0.3); return [L.x + L.w * e, L.y + L.h * e]; }
      return [L.x + L.w * typed(L, (k - 0.3) / 0.7) + 5, L.y + L.h * 0.72];
    },
    draw(L, k) {
      if (k < 0.3) {
        const e = ease(k / 0.3);
        selRect(L.sel, L.x, L.y, L.w * e, L.h * e, true);
        place(L.caret, -99, -99, 3, L.h);
      } else {
        const e = typed(L, (k - 0.3) / 0.7);
        selRect(L.sel, L.x, L.y, L.w, L.h, true);
        setRow(L, e);
        place(L.caret, L.x + L.w * e, L.y, 3, L.h);
      }
    },
    end(L) {
      setRow(L, 1);
      L.caret.classList.remove("is-lead");
      carets.put(L.caret);
      sels.put(L.sel);
      dropGuides(L);
    },
  },
  drag: {
    dur: () => 1.1,
    start: (L) => [L.x + L.w / 2 + 70, L.y + 64],
    begin(L) {
      L.sel = sel(L, true);
      reveal(L, { opacity: [0, 1], transform: ["translate(70px,46px) scale(0.94) rotate(-1.5deg)", "none"] },
        { type: spring, bounce: 0.25, duration: 1.0 });
    },
    point(L, k) {
      const e = easeOut(Math.min(1, k / 0.85));
      return [L.x + L.w / 2 + 70 * (1 - e), L.y + 18 + 46 * (1 - e)];
    },
    draw(L, k) {
      const e = easeOut(Math.min(1, k / 0.85));
      selRect(L.sel, L.x + 70 * (1 - e), L.y + 46 * (1 - e), L.w, L.h, true);
      if (k > 0.55 && !L.guides) L.guides = guideSet(L);
    },
    end(L) { sels.put(L.sel); dropGuides(L); settle(L); },
  },
  stamp: {
    dur: () => 0.8,
    start: (L) => [L.x, L.y],
    begin(L) {
      L.sel = sel(L, true);
      L.guides = guideSet(L);
      L.el.style.transformOrigin = "0 80%";
      L.stamped = false;
    },
    point(L, k) { const e = ease(Math.min(1, k / 0.45)); return [L.x + L.w * e, L.y + L.h * e]; },
    draw(L, k) {
      const e = ease(Math.min(1, k / 0.45));
      selRect(L.sel, L.x, L.y, L.w * e, L.h * e, true);
      if (k >= 0.45 && !L.stamped) {
        L.stamped = true;
        reveal(L, { opacity: [0, 1], transform: ["scale(1.45)", "none"] }, { type: spring, bounce: 0.35, duration: 0.7 });
      }
    },
    end(L) { sels.put(L.sel); dropGuides(L); settle(L); },
  },
  // No agent: a part that sat on the visitor's screen too long.
  auto: {
    dur: () => 0.22,
    begin(L) {
      if (L.kind !== "row") reveal(L, { opacity: [0, 1] }, { duration: 0.22 });
    },
    draw(L, k) { if (L.kind === "row") setRow(L, k); },
    end(L) { if (L.kind === "row") setRow(L, 1); else settle(L); },
  },
};

function typed(L, k) {
  const n = Math.max(4, Math.round(L.w / 9));
  return Math.min(1, Math.floor(clamp(k, 0, 1) * n + 1e-6) / n);
}

function setRow(L, p) {
  L.host.p[L.ri] = p;
  L.host.dirty = true;
}

function drawHost(host) {
  let d = "";
  host.rows.forEach((r, i) => {
    const p = host.p[i];
    if (p <= 0) return;
    const x0 = r.first ? -80 : r.x;
    const x1 = p >= 1 ? (r.last ? host.w + 80 : r.x + r.w) : r.x + r.w * p;
    d += "M" + x0.toFixed(1) + " " + r.y0.toFixed(1) + "H" + x1.toFixed(1) + "V" + r.y1.toFixed(1) + "H" + x0.toFixed(1) + "Z";
  });
  host.el.style.clipPath = d ? 'path("' + d + '")' : "inset(50%)";
  host.dirty = false;
}

function reveal(L, keyframes, options) {
  const st = L.el.style;
  st.clipPath = "none";
  st.opacity = "";
  L.anim = animate(L.el, keyframes, { ...options, duration: options.duration / rate() });
  L.animDone = false;
  L.anim.finished.then(() => {
    L.animDone = true;
    if (L.state === DONE) restore(L.el);
  }, () => {});
}

function settle(L) {
  if (!L.anim || L.animDone) restore(L.el);
}

// ---------------------------------------------------------------- sections
//
// The page is built one stop at a time: each section, cut into stops no
// taller than the screen. A section starts with guides dragged out of the
// rulers. In a stop, drawers frame the boxes and the others work inside the
// boxes already framed. When 90% of a stop is built the next one opens and
// the view glides on, while a few agents finish what is left behind.

function buildStops() {
  const room = S.vh * 0.85;
  const els = [...document.querySelectorAll("#main > section, .site-footer")];
  els.forEach((el, i) => {
    const r = docRect(el);
    const top = i === 0 ? 0 : r.y, bottom = r.y + r.h;
    const sec = { lines: [], placed: 0, left: 0, guided: false, stops: [] };
    const n = Math.max(1, Math.ceil((bottom - top) / room));
    for (let j = 0; j < n; j++) {
      const st = { sec, top: top + ((bottom - top) * j) / n, layers: [], frames: [], done: 0, open: false, camY: 0 };
      sec.stops.push(st);
      S.stops.push(st);
    }
    S.secs.push(sec);
  });
  for (const L of S.layers) {
    let k = 0;
    while (k + 1 < S.stops.length && S.stops[k + 1].top <= L.y + 1) k++;
    L.stopRef = S.stops[k];
    L.stopRef.layers.push(L);
    L.stopRef.sec.left++;
  }
  S.stops = S.stops.filter((st) => st.layers.length);
  S.stops.forEach((st, i) => {
    const top = Math.min(...st.layers.map((L) => L.y));
    st.camY = i === 0 ? 0 : clamp(top - 96, 0, Math.max(0, S.docH - S.vh));
  });
  // One frame per box: per paragraph for lines of text, none for the Lead's
  // own layers (it frames them itself).
  const hostFrames = new Map();
  for (const L of S.layers) {
    if (L.lead) continue;
    let F = L.kind === "row" ? hostFrames.get(L.host) : null;
    if (!F) {
      const r = L.kind === "row" ? docRect(L.el) : L;
      F = {
        kind: "frame", g: "frame", state: QUEUED, lead: false, qi: L.qi - 0.5, stopRef: L.stopRef,
        x: r.x, y: r.y, w: r.w, h: r.h, dh: Math.min(r.h, S.vh * 0.6), shell: L.kind === "shell", owners: 0,
      };
      if (L.kind === "row") hostFrames.set(L.host, F);
      L.stopRef.frames.push(F);
    }
    F.owners++;
    L.frameTask = F;
  }
}

// A stop opens (content, and the view glides to it) at 90% of the one
// before; it is drafted (guides and frames) from 50%, so the drawers are
// a step ahead of the others.
function openStop(k) {
  const st = S.stops[k];
  if (!st || st.open) return;
  draftStop(k);
  st.open = true;
  S.open = k;
  S.cur = k;
  progress(st, k);
}

function progress(st, k) {
  if (st.done >= st.layers.length * HOLD) openStop(k + 1);
  else if (st.done >= st.layers.length * DRAFT) draftStop(k + 1);
}

function draftStop(k) {
  const st = S.stops[k];
  if (!st || st.drafted) return;
  st.drafted = true;
  S.draft = Math.max(S.draft, k);
  const sec = st.sec;
  if (!sec.guided) {
    sec.guided = true;
    const content = sec.stops.flatMap((s) => s.layers).filter((L) => L.kind !== "shell");
    const first = st.layers.filter((L) => L.kind !== "shell");
    const left = Math.min(...content.map((L) => L.x));
    const right = Math.min(S.vw - 24, Math.max(...content.map((L) => L.x + L.w)));
    const top = Math.min(...(first.length ? first : st.layers).map((L) => L.y));
    const add = (dir, pos, at) => S.tasks.push({ kind: "guide", g: "ruler", dir, pos, at, sec, state: QUEUED });
    add("h", top, left + (right - left) * (0.25 + rand() * 0.5));
    add("v", left, 0.3 + rand() * 0.4);
    if (right - left > 160) add("v", right, 0.3 + rand() * 0.4);
  }
}

function schedule() {
  for (const a of S.agents) if (a.mode === "idle") assign(a);
}

function assign(a) {
  const L = a.detached ? pickVisible(a) : pick(a);
  if (L) claim(a, L);
  else a.hover = hoverPoint(a);
}

// `ahead`: an agent with nothing left in the open stops may work further
// down rather than hover idle.
function ready(L, ahead) {
  if (L.state !== QUEUED) return false;
  if (L.kind === "frame") return ahead || L.stopRef.drafted;
  return (ahead || L.stopRef.open) &&
    (!L.dep || L.dep.state === DONE) && (!L.frameTask || L.frameTask.state === DONE);
}

// Guides first, then boxes for up to DRAWERS agents at a time, then the
// nearest work inside a framed box. The Lead takes its own layers first,
// the one most others wait on before the rest, and never drags guides.
function pick(a) {
  let best = null, cost = Infinity;
  if (!a.lead) {
    for (const T of S.tasks) {
      if (T.state !== QUEUED) continue;
      const [sx, sy] = G.ruler.start(T);
      const c = Math.hypot(sx - a.x, sy - a.y);
      if (c < cost) { cost = c; best = T; }
    }
    if (best) return best;
  }
  const from = Math.max(0, S.open - 2);
  const consider = (L, bias) => {
    const [sx, sy] = G[L.g].start(L);
    const c = Math.hypot(sx - a.x, sy - a.y) + bias;
    if (c < cost) { cost = c; best = L; }
  };
  const drawFirst = !a.lead && S.drawing < DRAWERS;
  const top = scrollY + 80, bottom = scrollY + S.vh - 60;
  const seen = (L) => L.y < bottom && L.y + Math.min(L.h, 60) > top;
  for (let k = from; k <= Math.max(S.open, S.draft); k++) {
    const st = S.stops[k], old = k < S.open ? -250 : k > S.open ? 300 : 0, q0 = st.layers[0].qi;
    for (const F of st.frames) {
      if (!ready(F) || (!st.open && !seen(F))) continue;
      consider(F, (F.qi - q0) * 3 + old + (drawFirst ? -2000 : 600));
    }
    if (!st.open) continue;
    for (const L of st.layers) {
      if (!ready(L) || (L.lead && !a.lead)) continue;
      let bias = (L.qi - q0) * 3 + old;
      if (L.kind === "shell") bias -= 300;
      if (L.lead && a.lead) bias -= 1e6 + waiting(L) * 1e3;
      consider(L, bias);
    }
  }
  if (best) return best;
  // Nothing here: start on the stops below, boxes first, but only on parts
  // already on screen, so the work stays in view and the view never has to
  // hurry. The Lead keeps its showpieces for when the view is on them.
  for (let k = S.open + 1; k < Math.min(S.stops.length, S.open + 3); k++) {
    const st = S.stops[k], q0 = st.layers[0].qi;
    if (st.layers[0].y > bottom) break;
    draftStop(k);
    for (const F of st.frames) if (seen(F) && ready(F, true)) consider(F, (F.qi - q0) * 3 - 300);
    for (const L of st.layers) if (!L.lead && seen(L) && ready(L, true)) consider(L, (L.qi - q0) * 3);
    if (best) return best;
  }
  return best;
}

function waiting(L) {
  let n = 0;
  for (let i = L.qi + 1; i < S.layers.length && i < L.qi + 80; i++) if (S.layers[i].dep === L) n++;
  return n;
}

// A detached agent works only on what the visitor is looking at, framing
// nothing first.
function pickVisible(a) {
  const top = scrollY, bottom = scrollY + S.vh;
  let best = null, cost = Infinity;
  for (const L of S.layers) {
    if (L.state !== QUEUED || L.y + L.h < top || L.y > bottom) continue;
    let T = L;
    while (T.dep && T.dep.state !== DONE) T = T.dep;
    if (T.state !== QUEUED || (T.dep && T.dep.state !== DONE) || (T.lead && !a.lead)) continue;
    const c = Math.hypot(T.x - a.x, T.y - a.y);
    if (c < cost) { cost = c; best = T; }
  }
  if (best) skipFrame(best.frameTask);
  return best;
}

function skipFrame(F) {
  if (!F || F.state === DONE) return;
  if (F.state === WORKING) { finish(F); return; }
  if (F.state === CLAIMED) release(F);
  F.state = DONE;
}

function hoverPoint(a) {
  if (a.detached) return [S.vw * (0.2 + 0.6 * a.u), scrollY + S.vh * (0.25 + 0.5 * a.v)];
  const st = S.stops[Math.max(0, S.open)];
  if (!st) return [a.x, a.y];
  let target = null, cost = Infinity;
  for (const L of st.layers) {
    if (L.state !== QUEUED || (L.lead && !a.lead)) continue;
    const c = Math.hypot(L.x - a.x, L.y - a.y);
    if (c < cost) { cost = c; target = L; }
  }
  if (!target) return [S.vw * (0.15 + 0.7 * a.u), st.camY + 140 + (S.vh - 260) * a.v];
  const [cx, cy] = center(target);
  return [cx + a.ox, cy + a.oy];
}

function claim(a, L) {
  L.state = CLAIMED;
  L.agent = a;
  a.L = L;
  a.mode = "travel";
  [a.tx, a.ty] = G[L.g].start(L);
  if (L.kind === "frame") S.drawing++;
}

// An agent let go of a layer it had claimed but not started.
function release(L) {
  if (L.kind === "frame") S.drawing = Math.max(0, S.drawing - 1);
  if (L.agent) { L.agent.L = null; L.agent.mode = "idle"; }
  L.agent = null;
  L.state = QUEUED;
}

function beginWork(L, a) {
  L.state = WORKING;
  L.t0 = S.t;
  L.dur = G[L.g].dur(L) * CONFIG.pace;
  if (a) {
    a.mode = "work";
    animate(a.svg, { transform: ["scale(1)", "scale(0.8)", "scale(1)"] }, { duration: 0.22 / rate() });
  }
  G[L.g].begin(L, a);
  S.active.add(L);
}

function finish(L) {
  G[L.g].end(L);
  L.state = DONE;
  S.active.delete(L);
  if (L.kind === "guide") {
    L.sec.placed++;
  } else if (L.kind === "frame") {
    S.drawing = Math.max(0, S.drawing - 1);
  } else {
    S.done++;
    const st = L.stopRef;
    st.done++;
    if (--st.sec.left === 0) fade(st.sec.lines);
    const F = L.frameTask;
    if (F && --F.owners === 0 && F.wire) fade([F.wire]);
    if (L.kind === "row" && --L.host.left === 0) {
      drawHost(L.host);
      restore(L.host.el);
    }
    tick();
    if (S.stops[S.open]) progress(S.stops[S.open], S.open);
  }
  const a = L.agent;
  if (a && a.L === L) {
    a.L = null;
    a.mode = "idle";
    if (S.phase === 2 || S.phase === 1) assign(a);
  }
}

function fade(els) {
  for (const el of els) {
    animate(el, { opacity: 0 }, { duration: 0.3 / rate() }).finished.then(() => el.remove(), () => {});
  }
}

function updateWork() {
  for (const L of [...S.active]) if (S.t - L.t0 >= L.dur) finish(L);
}

// With Touring off nothing on the visitor's screen stays a wireframe for
// more than about a second.
function guard() {
  const top = scrollY, bottom = scrollY + S.vh;
  for (const L of S.layers) {
    if (L.state === DONE || L.state === WORKING || L.y + L.h < top || L.y > bottom) continue;
    if (L.seen === undefined) L.seen = S.t;
    else if (S.t - L.seen > 1) autoBuild(L);
  }
}

function autoBuild(L) {
  if (L.state === DONE || L.state === WORKING) return;
  if (L.dep && L.dep.state !== DONE) {
    autoBuild(L.dep);
    if (L.dep.state !== DONE) return;
  }
  if (L.state === CLAIMED) release(L);
  skipFrame(L.frameTask);
  L.g = "auto";
  beginWork(L, null);
}

// ---------------------------------------------------------------- agents

function buildAgents() {
  const n = CONFIG.workers + 1;
  const hues = [];
  for (let i = 0; i < CONFIG.workers; i++) hues.push(205 + (i * 320) / CONFIG.workers);
  shuffle(hues);
  const cx = S.vw / 2, cy = scrollY + S.vh / 2;
  const far = Math.max(S.vw, S.vh) * 0.65;
  for (let i = 0; i < n; i++) {
    const lead = i === 0;
    const el = h("div", "ib-c" + (lead ? " is-lead" : ""), ui.crowd);
    el.innerHTML = '<svg viewBox="0 0 18 18"><path d="M2.2 2.2 16 8.1c.5.2.5.9-.1 1.1l-5.6 1.6c-.3.1-.5.3-.6.6L8.1 16.1c-.2.6-.9.6-1.1.1Z"/></svg>';
    if (lead) h("span", "ib-tag", el, CONFIG.leadName);
    else el.style.setProperty("--h", hues[i - 1].toFixed(0));
    const ang = rand() * Math.PI * 2;
    const ringOf = i < 9 ? 0 : i < 17 ? 1 : 2;
    S.agents.push({
      i, lead, el, svg: el.firstChild,
      name: lead ? CONFIG.leadName : CONFIG.workerName(i),
      hue: lead ? null : hues[i - 1],
      x: cx + Math.cos(ang) * far, y: cy + Math.sin(ang) * far, vx: 0, vy: 0,
      mode: "orbit", L: null, tx: 0, ty: 0, hover: null, detached: false,
      ring: ringOf, th0: rand() * Math.PI * 2, om: 0.75 + rand() * 0.5,
      ph: rand() * Math.PI * 2, ph2: rand() * Math.PI * 2,
      ox: (rand() - 0.5) * 110, oy: -20 - rand() * 50, u: rand(), v: rand(),
      jx: 0, jy: 0,
    });
  }
}

// Two loose rings turning against each other, with a few strays between.
// Radii breathe and wobble, so it never reads as a circle.
function orbitTarget(a, t) {
  const r = ui.wordRect;
  const cx = r.cx, cy = scrollY + r.cy;
  // On a narrow screen the rings stay inside it and grow taller instead.
  const ix = Math.min(r.w / 2 + 46, S.vw * 0.4), ox = Math.min(r.w / 2 + 112, S.vw * 0.46);
  const inner = [ix, r.h / 2 + 44 + (r.w / 2 + 46 - ix) * 0.6];
  const outer = [ox, r.h / 2 + 104 + (r.w / 2 + 112 - ox) * 0.9];
  if (a.ring === 2) {
    const th = a.th0 + 0.35 * t * (a.i % 2 ? 1 : -1) + 0.9 * Math.sin(0.55 * t + a.ph);
    const m = 0.5 + 0.38 * Math.sin(1.1 * t + a.ph2);
    return [cx + Math.cos(th) * (inner[0] + (outer[0] - inner[0]) * m), cy + Math.sin(th) * (inner[1] + (outer[1] - inner[1]) * m)];
  }
  const dir = a.ring === 0 ? 1 : -1;
  const [rx, ry] = a.ring === 0 ? inner : outer;
  const th = a.th0 + dir * a.om * t + 0.4 * Math.sin(0.8 * t + a.ph);
  const k = 1 + 0.11 * Math.sin(1.6 * t + a.ph) + 0.07 * Math.sin(3 * th + 0.9 * t + a.ph2);
  return [cx + Math.cos(th) * rx * k, cy + Math.sin(th) * ry * k];
}

function idleTarget(a, t) {
  a.jx = a.jx * 0.9 + (rand() - 0.5) * 0.8;
  a.jy = a.jy * 0.9 + (rand() - 0.5) * 0.8;
  const [hx, hy] = a.hover || [a.x, a.y];
  return [hx + 16 * Math.sin(0.7 * t + a.ph) + a.jx, hy + 11 * Math.sin(0.9 * t + a.ph2) + a.jy];
}

function stepAgents(dt) {
  const t = S.t;
  for (const a of S.agents) {
    if (a.mode === "gone") continue;
    if (a.mode === "work") {
      const L = a.L;
      // The layer was taken over (built straight away while Touring was off).
      if (!L || L.agent !== a || !G[L.g].point) { a.L = null; a.mode = "idle"; continue; }
      const [tx, ty] = G[L.g].point(L, clamp((t - L.t0) / L.dur, 0, 1));
      follow(a, tx, ty, dt);
      continue;
    }
    if (a.mode === "pinned") { follow(a, a.tx, scrollY + a.ty, dt); continue; }
    let tx, ty, maxV = 3300, arrive = 80;
    if (a.mode === "orbit") { [tx, ty] = orbitTarget(a, t); maxV = 2600; arrive = 160; }
    else if (a.mode === "idle") { [tx, ty] = idleTarget(a, t); maxV = 300; arrive = 70; }
    else {
      if (a.mode === "travel" && a.L.kind === "guide") [a.tx, a.ty] = G.ruler.start(a.L);
      tx = a.tx; ty = a.ty;
      if (a.mode === "home") { maxV = 2200; arrive = 140; }
    }
    steer(a, tx, ty, maxV, arrive, dt);
    const d = Math.hypot(tx - a.x, ty - a.y);
    if (a.mode === "travel" && d < 14) beginWork(a.L, a);
    else if (a.mode === "home" && d < 10) collapse(a);
    else if (a.mode === "approach" && d < 6) a.mode = "arrived";
  }
}

// Seek with arrival, plus light flocking: separation strongest, a little
// alignment, very little cohesion.
function steer(a, tx, ty, maxV, arrive, dt) {
  const dx = tx - a.x, dy = ty - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const want = maxV * Math.min(1, d / arrive);
  let ax = (dx / d * want - a.vx) * 12, ay = (dy / d * want - a.vy) * 12;
  // Close to its target an agent stops yielding, so idle agents hovering
  // there make room instead of keeping it out.
  if (CONFIG.flocking && a.mode !== "home" && !(a.mode !== "idle" && d < 60)) {
    let n = 0, avx = 0, avy = 0, cx = 0, cy = 0;
    for (const b of S.agents) {
      if (b === a || b.mode === "gone") continue;
      const ex = a.x - b.x, ey = a.y - b.y, e = Math.hypot(ex, ey);
      if (e < SEP && e > 0.01) {
        const push = (SEP - e) / SEP;
        ax += ex / e * push * 3200;
        ay += ey / e * push * 3200;
      }
      if (e < 90 && b.mode !== "work") { n++; avx += b.vx; avy += b.vy; cx += b.x; cy += b.y; }
    }
    if (n) {
      ax += (avx / n - a.vx) * 0.9 + (cx / n - a.x) * 0.12;
      ay += (avy / n - a.vy) * 0.9 + (cy / n - a.y) * 0.12;
    }
  }
  a.vx += ax * dt;
  a.vy += ay * dt;
  const v = Math.hypot(a.vx, a.vy), cap = maxV * 1.15;
  if (v > cap) { a.vx *= cap / v; a.vy *= cap / v; }
  a.x += a.vx * dt;
  a.y += a.vy * dt;
}

function follow(a, tx, ty, dt) {
  a.vx += ((tx - a.x) * 700 - a.vx * 50) * dt;
  a.vy += ((ty - a.y) * 700 - a.vy * 50) * dt;
  a.x += a.vx * dt;
  a.y += a.vy * dt;
}

// ---------------------------------------------------------------- phases

function loop(now) {
  if (S.ended) return;
  try {
    const t0 = S.prof ? performance.now() : 0;
    const real = Math.min(0.1, (now - S.last) / 1000);
    S.last = now;
    S.acc += real * rate();
    while (S.acc >= STEP) {
      S.acc -= STEP;
      step(STEP);
      if (S.ended) return;
    }
    render();
    if (S.prof) {
      const ms = performance.now() - t0;
      S.prof.n++;
      S.prof.sum += ms;
      S.prof.max = Math.max(S.prof.max, ms);
      if (ms > 4) S.prof.slow++;
    }
    S.raf = requestAnimationFrame(loop);
  } catch (err) {
    fail(err);
  }
}

function step(dt) {
  S.t += dt;
  if (S.phase === 0 && S.t >= SPLASH) beginReveal();
  if (S.phase === 1 && S.t >= SPLASH + REVEAL) beginBuild();
  if (S.phase === 1 || S.phase === 2) {
    if ((S.tick++ & 3) === 0) {
      schedule();
      if (!S.touring) guard();
    }
    updateWork();
    if (S.done === S.layers.length) beginEnd();
  }
  stepAgents(dt);
  if ((S.phase === 1 || S.phase === 2) && S.touring) stepCamera(dt);
  if (S.phase === 3) stepEnd();
}

function beginReveal() {
  S.phase = 1;
  const cx = ui.wordRect.cx, cy = scrollY + ui.wordRect.cy;
  for (const a of S.agents) {
    a.mode = "idle";
    const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy) || 1;
    a.vx += dx / d * 900;
    a.vy += dy / d * 900;
  }
  openStop(0);
  schedule();
  S.camY = scrollY;
  animate(ui.hud, { opacity: [0, 1], transform: ["translateY(14px)", "none"] },
    { duration: 0.5 / rate(), delay: 0.15 / rate(), ease: [0.2, 0.7, 0.2, 1] });
}

function beginBuild() {
  S.phase = 2;
  ui.splash.remove();
}

function stepCamera(dt) {
  const st = S.stops[S.cur];
  if (!st) return;
  const w0 = 2.2;
  S.camV += (w0 * w0 * (st.camY - S.camY) - 2 * w0 * S.camV) * dt;
  S.camV = clamp(S.camV, -1300, 1300);
  S.camY += S.camV * dt;
}

// Phase 3: the swarm folds into the HUD, the page returns to the top and
// the Lead presses Approve on the demo.
function beginEnd() {
  S.phase = 3;
  S.end = { t: S.t, stage: 0, tour: S.touring };
  animate([ui.board, ui.rx], { opacity: 0 }, { duration: 0.35 / rate() });
  let order = 0;
  for (const a of S.agents) {
    if (a.lead) { a.mode = "idle"; a.hover = [a.x, a.y]; continue; }
    a.homeAt = S.t + 0.08 + order++ * 0.015;
  }
}

function stepEnd() {
  const E = S.end, t = S.t - E.t;
  for (const a of S.agents) {
    if (a.lead || a.mode === "gone") continue;
    if (a.mode !== "home" && S.t >= a.homeAt) a.mode = "home";
    if (a.mode === "home") {
      const r = a.dot.getBoundingClientRect();
      a.tx = r.left + r.width / 2;
      a.ty = scrollY + r.top + r.height / 2;
    }
  }
  const lead = S.agents[0];
  if (E.stage === 0 && (S.agents.every((a) => a.lead || a.mode === "gone") || t > 1.1)) {
    E.stage = 1;
    for (const a of S.agents) if (!a.lead && a.mode !== "gone") collapse(a);
    animate(ui.hud, { opacity: 0, transform: "scale(0.9)" }, { duration: 0.28 / rate() });
    E.t1 = S.t;
  } else if (E.stage === 1 && S.t - E.t1 > 0.3) {
    ui.hudWrap.remove();
    E.stage = 2;
    E.t2 = S.t;
    E.y0 = scrollY;
    E.dur = clamp(0.45 + scrollY / 9000, 0.5, 1.1);
    lead.mode = "pinned";
    lead.tx = lead.x;
    lead.ty = clamp(lead.y - scrollY, 80, S.vh - 120);
  } else if (E.stage === 2) {
    const k = E.tour ? clamp((S.t - E.t2) / E.dur, 0, 1) : 1;
    if (E.tour) scrollTo({ top: E.y0 * (1 - easeInOut(k)), behavior: "instant" });
    if (k >= 1) {
      E.stage = 3;
      const btn = document.querySelector(".demo-approve");
      const r = btn && btn.offsetParent ? btn.getBoundingClientRect() : null;
      if (E.tour && r && r.bottom > 0 && r.top < S.vh) {
        E.btn = btn;
        lead.mode = "approach";
        lead.tx = r.left + r.width * 0.62;
        lead.ty = scrollY + r.top + r.height * 0.6;
      } else {
        E.stage = 5;
        E.t5 = S.t;
      }
    }
  } else if (E.stage === 3 && lead.mode === "arrived") {
    E.stage = 4;
    E.t4 = S.t;
    animate(lead.svg, { transform: ["scale(1)", "scale(0.78)", "scale(1)"] }, { duration: 0.24 / rate() });
    style(E.btn);
    const press = animate(E.btn, {
      transform: ["scale(1)", "scale(0.95)", "scale(1)"],
      boxShadow: ["0 0 0 0px rgb(15 118 110 / 0)", "0 0 0 6px rgb(15 118 110 / 0.28)", "0 0 0 0px rgb(15 118 110 / 0)"],
    }, { duration: 0.5 / rate() });
    press.finished.then(() => restore(E.btn), () => {});
  } else if (E.stage === 4 && S.t - E.t4 > 0.4) {
    E.stage = 5;
    E.t5 = S.t;
  } else if (E.stage === 5) {
    E.stage = 6;
    animate(lead.el, { opacity: 0 }, { duration: 0.3 / rate() }).finished.then(cleanup, cleanup);
  }
}

function collapse(a) {
  a.mode = "gone";
  animate(a.svg, { transform: "scale(0.3)", opacity: 0 }, { duration: 0.2 / rate() });
  animate(a.dot, { transform: ["scale(1.6)", "scale(1)"] }, { type: spring, bounce: 0.5, duration: 0.4 / rate() });
}

// ---------------------------------------------------------------- render

function render() {
  for (const a of S.agents) {
    if (a.mode === "gone" && a.hidden) continue;
    a.el.style.transform = "translate3d(" + (a.x - 2).toFixed(1) + "px," + (a.y - 2).toFixed(1) + "px,0)";
    if (a.mode === "gone") a.hidden = true;
  }
  for (const L of S.active) G[L.g].draw(L, clamp((S.t - L.t0) / L.dur, 0, 1));
  for (const host of S.hosts) if (host.dirty) drawHost(host);
  if (S.phase === 0 || S.phase === 1) drawSplash();
  if (S.touring && (S.phase === 1 || S.phase === 2) && Math.abs(S.camY - scrollY) > 0.5) {
    scrollTo({ top: S.camY, behavior: "instant" });
  }
  if (S.shown !== S.done) {
    S.shown = S.done;
    ui.count.textContent = S.done;
    ui.barFill.style.transform = "scaleX(" + (S.done / S.layers.length).toFixed(4) + ")";
  }
}

// The page's own background opens from the centre and takes the screen.
function drawSplash() {
  if (S.phase === 0) return;
  const k = easeInOut(clamp((S.t - SPLASH) / REVEAL, 0, 1));
  const W = S.vw, H = S.vh, cx = W / 2, cy = H / 2;
  const r = (k * (Math.hypot(W, H) / 2 + 20)).toFixed(1);
  ui.splash.style.clipPath = 'path(evenodd, "M0 0H' + W + "V" + H + "H0Z M" + (cx - r) + " " + cy +
    "a" + r + " " + r + " 0 1 0 " + 2 * r + " 0a" + r + " " + r + " 0 1 0 " + -2 * r + ' 0Z")';
}

// ---------------------------------------------------------------- chrome

function buildChrome() {
  ui.board = h("div", "ib-board", document.body);
  ui.frames = h("div", "ib-frames", ui.board);
  ui.fx = h("div", "ib-fx", ui.board);
  ui.ry = h("div", "ib-ry", ui.board);
  ui.rx = h("div", "ib-rx", document.body);
  ui.splash = h("div", "ib-splash", document.body);
  ui.word = h("p", "ib-word", ui.splash, "starting praxis");
  ui.crowd = h("div", "ib-crowd", document.body);
  for (const el of [ui.board, ui.rx, ui.splash, ui.crowd]) el.setAttribute("aria-hidden", "true");
  const r = ui.word.getBoundingClientRect();
  ui.wordRect = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  animate(ui.word, { opacity: [0, 1] }, { duration: 0.25 });
}

function buildFrames() {
  const H = S.docH + "px";
  ui.board.style.height = H;
  ui.crowd.style.height = H;
  ui.blue = getComputedStyle(root).getPropertyValue("--ib-blue-a").trim().split(/\s+/).join(",");
}

function buildRulers() {
  const tick = (v) => svgUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + (v ? 18 : 100) + '" height="' + (v ? 100 : 18) + '"><path d="' +
    (v ? "M10 .5H18M14 10.5H18M14 20.5H18M14 30.5H18M14 40.5H18M12 50.5H18M14 60.5H18M14 70.5H18M14 80.5H18M14 90.5H18"
       : "M.5 10V18M10.5 14V18M20.5 14V18M30.5 14V18M40.5 14V18M50.5 12V18M60.5 14V18M70.5 14V18M80.5 14V18M90.5 14V18") +
    '" stroke="rgb(' + ui.blue + ')" stroke-opacity=".7"/></svg>');
  ui.rx.style.backgroundImage = tick(false);
  ui.rx.style.backgroundRepeat = "repeat-x";
  ui.ry.style.backgroundImage = tick(true);
  ui.ry.style.backgroundRepeat = "repeat-y";
  ui.ry.style.height = S.docH + "px";
  for (let x = 100; x < S.vw; x += 100) h("span", "", ui.rx, x).style.left = x + "px";
  for (let y = 100; y < S.docH; y += 100) h("span", "", ui.ry, y).style.top = y + "px";
}

function buildHud() {
  ui.hudWrap = h("div", "ib-hud-wrap");
  const skipLink = document.querySelector(".skip");
  if (skipLink) skipLink.after(ui.hudWrap);
  else document.body.prepend(ui.hudWrap);
  ui.hud = h("div", "ib-hud", ui.hudWrap);
  ui.hud.setAttribute("role", "group");
  ui.hud.setAttribute("aria-label", "Page build");

  const n = CONFIG.workers + 1;
  ui.stack = h("button", "ib-stack", ui.hud);
  ui.stack.type = "button";
  ui.stack.setAttribute("aria-expanded", "false");
  ui.stack.setAttribute("aria-controls", "ib-roster");
  ui.stack.setAttribute("aria-label", n + " agents: show the list");
  ui.roster = h("ul", "ib-roster", ui.hud);
  ui.roster.id = "ib-roster";
  ui.stack.addEventListener("click", () => {
    ui.stack.setAttribute("aria-expanded", String(ui.stack.getAttribute("aria-expanded") !== "true"));
  });

  const counts = h("span", "ib-agents", ui.hud);
  counts.innerHTML = '<b></b><span class="ib-word-agents"> agents</span>';
  counts.firstChild.textContent = n;
  const layers = h("span", "", ui.hud);
  layers.innerHTML = '<b>0</b><span class="ib-muted"> / <span></span> layers</span>';
  ui.count = layers.firstChild;
  layers.querySelector(".ib-muted span").textContent = S.layers.length;
  ui.bar = h("span", "ib-bar", ui.hud);
  ui.barFill = h("i", "", ui.bar);

  ui.tour = button("Touring", null, () => setTouring(!S.touring));
  ui.tour.setAttribute("aria-pressed", String(S.touring));
  ui.snd = button("", "Sound", () => setSound(!S.sound));
  ui.snd.classList.add("ib-icon", "ib-snd");
  ui.snd.setAttribute("aria-pressed", String(S.sound));
  ui.snd.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6v4h2.6L8.5 13V3L5.1 6z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8"/></svg>';
  ui.close = button("", "Skip intro", finishNow);
  ui.close.classList.add("ib-icon");
  ui.close.title = "Skip intro (Esc)";
  ui.close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  ui.status = h("p", "sr-only", ui.hudWrap, "The page is drawing itself for a few seconds. Press Escape to skip.");
  ui.status.setAttribute("role", "status");
}

function buildRoster() {
  const shown = 8;
  S.agents.forEach((a, i) => {
    const li = h("li", "", ui.roster);
    const dot = h("span", "ib-dot", li);
    if (!a.lead) dot.style.setProperty("--h", a.hue.toFixed(0));
    h("span", "", li, a.name);
    if (i < shown) {
      a.dot = h("span", "ib-dot", ui.stack);
      if (!a.lead) a.dot.style.setProperty("--h", a.hue.toFixed(0));
    }
  });
  const more = S.agents.length - shown;
  const moreEl = more > 0 ? h("span", "ib-more", ui.stack, "+" + more) : null;
  S.agents.forEach((a, i) => { if (i >= shown) a.dot = moreEl; });
}

function button(text, label, onClick) {
  const b = h("button", "ib-btn", ui.hud, text);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

// ---------------------------------------------------------------- pools

function pool(make) {
  const free = [];
  return {
    get() { const e = free.pop() || make(); e.hidden = false; return e; },
    put(e) { if (e) { e.hidden = true; free.push(e); } },
  };
}

const sels = pool(() => {
  const e = h("div", "ib-sel", ui.fx);
  for (let i = 0; i < 4; i++) h("i", "", e);
  e.chip = h("b", "ib-dim", e);
  return e;
});
const carets = pool(() => h("div", "ib-caret", ui.fx));
const guides = pool(() => h("div", "", ui.fx));

function sel(L, chip) {
  const s = sels.get();
  s.chip.textContent = "";
  selRect(s, L.x, L.y, L.w, L.h, chip);
  return s;
}

function selRect(s, x, y, w, h, chip) {
  place(s, x, y, w, h);
  if (chip) {
    const text = Math.round(w) + " × " + Math.round(h);
    if (s.chip.textContent !== text) s.chip.textContent = text;
  }
}

function place(el, x, y, w, h) {
  el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
  el.style.width = w.toFixed(1) + "px";
  el.style.height = h.toFixed(1) + "px";
}

function guideSet(L) {
  const set = [];
  for (const [cls, x, y] of [["ib-gh", 0, L.y], ["ib-gh", 0, L.y + L.h], ["ib-gv", L.x, 0], ["ib-gv", L.x + L.w, 0]]) {
    const g = guides.get();
    g.className = cls;
    g.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
    set.push(g);
  }
  return set;
}

function dropGuides(L) {
  if (L.guides) L.guides.forEach((g) => guides.put(g));
  L.guides = null;
}

// ---------------------------------------------------------------- controls

function listen() {
  ui.on = [
    [window, "wheel", onScrollIntent, { passive: false }],
    [window, "touchmove", onScrollIntent, { passive: false }],
    [window, "keydown", onKey, false],
    [window, "mousedown", onMouse, false],
    [document, "focusin", onFocus, false],
    [window, "hashchange", () => setTouring(false), false],
    [window, "resize", onResize, false],
  ];
  for (const [t, type, fn, opt] of ui.on) t.addEventListener(type, fn, opt);
  ui.width = S.vw;
}

function unlisten() {
  if (ui.on) for (const [t, type, fn, opt] of ui.on) t.removeEventListener(type, fn, opt);
}

function inHud(e) {
  return !!ui.hudWrap && e.target instanceof Node && ui.hudWrap.contains(e.target);
}

const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function onScrollIntent(e) {
  if (inHud(e)) return;
  if (S.phase < 2 && e.cancelable) { e.preventDefault(); return; }
  if (S.phase === 2) setTouring(false);
}

function onKey(e) {
  if (e.key === "Escape") { finishNow(); return; }
  if (!NAV_KEYS.has(e.key) || inHud(e)) return;
  if (S.phase === 2) setTouring(false);
}

function onMouse(e) {
  if (S.phase === 2 && e.clientX >= root.clientWidth) setTouring(false);
}

function onFocus(e) {
  if (S.phase === 2 && e.target !== document.body && !inHud(e)) setTouring(false);
}

function onResize() {
  if (root.clientWidth !== ui.width) finishNow();
  else S.vh = innerHeight;
}

function setTouring(on) {
  if (S.touring === on) return;
  S.touring = on;
  ui.tour.setAttribute("aria-pressed", String(on));
  const workers = S.agents.filter((a) => !a.lead && a.mode !== "gone");
  if (on) {
    S.camY = scrollY;
    S.camV = 0;
    for (const a of workers) a.detached = false;
    for (const L of S.layers) L.seen = undefined;
    return;
  }
  const mid = scrollY + S.vh / 2;
  workers.sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid));
  for (const a of workers.slice(0, 6)) {
    a.detached = true;
    if (a.mode === "travel") release(a.L);
  }
}

let audio = null, lastTick = 0;
function setSound(on) {
  S.sound = on;
  ui.snd.setAttribute("aria-pressed", String(on));
  if (on && !audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }
}

function tick() {
  if (!S.sound || !audio) return;
  const now = audio.currentTime;
  if (now - lastTick < 0.035) return;
  lastTick = now;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = 1500 + Math.random() * 900;
  g.gain.setValueAtTime(0.02, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  o.connect(g).connect(audio.destination);
  o.start(now);
  o.stop(now + 0.06);
}

// ---------------------------------------------------------------- endings

// Skip: the finished page at once.
function finishNow() {
  if (S.ended) return;
  const toTop = S.touring || S.phase < 2;
  for (const el of touched.keys()) {
    for (const an of el.getAnimations({ subtree: true })) {
      if (typeof CSSAnimation !== "undefined" && an instanceof CSSAnimation) { if (an.effect && an.effect.getTiming().iterations !== Infinity) an.finish(); }
      else an.cancel();
    }
  }
  cleanup();
  if (toTop) scrollTo({ top: 0, behavior: "instant" });
}

function cleanup() {
  if (S.ended) return;
  S.ended = true;
  cancelAnimationFrame(S.raf);
  unlisten();
  for (const el of [...touched.keys()]) restore(el);
  for (const el of [ui.board, ui.rx, ui.splash, ui.crowd, ui.hudWrap, ui.css]) if (el) el.remove();
  root.classList.remove("intro-on", "intro-cover");
  if (audio) audio.close();
  // Motion writes an empty style attribute back when its animations settle;
  // remove those so the page's markup is exactly what was served.
  const sweep = () => {
    for (const el of everTouched) if (el.getAttribute("style") === "") el.removeAttribute("style");
  };
  sweep();
  setTimeout(sweep, 800);
}

function fail(err) {
  console.error("Intro stopped:", err);
  finishNow();
}

// ---------------------------------------------------------------- helpers

function style(el) {
  if (!touched.has(el)) touched.set(el, el.getAttribute("style"));
  everTouched.add(el);
  return el.style;
}

function restore(el) {
  if (!touched.has(el)) return;
  const s = touched.get(el);
  if (s === null) el.removeAttribute("style");
  else el.setAttribute("style", s);
  touched.delete(el);
}

function docRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
}

function alpha(c) {
  if (!c || c === "transparent") return 0;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const p = m[1].split(/[\s,/]+/).filter(Boolean);
  return p.length > 3 ? parseFloat(p[3]) : 1;
}

function h(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function svgUrl(svg) {
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}

function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The build runs at SPEED; the splash, the reveal and the ending at 1.
function rate() { return S.phase === 2 ? S.speed : 1; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
function easeInOut(k) { return ease(k); }
function easeOut(k) { return 1 - Math.pow(1 - k, 3); }
