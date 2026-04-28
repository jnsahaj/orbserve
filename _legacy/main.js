// ──────────────────────────────────────────────────────────────────────────
// Orbserve — physics-fountain image simulator
//
// Pieces:
//   · Image source: file upload OR a built-in sample (text/emoji rendered
//     to an offscreen canvas). The HTML-in-canvas path is gone now.
//   · Physics: Rapier 2D SIMD in a Web Worker (worker.js). Returns a
//     quantized Uint16 record of every ball's position at every frame.
//   · Renderer: PixiJS v8 ParticleContainer (instanced quads, ~6-figure
//     particle counts at interactive frame rates).
//   · Visual hole editor: SVG overlay over the sim. Drag holes along
//     container edges, drag rotator handle to set launch angle, click
//     empty edge to add, right-click to delete. Snaps to a 5% grid.
// ──────────────────────────────────────────────────────────────────────────

import {
  Application,
  ParticleContainer,
  Particle,
  Texture,
  Sprite,
} from "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs";

const SRC_W = 720;
const SRC_H = 480;

const params = {
  BALLS_PER_FRAME: 5,
  SPAWN_FRAMES: 260,
  SETTLE_FRAMES: 200,
  LAUNCH_SPEED_MAX: 20,
  LAUNCH_CONE: 0.85,
  BALL_RADIUS: 6,
  RESTITUTION: 0.05,
  BALL_FRICTION: 0.12,
  GRAVITY: 1.0,
};

// Hole list. Each hole:
//   side:   "bottom" | "top" | "left" | "right"
//   offset: 0..1 along that wall
//   width:  px wide spawn band
//   angle:  degrees from inward normal (+ rotates clockwise)
let holes = [
  { side: "bottom", offset: 0.5, width: 100, angle: 0 },
];
let selectedHole = -1;

// Computed each Replay; sourced from the SVG overlay.
function getContainerBounds() {
  const W = window.innerWidth, H = window.innerHeight;
  return {
    left: W / 2 - SRC_W / 2,
    top: H / 2 - SRC_H / 2,
    width: SRC_W,
    height: SRC_H,
  };
}

// ── Slider wiring ────────────────────────────────────────────────────────
const SLIDER_MAP = [
  ["s_bpf",      "BALLS_PER_FRAME",  (v) => v.toString(),  (s) => parseInt(s, 10)],
  ["s_spawn",    "SPAWN_FRAMES",     (v) => v.toString(),  (s) => parseInt(s, 10)],
  ["s_settle",   "SETTLE_FRAMES",    (v) => v.toString(),  (s) => parseInt(s, 10)],
  ["s_speed",    "LAUNCH_SPEED_MAX", (v) => v.toString(),  (s) => parseInt(s, 10)],
  ["s_cone",     "LAUNCH_CONE",      (v) => v.toFixed(2),  (s) => parseFloat(s)],
  ["s_radius",   "BALL_RADIUS",      (v) => v.toString(),  (s) => parseInt(s, 10)],
  ["s_rest",     "RESTITUTION",      (v) => v.toFixed(2),  (s) => parseFloat(s)],
  ["s_friction", "BALL_FRICTION",    (v) => v.toFixed(2),  (s) => parseFloat(s)],
  ["s_gravity",  "GRAVITY",          (v) => v.toFixed(2),  (s) => parseFloat(s)],
];
const totalEl = document.getElementById("s_total");
function syncSliderDisplay() {
  for (const [id, key, fmt, parse] of SLIDER_MAP) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(id + "_v");
    const v = parse(el.value);
    params[key] = v;
    valEl.textContent = fmt(v);
  }
  totalEl.textContent =
    (params.BALLS_PER_FRAME * params.SPAWN_FRAMES).toLocaleString();
  markDirty();
}
for (const [id] of SLIDER_MAP) {
  document.getElementById(id).addEventListener("input", syncSliderDisplay);
}
syncSliderDisplay();

// ── Image source ─────────────────────────────────────────────────────────
const srcCanvas = document.createElement("canvas");
srcCanvas.width = SRC_W;
srcCanvas.height = SRC_H;
const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });

