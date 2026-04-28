import type { Hole, SimParams } from "./types";

export interface ScenePreset {
  id: string;
  label: string;
  description: string;
  // QUALITY is preserved from the user's current setting when applying.
  params: Omit<SimParams, "QUALITY">;
  holes: Hole[];
}

export const FOUNTAIN_PRESET: ScenePreset = {
  id: "fountain",
  label: "Fountain",
  description: "A gentle stream from the bottom. A good place to start.",
  params: { RESTITUTION: 0.4, BALL_FRICTION: 0.1 },
  holes: [
    { side: "bottom", offset: 0.5, width: 40, angle: 0, speed: 22, cone: 0.15 },
  ],
};

export const PRESETS: ScenePreset[] = [
  FOUNTAIN_PRESET,
  {
    id: "vortex",
    label: "Vortex",
    description: "Four angled streams that swirl into a spiral.",
    params: { RESTITUTION: 0.3, BALL_FRICTION: 0.15 },
    holes: [
      { side: "top",    offset: 0.5, width: 30, angle: 60, speed: 16, cone: 0 },
      { side: "right",  offset: 0.5, width: 30, angle: 60, speed: 16, cone: 0 },
      { side: "bottom", offset: 0.5, width: 30, angle: 60, speed: 16, cone: 0 },
      { side: "left",   offset: 0.5, width: 30, angle: 60, speed: 16, cone: 0 },
    ],
  },
  {
    id: "lattice",
    label: "Lattice",
    description: "Two steady side streams that settle into a clean grid.",
    params: { RESTITUTION: 0, BALL_FRICTION: 1 },
    holes: [
      { side: "left",  offset: 0.5, width: 30, angle: 0, speed: 14, cone: 0 },
      { side: "right", offset: 0.5, width: 30, angle: 0, speed: 14, cone: 0 },
    ],
  },
  {
    id: "crossfire",
    label: "Crossfire",
    description: "Four streams meet in the center for a balanced burst.",
    params: { RESTITUTION: 0.4, BALL_FRICTION: 0.1 },
    holes: [
      { side: "bottom", offset: 0.5, width: 35, angle: 0, speed: 16, cone: 0.1 },
      { side: "top",    offset: 0.5, width: 35, angle: 0, speed: 16, cone: 0.1 },
      { side: "left",   offset: 0.5, width: 35, angle: 0, speed: 16, cone: 0.1 },
      { side: "right",  offset: 0.5, width: 35, angle: 0, speed: 16, cone: 0.1 },
    ],
  },
  {
    id: "chevron",
    label: "Chevron",
    description: "Two bottom streams cross into an X shape.",
    params: { RESTITUTION: 0.3, BALL_FRICTION: 0.15 },
    holes: [
      { side: "bottom", offset: 0.3, width: 35, angle: 30,  speed: 18, cone: 0.05 },
      { side: "bottom", offset: 0.7, width: 35, angle: -30, speed: 18, cone: 0.05 },
    ],
  },
  {
    id: "confetti",
    label: "Confetti",
    description: "Many soft sprays fill the canvas from every side.",
    params: { RESTITUTION: 0.55, BALL_FRICTION: 0.1 },
    holes: [
      { side: "bottom", offset: 0.25, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "bottom", offset: 0.75, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "top",    offset: 0.25, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "top",    offset: 0.75, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "left",   offset: 0.25, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "left",   offset: 0.75, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "right",  offset: 0.25, width: 25, angle: 0, speed: 9, cone: 1.4 },
      { side: "right",  offset: 0.75, width: 25, angle: 0, speed: 9, cone: 1.4 },
    ],
  },
  {
    id: "pulse",
    label: "Pulse",
    description: "A fast, narrow stream shoots up from the bottom.",
    params: { RESTITUTION: 0.6, BALL_FRICTION: 0.08 },
    holes: [
      { side: "bottom", offset: 0.5, width: 22, angle: 0, speed: 45, cone: 0 },
    ],
  },
];
