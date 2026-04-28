export type HoleSide = "bottom" | "top" | "left" | "right";

export interface Hole {
  side: HoleSide;
  offset: number;       // 0..1 along the wall
  width: number;        // px
  angle: number;        // deg, offset from inward normal
  speed?: number;       // px/frame; undefined = use HOLE_DEFAULT_SPEED
  cone?: number;        // launch-angle spread (rad); undefined = HOLE_DEFAULT_CONE
}

export const HOLE_DEFAULT_SPEED = 15;
export const HOLE_DEFAULT_CONE = 0;
export const HOLE_DEFAULT_WIDTH = 20;

export function makeHole(side: HoleSide): Hole {
  return {
    side,
    offset: 0.5,
    width: HOLE_DEFAULT_WIDTH,
    angle: 0,
    speed: HOLE_DEFAULT_SPEED,
    cone: HOLE_DEFAULT_CONE,
  };
}

export type Phase =
  | "loading"
  | "idle"
  | "precomputing"
  | "fountaining"
  | "settled"
  | "error";

export type Quality = "medium" | "high" | "ultra";

export interface QualityPreset {
  label: string;
  ballRadius: number;       // px
  fillRatio: number;        // 0..1 — target fraction of container area filled
  ballsPerFrame: number;    // emission rate
  settleFrames: number;     // post-emission time-to-rest budget
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  medium: { label: "Medium", ballRadius: 7,  fillRatio: 0.88, ballsPerFrame: 6,  settleFrames: 220 },
  high:   { label: "High",   ballRadius: 5,  fillRatio: 0.90, ballsPerFrame: 8,  settleFrames: 240 },
  ultra:  { label: "Ultra",  ballRadius: 3,  fillRatio: 0.92, ballsPerFrame: 14, settleFrames: 280 },
};

export interface ContainerSize { w: number; h: number }

export interface DerivedQuality {
  ballRadius: number;
  ballsPerFrame: number;
  spawnFrames: number;
  settleFrames: number;
  totalBalls: number;
}

export function deriveQuality(q: Quality, c: ContainerSize): DerivedQuality {
  const p = QUALITY_PRESETS[q];
  const N = Math.round((c.w * c.h * p.fillRatio) / (Math.PI * p.ballRadius * p.ballRadius));
  const spawnFrames = Math.max(40, Math.ceil(N / p.ballsPerFrame));
  return {
    ballRadius: p.ballRadius,
    ballsPerFrame: p.ballsPerFrame,
    spawnFrames,
    settleFrames: p.settleFrames,
    totalBalls: N,
  };
}

export interface SimParams {
  QUALITY: Quality;
  RESTITUTION: number;
  BALL_FRICTION: number;
}

export const MAX_CONTAINER_W = 720;
export const MAX_CONTAINER_H = 480;
const MOBILE_BREAKPOINT = 768;

export function containerForAR(ar: number, vp?: { w: number; h: number }): ContainerSize {
  let maxW = MAX_CONTAINER_W;
  let maxH = MAX_CONTAINER_H;
  if (vp && vp.w < MOBILE_BREAKPOINT) {
    // On phones, leave room for the top bar (~56px) and bottom controls (~80px)
    // plus a margin so the container doesn't kiss the edges.
    maxW = Math.max(160, Math.min(MAX_CONTAINER_W, vp.w - 24));
    maxH = Math.max(120, Math.min(MAX_CONTAINER_H, vp.h - 200));
  }
  if (ar > maxW / maxH) {
    return { w: maxW, h: Math.round(maxW / ar) };
  }
  return { w: Math.round(maxH * ar), h: maxH };
}

export interface PrecomputeMessage {
  type: "precompute";
  seed: number;
  params: {
    BALLS_PER_FRAME: number;
    SPAWN_FRAMES: number;
    SETTLE_FRAMES: number;
    BALL_RADIUS: number;
    RESTITUTION: number;
    BALL_FRICTION: number;
    GRAVITY: number;
    holes: Hole[];
    containerW: number;
    containerH: number;
  };
  viewport: { W: number; H: number };
}

export interface PrecomputeResult {
  type: "done";
  seed: number;
  elapsedMs: number;
  recX: Uint16Array;
  recY: Uint16Array;
  scale: number;
  N: number;
  TOTAL: number;
  stoppedAt?: number;
}

export type WorkerMessage =
  | { type: "ready" }
  | { type: "progress"; seed: number; frame: number; total: number; pct: number }
  | { type: "error"; seed: number; message: string }
  | PrecomputeResult;

export const baseAnglesBySide: Record<HoleSide, number> = {
  bottom: -Math.PI / 2,
  top: Math.PI / 2,
  left: 0,
  right: Math.PI,
};

export function mirrorH(h: Hole): Hole {
  const side =
    h.side === "left" ? "right" : h.side === "right" ? "left" : h.side;
  const offset =
    h.side === "top" || h.side === "bottom" ? 1 - h.offset : h.offset;
  return { ...h, side, offset, angle: -h.angle };
}
export function mirrorV(h: Hole): Hole {
  const side =
    h.side === "top" ? "bottom" : h.side === "bottom" ? "top" : h.side;
  const offset =
    h.side === "left" || h.side === "right" ? 1 - h.offset : h.offset;
  return { ...h, side, offset, angle: -h.angle };
}
