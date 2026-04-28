import type { ContainerSize } from "./types";

export type Drawer = (ctx: CanvasRenderingContext2D, size: ContainerSize) => void;

export interface Sample {
  ar: number;
  draw: Drawer;
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}

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

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  const r = clamp((n >> 16) & 0xff);
  const g = clamp((n >> 8) & 0xff);
  const b = clamp(n & 0xff);
  return `rgb(${r},${g},${b})`;
}

export const SAMPLES: Record<string, Sample> = {
  spectrum: { ar: 720 / 360, draw: drawSpectrum },
};

export const DEFAULT_SAMPLE_KEY = "spectrum";

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
