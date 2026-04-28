import type { ContainerSize } from "./types";

export type Drawer = (ctx: CanvasRenderingContext2D, size: ContainerSize) => void;

export interface Sample {
  ar: number;             // aspect ratio (w / h)
  draw: Drawer;
}

// Each sample uses a transparent fill so the live canvas inherits the theme bg.
// The pixel-color sampler still finds opaque pixels everywhere artwork sits.
function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}

// ─── 1. REVEAL — bold display text on a deep warm bg, gradient fill.
const drawReveal: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  // Warm midnight bg so spaces around the letters are an intentional color
  // (rather than alpha-zero voids when balls sample those pixels).
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#1a0f24");
  bg.addColorStop(1, "#2a1410");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0.00, "#ff6b3d");
  grad.addColorStop(0.30, "#ffb347");
  grad.addColorStop(0.55, "#ffe26a");
  grad.addColorStop(0.78, "#7bd1c4");
  grad.addColorStop(1.00, "#a98ce6");
  ctx.fillStyle = grad;
  // Scale text to whichever dimension is binding so REVEAL never overflows
  // a narrow tile but still feels bold in a wide hero canvas.
  const fontSize = Math.min(w * 0.21, h * 0.78);
  ctx.font = `900 ${fontSize}px "Geist", -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("REVEAL", w / 2, h * 0.54);
};

// ─── 2. SUNSET — warm horizon with a black sun and a horizon line.
const drawSunset: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, "#2a1a3d");
  sky.addColorStop(0.25, "#7a2858");
  sky.addColorStop(0.55, "#ec5e3b");
  sky.addColorStop(0.80, "#ffb15c");
  sky.addColorStop(1.00, "#ffd98a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Sun
  const sunR = Math.min(w, h) * 0.22;
  const sunY = h * 0.62;
  const sunX = w * 0.5;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0814";
  ctx.fill();
  // Horizon stripes — five thin warm bands cutting across the sun.
  const bandH = sunR * 0.16;
  const palette = ["#ffd98a", "#ffb15c", "#ec5e3b", "#7a2858", "#2a1a3d"];
  for (let i = 0; i < palette.length; i++) {
    ctx.fillStyle = palette[i];
    const y = sunY + sunR * 0.22 + i * bandH * 1.7;
    ctx.fillRect(0, y, w, bandH);
  }
};

// ─── 3. RISO — three overlapping risograph circles, screen-printed feel.
const drawRiso: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  ctx.fillStyle = "#f4ecdc"; // warm paper
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.34;
  const off = r * 0.55;
  const circles = [
    { x: cx - off, y: cy - off * 0.35, c: "#ff5a5a" },
    { x: cx + off, y: cy - off * 0.35, c: "#ffd84a" },
    { x: cx,       y: cy + off * 0.65, c: "#3aa3ff" },
  ];
  ctx.globalCompositeOperation = "multiply";
  for (const { x, y, c } of circles) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
};

// ─── 4. SPECTRUM — vertical color bars, like a Bauhaus poster.
const drawSpectrum: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  const colors = [
    "#1f3b8b", "#3aa3ff", "#7bd1c4", "#ffe26a",
    "#ffb347", "#ff6b3d", "#d63a59", "#7a2858",
  ];
  const bw = w / colors.length;
  for (let i = 0; i < colors.length; i++) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colors[i]);
    grad.addColorStop(1, shade(colors[i], -0.3));
    ctx.fillStyle = grad;
    ctx.fillRect(i * bw, 0, bw + 0.5, h);
  }
};

// ─── 5. TOPO — concentric topographic contour lines with a single accent.
const drawTopo: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  const cx = w * 0.45, cy = h * 0.55;
  const maxR = Math.hypot(w, h) * 0.55;
  // Background warm wash
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  bg.addColorStop(0, "#f4e7d0");
  bg.addColorStop(1, "#e2c89a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Rings — irregular pseudo-organic
  ctx.lineWidth = Math.max(1.4, Math.min(w, h) * 0.0035);
  for (let i = 1; i <= 14; i++) {
    const r = (i / 14) * maxR;
    ctx.beginPath();
    const segs = 80;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const noise = Math.sin(a * 3 + i * 0.7) * (r * 0.04) + Math.cos(a * 2 + i) * (r * 0.03);
      const rr = r + noise;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.85;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const t = i / 14;
    ctx.strokeStyle = i === 8 ? "#d94616" : `rgba(50, 30, 14, ${0.18 + t * 0.45})`;
    ctx.lineWidth = i === 8 ? 2.4 : 1.2;
    ctx.stroke();
  }
};

// ─── 6. BLOOM — abstract floral, three layered petals in saturated jewel tones.
const drawBloom: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  const bg = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)*0.7);
  bg.addColorStop(0, "#1a0e2a");
  bg.addColorStop(1, "#06030f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const layers = [
    { petals: 12, R: Math.min(w,h)*0.46, color: "#5a1f7a" },
    { petals: 10, R: Math.min(w,h)*0.34, color: "#d63a59" },
    { petals: 8,  R: Math.min(w,h)*0.22, color: "#ffb347" },
  ];
  for (const { petals, R, color } of layers) {
    for (let i = 0; i < petals; i++) {
      const ang = (i / petals) * Math.PI * 2;
      const x = cx + Math.cos(ang) * R * 0.45;
      const y = cy + Math.sin(ang) * R * 0.45;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R * 0.55);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, R * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Center pollen
  ctx.fillStyle = "#ffe26a";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w,h)*0.05, 0, Math.PI * 2);
  ctx.fill();
};

function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.min(255, Math.round(r + 255 * amt)));
  g = Math.max(0, Math.min(255, Math.round(g + 255 * amt)));
  b = Math.max(0, Math.min(255, Math.round(b + 255 * amt)));
  return `rgb(${r},${g},${b})`;
}

export const SAMPLES: Record<string, Sample> = {
  reveal:   { ar: 720 / 200, draw: drawReveal },
  sunset:   { ar: 720 / 480, draw: drawSunset },
  riso:     { ar: 1,         draw: drawRiso },
  spectrum: { ar: 720 / 360, draw: drawSpectrum },
  topo:     { ar: 1,         draw: drawTopo },
  bloom:    { ar: 1,         draw: drawBloom },
};

export interface UploadResult {
  drawer: Drawer;
  ar: number;
}
export function makeUploadDrawer(img: HTMLImageElement): UploadResult {
  const ar = img.width / img.height;
  const drawer: Drawer = (ctx, { w, h }) => {
    clear(ctx, w, h);
    const cAR = w / h;
    let dw, dh;
    if (ar > cAR) { dw = w; dh = w / ar; }
    else          { dh = h; dw = h * ar; }
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  };
  return { drawer, ar };
}