const SAMPLES = {
  orbserve: (ctx) => {
    ctx.fillStyle = "#06070d";
    ctx.fillRect(0, 0, SRC_W, SRC_H);
    const grad = ctx.createLinearGradient(0, 0, SRC_W, 0);
    grad.addColorStop(0,    "#ff8a6b");
    grad.addColorStop(0.4,  "#ffd36b");
    grad.addColorStop(0.75, "#6bd8ff");
    grad.addColorStop(1,    "#c49bff");
    ctx.fillStyle = grad;
    ctx.font = "900 168px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ORBSERVE", SRC_W / 2, SRC_H / 2);
  },
  heart:  (ctx) => emojiSample(ctx, "❤️"),
  star:   (ctx) => emojiSample(ctx, "⭐"),
  rocket: (ctx) => emojiSample(ctx, "🚀"),
};

function emojiSample(ctx, emoji) {
  ctx.fillStyle = "#06070d";
  ctx.fillRect(0, 0, SRC_W, SRC_H);
  ctx.font = '300px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, SRC_W / 2, SRC_H / 2);
}

function makeUploadDrawer(img) {
  return (ctx) => {
    ctx.fillStyle = "#06070d";
    ctx.fillRect(0, 0, SRC_W, SRC_H);
    const ar = img.width / img.height;
    const cAR = SRC_W / SRC_H;
    let dw, dh;
    if (ar > cAR) { dw = SRC_W; dh = SRC_W / ar; }
    else          { dh = SRC_H; dw = SRC_H * ar; }
    ctx.drawImage(img, (SRC_W - dw) / 2, (SRC_H - dh) / 2, dw, dh);
  };
}

let currentDrawer = SAMPLES.orbserve;
function renderSource() {
  srcCtx.clearRect(0, 0, SRC_W, SRC_H);
  currentDrawer(srcCtx);
}
renderSource();

// Image picker UI
const picker = document.querySelector(".image-picker");
function selectPickerBtn(btn) {
  picker.querySelectorAll(".img-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
}
picker.querySelectorAll(".img-btn[data-sample]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.sample;
    if (!SAMPLES[key]) return;
    currentDrawer = SAMPLES[key];
    selectPickerBtn(btn);
    onImageChanged();
  });
});
// Default selection
picker.querySelector('[data-sample="orbserve"]').classList.add("selected");

document.getElementById("img-upload").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      currentDrawer = makeUploadDrawer(img);
      selectPickerBtn(picker.querySelector('label.img-btn'));
      onImageChanged();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// When image changes, just rebake colors against the cached record. No
// recompute needed — the physics is independent of image color.
function onImageChanged() {
  renderSource();
  if (recX) {
    const colored = bakeColors();
    countEl.textContent = colored.toLocaleString();
    if (!playing) drawFrameAt(Math.max(0, Math.min(frameIdx, recTotal - 1)));
  }
}

// ── Pixi setup ───────────────────────────────────────────────────────────
const sim = document.getElementById("sim");
const phaseEl = document.getElementById("phase");
const seedEl = document.getElementById("seedVal");
const countEl = document.getElementById("particleCount");

phaseEl.textContent = "loading renderer";
const app = new Application();
await app.init({
  canvas: sim,
  resizeTo: window,
  background: 0x05060a,
  antialias: false,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  preference: "webgpu",
});

// Pre-rendered white circle texture, tinted per particle.
const CIRCLE_TEX_SIZE = 64;
const circleCanvas = document.createElement("canvas");
circleCanvas.width = circleCanvas.height = CIRCLE_TEX_SIZE;
{
  const c = circleCanvas.getContext("2d");
  const cx = CIRCLE_TEX_SIZE / 2;
  c.beginPath();
  c.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  c.fillStyle = "#ffffff";
  c.fill();
}
const circleTexture = Texture.from(circleCanvas);

const particleContainer = new ParticleContainer({
  dynamicProperties: { position: true, scale: false, tint: false, rotation: false },
});
app.stage.addChild(particleContainer);
let domSprite = null;
app.ticker.stop();

// ── Worker ───────────────────────────────────────────────────────────────
let worker = null;
function getWorker() {
  if (!worker) worker = new Worker("./worker.js", { type: "module" });
  return worker;
}

// ── Sim record + Pixi particle state ─────────────────────────────────────
let recX = null, recY = null, recScale = 1, recN = 0, recTotal = 0;
let visible = null;
let pixiParticles = null;

let containerLeft = 0, containerTop = 0;
let seed = (Math.random() * 1e9) | 0;
let frameIdx = 0;
let playing = false;

// dirty = some param changed since last precompute. Replay button checks
// this to decide between recompute vs cached replay.
let dirty = true;
function markDirty() { dirty = true; }

