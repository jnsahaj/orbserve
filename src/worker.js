// Physics worker — Rapier 2D in SI units.
//
// Rapier's tolerances assume meters and seconds. We simulate in SI, render in
// pixels, and convert at the boundary.
//   1 world meter = 50 pixels
//   1 world second = 60 frames (Rapier's default timestep is 1/60 s)
// UI sliders speak px/frame and px/frame²; we convert to m/s and m/s².

import RAPIER from "@dimforge/rapier2d-simd-compat";

await RAPIER.init();
self.postMessage({ type: "ready" });

// Each precompute is a long synchronous block. If the main thread queues a
// new request mid-flight, we still process the queued one but the seed echo
// lets it drop stale "done" messages on the receiving side.
self.onmessage = (e) => {
  if (e.data?.type !== "precompute") return;
  const { seed, params, viewport } = e.data;
  const t0 = performance.now();
  try {
    const result = precompute(params, seed, viewport);
    self.postMessage(
      { type: "done", seed, elapsedMs: performance.now() - t0, ...result },
      [result.recX.buffer, result.recY.buffer],
    );
  } catch (err) {
    self.postMessage({ type: "error", seed, message: String(err?.stack || err) });
  }
};

const REC_SCALE = 4;            // Uint16 record buffer: 0.25 px precision
const PX_PER_M = 50;
const FPS = 60;
const F2 = FPS * FPS;
const PX_TO_M = 1 / PX_PER_M;
const M_TO_PX = PX_PER_M;

const HOLE_DEFAULT_SPEED = 20;
const HOLE_DEFAULT_CONE = 0.85;

