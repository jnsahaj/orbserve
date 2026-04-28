export type HoleSide = "bottom" | "top" | "left" | "right";

export interface Hole {
  side: HoleSide;
  offset: number;       // 0..1 along the wall
  width: number;        // px
  angle: number;        // deg, offset from inward normal
  speed?: number;       // px/frame; undefined = use HOLE_DEFAULT_SPEED
  cone?: number;        // launch-angle spread (rad); undefined = HOLE_DEFAULT_CONE
}

export const HOLE_DEFAULT_SPEED = 20;
export const HOLE_DEFAULT_CONE = 0.85;

export type Quality = "low" | "medium" | "high" | "ultra";

export interface QualityPreset {
  label: string;
  ballRadius: number;       // px
  fillRatio: number;        // 0..1 — target fraction of container area filled
  ballsPerFrame: number;    // emission rate
  settleFrames: number;     // post-emission time-to-rest budget
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low:    { label: "Low",    ballRadius: 11, fillRatio: 0.72, ballsPerFrame: 4,  settleFrames: 160 },
  medium: { label: "Medium", ballRadius: 7,  fillRatio: 0.80, ballsPerFrame: 5,  settleFrames: 200 },
  high:   { label: "High",   ballRadius: 5,  fillRatio: 0.86, ballsPerFrame: 8,  settleFrames: 240 },
  ultra:  { label: "Ultra",  ballRadius: 3,  fillRatio: 0.90, ballsPerFrame: 14, settleFrames: 280 },
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

// Slimmer SimParams: physics-only knobs. Per-hole emission lives on Hole.
export interface SimParams {
  QUALITY: Quality;
  RESTITUTION: number;
  BALL_FRICTION: number;
  GRAVITY: number;
}

// Max container box (px). Image AR is fitted within these bounds.
export const MAX_CONTAINER_W = 720;
export const MAX_CONTAINER_H = 480;

export function containerForAR(ar: number): ContainerSize {
  if (ar > MAX_CONTAINER_W / MAX_CONTAINER_H) {
    return { w: MAX_CONTAINER_W, h: Math.round(MAX_CONTAINER_W / ar) };
  }
  return { w: Math.round(MAX_CONTAINER_H * ar), h: MAX_CONTAINER_H };
}

// Wire-format passed to the worker. Quality is pre-resolved so the worker
// stays a dumb consumer of concrete numbers — no preset table duplication.
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

export const baseAnglesByside: Record<HoleSide, number> = {
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
export function holeKey(h: Hole) {
  return `${h.side}|${Math.round(h.offset * 1000)}|${Math.round(h.angle)}`;
}