// ── Color baking + Pixi materialization ──────────────────────────────────
function bakeColors() {
  renderSource();
  const data = srcCtx.getImageData(0, 0, SRC_W, SRC_H).data;

  if (!pixiParticles || pixiParticles.length !== recN) {
    if (pixiParticles) {
      for (const p of pixiParticles) if (p) particleContainer.removeParticle(p);
    }
    pixiParticles = new Array(recN);
    visible = new Uint8Array(recN);
  } else {
    visible.fill(0);
  }

  const lastOff = (recTotal - 1) * recN;
  const radiusScale = (params.BALL_RADIUS * 2) / CIRCLE_TEX_SIZE;
  let colored = 0;
  for (let i = 0; i < recN; i++) {
    const qx = recX[lastOff + i];
    const qy = recY[lastOff + i];
    if (qx === 0 && qy === 0) continue;
    const x = qx / recScale, y = qy / recScale;
    const ix = (x - containerLeft) | 0;
    const iy = (y - containerTop) | 0;
    if (ix < 0 || ix >= SRC_W || iy < 0 || iy >= SRC_H) continue;
    const pi = (iy * SRC_W + ix) * 4;
    if (data[pi + 3] < 32) continue;
    const r = data[pi], g = data[pi + 1], b = data[pi + 2];
    let p = pixiParticles[i];
    if (!p) {
      p = new Particle({
        texture: circleTexture,
        x: -9999, y: -9999,
        scaleX: radiusScale, scaleY: radiusScale,
        anchorX: 0.5, anchorY: 0.5,
        tint: (r << 16) | (g << 8) | b,
      });
      particleContainer.addParticle(p);
      pixiParticles[i] = p;
    } else {
      p.tint = (r << 16) | (g << 8) | b;
      p.scaleX = p.scaleY = radiusScale;
    }
    visible[i] = 1;
    colored++;
  }
  for (let i = 0; i < recN; i++) {
    if (!visible[i] && pixiParticles[i]) {
      particleContainer.removeParticle(pixiParticles[i]);
      pixiParticles[i] = null;
    }
  }
  return colored;
}

// ── Playback ─────────────────────────────────────────────────────────────
function drawFrameAt(f) {
  if (!recX) return;
  const off = f * recN;
  const inv = 1 / recScale;
  for (let i = 0; i < recN; i++) {
    const p = pixiParticles[i];
    if (!p) continue;
    const qx = recX[off + i];
    const qy = recY[off + i];
    if (qx === 0 && qy === 0) {
      p.x = -9999; p.y = -9999;
    } else {
      p.x = qx * inv;
      p.y = qy * inv;
    }
  }
  app.renderer.render(app.stage);
}

function loop() {
  if (!playing) return;
  drawFrameAt(frameIdx);
  frameIdx++;
  if (frameIdx >= recTotal) {
    playing = false;
    finalizeComposite();
    return;
  }
  requestAnimationFrame(loop);
}

function finalizeComposite() {
  phaseEl.textContent = "settled";
  if (domSprite) {
    app.stage.removeChild(domSprite);
    domSprite.destroy();
  }
  const tex = Texture.from(srcCanvas);
  tex.source.update?.();
  domSprite = new Sprite(tex);
  domSprite.x = containerLeft;
  domSprite.y = containerTop;
  domSprite.width = SRC_W;
  domSprite.height = SRC_H;
  domSprite.alpha = 0;
  app.stage.addChild(domSprite);

  let alpha = 0;
  function fadeIn() {
    alpha += 0.05;
    if (alpha > 1) alpha = 1;
    domSprite.alpha = alpha;
    drawFrameAt(recTotal - 1);
    if (alpha < 1) requestAnimationFrame(fadeIn);
  }
  fadeIn();
}