function precompute(params, seed, viewport) {
  const cx = viewport.W / 2, cy = viewport.H / 2;
  const SRC_W = params.containerW;
  const SRC_H = params.containerH;
  const cLeft = cx - SRC_W / 2, cRight = cx + SRC_W / 2;
  const cTop = cy - SRC_H / 2, cBottom = cy + SRC_H / 2;

  const cxM = cx * PX_TO_M, cyM = cy * PX_TO_M;
  const cLeftM = cLeft * PX_TO_M, cRightM = cRight * PX_TO_M;
  const cTopM = cTop * PX_TO_M, cBottomM = cBottom * PX_TO_M;
  const rM = params.BALL_RADIUS * PX_TO_M;

  const bpf = params.BALLS_PER_FRAME;
  const N = bpf * params.SPAWN_FRAMES;
  const TOTAL = params.SPAWN_FRAMES + params.SETTLE_FRAMES;

  // Slider GRAVITY is px/frame²; convert to m/s².
  const gravityMs2 = params.GRAVITY * F2 * PX_TO_M;
  const world = new RAPIER.World({ x: 0, y: gravityMs2 });

  // Tighten solver. Defaults (4/4/1) leave visible penetration in dense
  // stacks; 12/8/2 are what Rapier's own benchmarks use.
  const ip = world.integrationParameters;
  if ("numSolverIterations" in ip) ip.numSolverIterations = 12;
  if ("numAdditionalFrictionIterations" in ip) ip.numAdditionalFrictionIterations = 8;
  if ("numInternalPgsIterations" in ip) ip.numInternalPgsIterations = 2;
  // Substep at 1/120 s — fast balls (~3 radii/frame) can't tunnel through
  // walls or each other in a single step.
  const SUBSTEPS = 2;
  ip.dt = 1 / (FPS * SUBSTEPS);
  // Tell Rapier the ball radius is the typical object scale. This tightens
  // the contact margin AND scales the sleep velocity threshold so balls
  // actually reach rest before sleeping (default 1 m sleeps balls drifting
  // at ~5 px/frame, freezing them mid-trajectory).
  if ("lengthUnit" in ip) ip.lengthUnit = Math.max(0.05, rM);

  // Walls — 2 m thick (100 px) so even fast bodies with CCD on can't tunnel.
  const wtM = 2.0;
  const halfWM = SRC_W / 2 * PX_TO_M;
  const halfHM = SRC_H / 2 * PX_TO_M;
  const wallFriction = params.BALL_FRICTION;
  const wall = (w, h, x, y) => world.createCollider(
    RAPIER.ColliderDesc.cuboid(w, h).setTranslation(x, y).setFriction(wallFriction),
  );
  wall(halfWM + wtM, wtM / 2, cxM, cBottomM + wtM / 2); // floor
  wall(halfWM, wtM / 2, cxM, cTopM - wtM / 2);          // ceiling
  wall(wtM / 2, halfHM + wtM, cLeftM - wtM / 2, cyM);   // left
  wall(wtM / 2, halfHM + wtM, cRightM + wtM / 2, cyM);  // right

  // Seeded PRNG (mulberry32-ish).
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const spdScale = FPS * PX_TO_M;

  // Spawn ball center exactly one radius from the wall — visually flush.
  const inset = rM;
  const holesIn = (params.holes && params.holes.length > 0)
    ? params.holes
    : [{ side: "bottom", offset: 0.5, width: 100 }];
  const srcWm = SRC_W * PX_TO_M;
  const srcHm = SRC_H * PX_TO_M;
  const holesM = holesIn.map((h) => {
    const widthM = h.width * PX_TO_M;
    let cx_h, cy_h, dirX, dirY, tx, ty;
    switch (h.side) {
      case "top":
        cx_h = cLeftM + h.offset * srcWm; cy_h = cTopM + inset;
        dirX = 0;  dirY = 1;  tx = 1; ty = 0; break;
      case "left":
        cx_h = cLeftM + inset; cy_h = cTopM + h.offset * srcHm;
        dirX = 1;  dirY = 0;  tx = 0; ty = 1; break;
      case "right":
        cx_h = cRightM - inset; cy_h = cTopM + h.offset * srcHm;
        dirX = -1; dirY = 0;  tx = 0; ty = 1; break;
      default:
        cx_h = cLeftM + h.offset * srcWm; cy_h = cBottomM - inset;
        dirX = 0;  dirY = -1; tx = 1; ty = 0; break;
    }
    const baseAngle = Math.atan2(dirY, dirX) + (h.angle || 0) * Math.PI / 180;
    const speed = h.speed != null ? h.speed : HOLE_DEFAULT_SPEED;
    return {
      cx_h, cy_h, tx, ty, widthM, baseAngle,
      sMin: speed * 0.6 * spdScale,
      sMax: speed * spdScale,
      cone: h.cone != null ? h.cone : HOLE_DEFAULT_CONE,
    };
  });

  // Pre-roll spawn schedule. Picking a hole at random rather than
  // round-robin avoids visible striping when bpf is small.
  const spawnXm  = new Float32Array(N);
  const spawnYm  = new Float32Array(N);
  const spawnVxm = new Float32Array(N);
  const spawnVym = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const hole = holesM[(rnd() * holesM.length) | 0];
    const tangOff = (rnd() - 0.5) * hole.widthM;
    spawnXm[i] = hole.cx_h + hole.tx * tangOff;
    spawnYm[i] = hole.cy_h + hole.ty * tangOff;
    const ang = hole.baseAngle + (rnd() - 0.5) * hole.cone;
    const spd = hole.sMin + rnd() * (hole.sMax - hole.sMin);
    spawnVxm[i] = Math.cos(ang) * spd;
    spawnVym[i] = Math.sin(ang) * spd;
  }

  const recX = new Uint16Array(N * TOTAL);
  const recY = new Uint16Array(N * TOTAL);

  const bodies = new Array(N).fill(null);
  // Damping is staged: low during flight + early pile build-up so contacts
  // feel crisp; ramped hard in the last 40% of settle frames so balls reach
  // rest before recording ends. Without this, high-restitution + low-damping
  // runs leave residual jitter at frame TOTAL — which makes bake() sample
  // colors at jittery final positions and ruins the image.
  const FLIGHT_DAMP = 0.10;
  const SETTLE_RAMP_F = params.SPAWN_FRAMES + Math.floor(params.SETTLE_FRAMES * 0.40);
  const SETTLE_HARD_F = params.SPAWN_FRAMES + Math.floor(params.SETTLE_FRAMES * 0.75);
  const SETTLE_LOCK_F = params.SPAWN_FRAMES + Math.floor(params.SETTLE_FRAMES * 0.92);
  const ballFriction = params.BALL_FRICTION;
  const recordScalePx = M_TO_PX * REC_SCALE;

  let lastPct = -1;
  let stoppedAt = TOTAL;
  const hasForEachActive = typeof world.forEachActiveRigidBody === "function";

  for (let f = 0; f < TOTAL; f++) {
    const start = f * bpf;
    const end = Math.min(start + bpf, N);
    for (let i = start; i < end; i++) {
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnXm[i], spawnYm[i])
        .setLinvel(spawnVxm[i], spawnVym[i])
        .setLinearDamping(FLIGHT_DAMP)
        .setCcdEnabled(true);
      const body = world.createRigidBody(bodyDesc);
      body.userData = i;
      world.createCollider(
        RAPIER.ColliderDesc.ball(rM)
          .setRestitution(params.RESTITUTION)
          .setFriction(ballFriction)
          .setDensity(1.0),
        body,
      );
      bodies[i] = body;
    }

    if (f === SETTLE_RAMP_F || f === SETTLE_HARD_F || f === SETTLE_LOCK_F) {
      const d = f === SETTLE_LOCK_F ? 12.0 : f === SETTLE_HARD_F ? 5.0 : 1.5;
      for (let i = 0; i < N; i++) if (bodies[i]) bodies[i].setLinearDamping(d);
    }

    for (let k = 0; k < SUBSTEPS; k++) world.step();

    const off = f * N;
    // Carry the previous frame forward; awake bodies overwrite below.
    if (f > 0) {
      recX.copyWithin(off, off - N, off);
      recY.copyWithin(off, off - N, off);
    }

    let activeCount = 0;
    if (hasForEachActive) {
      world.forEachActiveRigidBody((body) => {
        activeCount++;
        const i = body.userData;
        const t = body.translation();
        let qx = (t.x * recordScalePx) | 0;
        let qy = (t.y * recordScalePx) | 0;
        if (qx < 0) qx = 0; else if (qx > 65535) qx = 65535;
        if (qy < 0) qy = 0; else if (qy > 65535) qy = 65535;
        recX[off + i] = qx;
        recY[off + i] = qy;
      });
    } else {
      for (let i = 0; i < N; i++) {
        const b = bodies[i];
        if (!b || b.isSleeping()) continue;
        activeCount++;
        const t = b.translation();
        let qx = (t.x * recordScalePx) | 0;
        let qy = (t.y * recordScalePx) | 0;
        if (qx < 0) qx = 0; else if (qx > 65535) qx = 65535;
        if (qy < 0) qy = 0; else if (qy > 65535) qy = 65535;
        recX[off + i] = qx;
        recY[off + i] = qy;
      }
    }

    const pct = (f * 100 / TOTAL) | 0;
    if (pct !== lastPct && (pct % 2) === 0) {
      lastPct = pct;
      self.postMessage({ type: "progress", seed, frame: f, total: TOTAL, pct });
    }

    // Early termination: spawning done and everyone asleep → repeat the
    // last frame to fill the rest of the record and exit.
    if (activeCount === 0 && f >= params.SPAWN_FRAMES - 1) {
      stoppedAt = f + 1;
      const lastSliceX = recX.subarray(off, off + N);
      const lastSliceY = recY.subarray(off, off + N);
      for (let f2 = stoppedAt; f2 < TOTAL; f2++) {
        const o2 = f2 * N;
        recX.set(lastSliceX, o2);
        recY.set(lastSliceY, o2);
      }
      self.postMessage({ type: "progress", seed, frame: TOTAL - 1, total: TOTAL, pct: 100 });
      break;
    }
  }

  world.free();
  return { recX, recY, scale: REC_SCALE, N, TOTAL, stoppedAt };
}
