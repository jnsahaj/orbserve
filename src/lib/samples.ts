import type { ContainerSize } from "./types";

export type Drawer = (ctx: CanvasRenderingContext2D, size: ContainerSize) => void;

export interface Sample {
  ar: number;
  draw: Drawer;
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}

const drawReveal: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
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
  // min(w*..., h*...) so REVEAL fits both wide hero canvases and narrow tiles.
  const fontSize = Math.min(w * 0.21, h * 0.78);
  ctx.font = `900 ${fontSize}px "Geist", -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("REVEAL", w / 2, h * 0.54);
};

const drawSunset: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, "#2a1a3d");
  sky.addColorStop(0.25, "#7a2858");
  sky.addColorStop(0.55, "#ec5e3b");
  sky.addColorStop(0.80, "#ffb15c");
  sky.addColorStop(1.00, "#ffd98a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sunR = Math.min(w, h) * 0.22;
  const sunY = h * 0.62;
  ctx.beginPath();
  ctx.arc(w * 0.5, sunY, sunR, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0814";
  ctx.fill();
  const bandH = sunR * 0.16;
  const palette = ["#ffd98a", "#ffb15c", "#ec5e3b", "#7a2858", "#2a1a3d"];
  for (let i = 0; i < palette.length; i++) {
    ctx.fillStyle = palette[i];
    ctx.fillRect(0, sunY + sunR * 0.22 + i * bandH * 1.7, w, bandH);
  }
};

const drawRiso: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  ctx.fillStyle = "#f4ecdc";
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

const drawTopo: Drawer = (ctx, { w, h }) => {
  clear(ctx, w, h);
  const cx = w * 0.45, cy = h * 0.55;
  const maxR = Math.hypot(w, h) * 0.55;
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  bg.addColorStop(0, "#f4e7d0");
  bg.addColorStop(1, "#e2c89a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
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
  ctx.fillStyle = "#ffe26a";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w,h)*0.05, 0, Math.PI * 2);
  ctx.fill();
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  const r = clamp((n >> 16) & 0xff);
  const g = clamp((n >> 8) & 0xff);
  const b = clamp(n & 0xff);
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
    const [dw, dh] = ar > cAR ? [w, w / ar] : [h * ar, h];
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  };
  return { drawer, ar };
}