// ── Drive the worker, then play ──────────────────────────────────────────
function start() {
  playing = false;
  if (domSprite) {
    app.stage.removeChild(domSprite);
    domSprite.destroy();
    domSprite = null;
  }
  seedEl.textContent = seed;
  phaseEl.textContent = "precomputing 0%";

  const b = getContainerBounds();
  containerLeft = b.left;
  containerTop = b.top;

  const w = getWorker();
  w.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "ready") return;
    if (msg.type === "progress") {
      phaseEl.textContent = `precomputing ${msg.pct}%`;
    } else if (msg.type === "error") {
      phaseEl.textContent = "error";
      console.error("[worker]", msg.message);
    } else if (msg.type === "done") {
      recX = msg.recX;
      recY = msg.recY;
      recScale = msg.scale;
      recN = msg.N;
      recTotal = msg.TOTAL;
      const colored = bakeColors();
      countEl.textContent = colored.toLocaleString();
      console.log(
        `[precompute] ${msg.elapsedMs.toFixed(0)}ms · ${recN.toLocaleString()} balls × ${recTotal} frames · ${colored.toLocaleString()} colored`,
      );
      frameIdx = 0;
      playing = true;
      dirty = false;
      phaseEl.textContent = "fountaining";
      requestAnimationFrame(loop);
    }
  };

  w.postMessage({
    type: "precompute",
    seed,
    params: { ...params, holes: holes.map((h) => ({ ...h })) },
    viewport: { W: window.innerWidth, H: window.innerHeight },
  });
}

function replayFromCache() {
  if (!recX || dirty) return start();
  playing = false;
  if (domSprite) {
    app.stage.removeChild(domSprite);
    domSprite.destroy();
    domSprite = null;
  }
  frameIdx = 0;
  playing = true;
  phaseEl.textContent = "fountaining";
  requestAnimationFrame(loop);
}
document.getElementById("replay").onclick = () => replayFromCache();
document.getElementById("reseed").onclick = () => {
  seed = (Math.random() * 1e9) | 0;
  start();
};

window.addEventListener("resize", () => {
  markDirty();
  renderEditor();
  start();
});

// Keyboard shortcuts.
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "r") replayFromCache();
  if (e.key === "n") { seed = (Math.random() * 1e9) | 0; start(); }
  if ((e.key === "Backspace" || e.key === "Delete") && selectedHole >= 0 && holes.length > 1) {
    holes.splice(selectedHole, 1);
    selectedHole = -1;
    renderHoles(); renderEditor(); markDirty();
  }
});

// ── Holes panel ──────────────────────────────────────────────────────────
const holesListEl = document.getElementById("holes-list");
function renderHoles() {
  holesListEl.innerHTML = "";
  holes.forEach((h, idx) => {
    const row = document.createElement("div");
    row.className = "hole-row" + (idx === selectedHole ? " selected" : "");
    row.dataset.holeIdx = idx;
    row.innerHTML = `
      <select class="hole-side" title="side">
        <option value="bottom">bottom</option>
        <option value="top">top</option>
        <option value="left">left</option>
        <option value="right">right</option>
      </select>
      <input type="range" class="hole-offset" min="0" max="100" value="${(h.offset * 100) | 0}" title="offset along edge">
      <input type="number" class="hole-width"  min="10" max="600" step="2" value="${h.width}" title="width (px)">
      <input type="number" class="hole-angle"  min="-90" max="90" step="5" value="${h.angle | 0}" title="angle (°)">
      <button class="remove-btn" title="remove">×</button>
    `;
    row.querySelector(".hole-side").value = h.side;
    row.querySelector(".hole-side").onchange = (e) => {
      holes[idx].side = e.target.value; markDirty(); renderEditor();
    };
    row.querySelector(".hole-offset").oninput = (e) => {
      holes[idx].offset = parseInt(e.target.value, 10) / 100;
      markDirty(); renderEditor();
    };
    row.querySelector(".hole-width").oninput = (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) { holes[idx].width = v; markDirty(); renderEditor(); }
    };
    row.querySelector(".hole-angle").oninput = (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) { holes[idx].angle = v; markDirty(); renderEditor(); }
    };
    row.querySelector(".remove-btn").onclick = (ev) => {
      ev.stopPropagation();
      if (holes.length === 1) return;
      holes.splice(idx, 1);
      if (selectedHole === idx) selectedHole = -1;
      else if (selectedHole > idx) selectedHole--;
      renderHoles(); renderEditor(); markDirty();
    };
    row.addEventListener("click", () => {
      selectedHole = idx;
      renderHoles(); renderEditor();
    });
    holesListEl.appendChild(row);
  });
}
document.getElementById("add-hole").onclick = () => {
  const sides = ["bottom", "top", "left", "right"];
  const next = sides[holes.length % sides.length];
  holes.push({ side: next, offset: 0.5, width: 100, angle: 0 });
  selectedHole = holes.length - 1;
  renderHoles(); renderEditor(); markDirty();
};
renderHoles();

// ── Visual hole editor (SVG) ─────────────────────────────────────────────
const editorEl = document.getElementById("editor");
const SVG_NS = "http://www.w3.org/2000/svg";
const hintEl = document.getElementById("editor-hint");
let hintTimer = null;
function showHint(text, ms = 1400) {
  hintEl.textContent = text;
  hintEl.classList.add("visible");
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove("visible"), ms);
}

const baseAngles = {
  bottom: -Math.PI / 2,  // launch up
  top:     Math.PI / 2,  // launch down
  left:    0,            // launch right
  right:   Math.PI,      // launch left
};

function holeCenter(h, b) {
  switch (h.side) {
    case "bottom": return { x: b.left + h.offset * b.width, y: b.top + b.height };
    case "top":    return { x: b.left + h.offset * b.width, y: b.top };
    case "left":   return { x: b.left,                       y: b.top + h.offset * b.height };
    case "right":  return { x: b.left + b.width,             y: b.top + h.offset * b.height };
  }
}
function holeTangent(h) {
  return (h.side === "bottom" || h.side === "top") ? { x: 1, y: 0 } : { x: 0, y: 1 };
}
function holeNormal(h) {
  switch (h.side) {
    case "bottom": return { x: 0, y: -1 };
    case "top":    return { x: 0, y:  1 };
    case "left":   return { x: 1, y:  0 };
    case "right":  return { x: -1, y: 0 };
  }
}
function rotate(v, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function renderEditor() {
  editorEl.setAttribute("width", window.innerWidth);
  editorEl.setAttribute("height", window.innerHeight);
  while (editorEl.firstChild) editorEl.removeChild(editorEl.firstChild);
  const b = getContainerBounds();

  // Container outline.
  const outline = document.createElementNS(SVG_NS, "rect");
  outline.setAttribute("class", "container-outline");
  outline.setAttribute("x", b.left); outline.setAttribute("y", b.top);
  outline.setAttribute("width", b.width); outline.setAttribute("height", b.height);
  editorEl.appendChild(outline);

  // Edge hit zones — click to add a hole.
  const edges = [
    ["bottom", b.left, b.top + b.height,        b.left + b.width, b.top + b.height],
    ["top",    b.left, b.top,                   b.left + b.width, b.top],
    ["left",   b.left, b.top,                   b.left,            b.top + b.height],
    ["right",  b.left + b.width, b.top,         b.left + b.width,  b.top + b.height],
  ];
  for (const [side, x1, y1, x2, y2] of edges) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "edge-hit");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.dataset.side = side;
    line.addEventListener("click", (ev) => {
      const offset = projectOffset(side, ev.clientX, ev.clientY, b);
      holes.push({ side, offset: snapOffset(offset, ev.shiftKey), width: 100, angle: 0 });
      selectedHole = holes.length - 1;
      renderHoles(); renderEditor(); markDirty();
      showHint("hole added — drag to move, drag arrow to rotate, right-click to delete");
    });
    editorEl.appendChild(line);
  }

  // Holes themselves.
  holes.forEach((h, idx) => {
    const c = holeCenter(h, b);
    const tang = holeTangent(h);
    const norm = holeNormal(h);
    const halfW = h.width / 2;
    // Band rectangle along the edge, slightly inset into the container.
    const insetIn = 6;  // px deep
    const bandLen = h.width;
    const bandW = 8;
    const bandCx = c.x;
    const bandCy = c.y;
    // Rectangle aligned with tangent.
    const sx = bandCx - tang.x * halfW + norm.x * (-bandW / 2);
    const sy = bandCy - tang.y * halfW + norm.y * (-bandW / 2);

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "hole-group" + (idx === selectedHole ? " selected" : ""));
    g.dataset.holeIdx = idx;

    // Band: rotated rect via transform.
    const angleDeg = Math.atan2(tang.y, tang.x) * 180 / Math.PI;
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "hole-band");
    rect.setAttribute("x", -halfW);
    rect.setAttribute("y", -bandW / 2);
    rect.setAttribute("width", bandLen);
    rect.setAttribute("height", bandW);
    rect.setAttribute("rx", 2);
    rect.setAttribute("ry", 2);
    rect.setAttribute("transform", `translate(${bandCx},${bandCy}) rotate(${angleDeg})`);
    g.appendChild(rect);

    // Direction arrow (inward normal + per-hole angle).
    const launchAngle = baseAngles[h.side] + (h.angle || 0) * Math.PI / 180;
    const dir = { x: Math.cos(launchAngle), y: Math.sin(launchAngle) };
    const arrowLen = 36;
    const ax = c.x + dir.x * arrowLen;
    const ay = c.y + dir.y * arrowLen;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "hole-arrow");
    line.setAttribute("x1", c.x); line.setAttribute("y1", c.y);
    line.setAttribute("x2", ax);  line.setAttribute("y2", ay);
    g.appendChild(line);
    // Arrowhead (tiny triangle).
    const head = document.createElementNS(SVG_NS, "polygon");
    head.setAttribute("class", "hole-arrowhead");
    const perp = { x: -dir.y, y: dir.x };
    const hx1 = ax;
    const hy1 = ay;
    const hx2 = ax - dir.x * 7 + perp.x * 4;
    const hy2 = ay - dir.y * 7 + perp.y * 4;
    const hx3 = ax - dir.x * 7 - perp.x * 4;
    const hy3 = ay - dir.y * 7 - perp.y * 4;
    head.setAttribute("points", `${hx1},${hy1} ${hx2},${hy2} ${hx3},${hy3}`);
    g.appendChild(head);
    // Rotator handle: a small circle at the tip of the arrow.
    const rot = document.createElementNS(SVG_NS, "circle");
    rot.setAttribute("class", "hole-rotator");
    rot.setAttribute("cx", ax); rot.setAttribute("cy", ay); rot.setAttribute("r", 6);
    g.appendChild(rot);

    // Interaction.
    g.addEventListener("pointerdown", (ev) => beginHoleDrag(ev, idx, b));
    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      if (holes.length === 1) return;
      holes.splice(idx, 1);
      if (selectedHole === idx) selectedHole = -1;
      else if (selectedHole > idx) selectedHole--;
      renderHoles(); renderEditor(); markDirty();
    });
    rot.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      beginRotateDrag(ev, idx, b);
    });

    editorEl.appendChild(g);
  });
}

function projectOffset(side, x, y, b) {
  if (side === "bottom" || side === "top") return clamp((x - b.left) / b.width, 0, 1);
  return clamp((y - b.top) / b.height, 0, 1);
}
function clamp(v, a, c) { return Math.max(a, Math.min(c, v)); }
function snapOffset(v, free) {
  if (free) return v;
  return Math.round(v * 20) / 20;   // 5% grid
}

function nearestSide(x, y, b) {
  // Distances to each edge.
  const dB = Math.abs(y - (b.top + b.height));
  const dT = Math.abs(y - b.top);
  const dL = Math.abs(x - b.left);
  const dR = Math.abs(x - (b.left + b.width));
  const inX = x >= b.left && x <= b.left + b.width;
  const inY = y >= b.top  && y <= b.top  + b.height;
  // Prefer horizontal sides when inside x-range, vertical when inside y.
  let candidates = [];
  if (inX) candidates.push(["bottom", dB], ["top", dT]);
  if (inY) candidates.push(["left", dL], ["right", dR]);
  if (candidates.length === 0) candidates = [["bottom", dB], ["top", dT], ["left", dL], ["right", dR]];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

function beginHoleDrag(ev, idx, b) {
  ev.preventDefault();
  selectedHole = idx;
  renderHoles();
  const g = editorEl.querySelector(`.hole-group[data-hole-idx="${idx}"]`);
  g?.classList.add("dragging");

  function move(e) {
    const side = nearestSide(e.clientX, e.clientY, b);
    const offset = projectOffset(side, e.clientX, e.clientY, b);
    holes[idx].side = side;
    holes[idx].offset = snapOffset(clamp(offset, 0, 1), e.shiftKey);
    markDirty(); renderHoles(); renderEditor();
  }
  function up() {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
  }
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

function beginRotateDrag(ev, idx, b) {
  ev.preventDefault();
  selectedHole = idx;
  renderHoles();

  function move(e) {
    const h = holes[idx];
    const c = holeCenter(h, b);
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    let abs = Math.atan2(dy, dx);
    let rel = (abs - baseAngles[h.side]) * 180 / Math.PI;
    // Wrap to (-180, 180]
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    rel = clamp(rel, -90, 90);
    if (!e.shiftKey) rel = Math.round(rel / 5) * 5;   // 5° snap
    holes[idx].angle = rel;
    markDirty(); renderHoles(); renderEditor();
  }
  function up() {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
  }
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

renderEditor();

// ── Bootstrap ────────────────────────────────────────────────────────────
async function bootstrapStart() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  start();
}
bootstrapStart();
