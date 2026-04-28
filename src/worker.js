// ──────────────────────────────────────────────────────────────────────────
// Physics worker — Rapier 2D in proper SI units.
//
// Rapier's solver tolerances, sleep thresholds, and CCD margins are all
// calibrated assuming meters and seconds. Driving it in raw pixels with a
// 1.0 timestep — what I did first — is what was making it jittery. The
// fix is the standard game-engine pattern: simulate in SI, render in
// pixels, convert at the boundary.
//
//   1 world meter = 50 pixels
//   1 world second = 60 frames (Rapier's default timestep is 1/60 s)
//
// UI sliders still speak px/frame and px/frame² (the units you can see).
// We convert to m/s and m/s² before handing them to Rapier.
// ──────────────────────────────────────────────────────────────────────────

// SIMD build: same API as the regular @dimforge/rapier2d-compat but
// uses WASM SIMD instructions internally — roughly 1.5–2× faster on
// crowded scenes, which is exactly what we need for 5–6 figure counts.
// Bundled from local npm dep by Vite (no runtime CDN).
import RAPIER from "@dimforge/rapier2d-simd-compat";

await RAPIER.init();
self.postMessage({ type: "ready" });

// Each precompute is a long synchronous block. If the main thread queues a
// new request while one is running, the in-flight one finishes first and
// posts "done" before the new request is even processed. We echo the seed on
// every message so the main thread can drop stale responses by matching seed.
self.onmessage = (e) => {
  if (e.data?.type !== "precompute") return;
  const seed = e.data.seed;
  const t0 = performance.now();
  try {
    const result = precompute(e.data.params, seed, e.data.viewport);
    self.postMessage(
      { type: "done", seed, elapsedMs: performance.now() - t0, ...result },
      [result.recX.buffer, result.recY.buffer],
    );
  } catch (err) {
    self.postMessage({ type: "error", seed, message: String(err?.stack || err) });
  }
};

const REC_SCALE = 4;            // Uint16 record buffer: 0.25 px precision
const PX_PER_M = 50;            // 50 pixels = 1 meter
const FPS = 60;                 // Rapier default timestep is 1/60 s
const F2 = FPS * FPS;
const PX_TO_M = 1 / PX_PER_M;
const M_TO_PX = PX_PER_M;

function precompute(params, seed, viewport) {
  const W = viewport.W, H = viewport.H;
  const cx = W / 2, cy = H / 2;
  // Container dimensions are dynamic (image AR drives them).
  const SRC_W = params.containerW;
  const SRC_H = params.containerH;

  // Container in pixel space
  const cLeft = cx - SRC_W / 2;
  const cRight = cx + SRC_W / 2;
  const cTop = cy - SRC_H / 2;
  const cBottom = cy + SRC_H / 2;

  // Same in meters (everything Rapier touches uses meters)
  const cxM = cx * PX_TO_M;
  const cyM = cy * PX_TO_M;
  const cLeftM = cLeft * PX_TO_M;
  const cRightM = cRight * PX_TO_M;
  const cTopM = cTop * PX_TO_M;
  const cBottomM = cBottom * PX_TO_M;
  const rM = params.BALL_RADIUS * PX_TO_M;

  const bpf = params.BALLS_PER_FRAME;
  const N = bpf * params.SPAWN_FRAMES;
  const TOTAL = params.SPAWN_FRAMES + params.SETTLE_FRAMES;

  // Slider GRAVITY is px/frame²; convert to m/s².
  // px/frame² × (FPS² frames²/s²) × (1 m / PX_PER_M px) = m/s²
  const gravityMs2 = params.GRAVITY * F2 * PX_TO_M;

  // World with Rapier defaults (timestep = 1/60 s).
  const world = new RAPIER.World({ x: 0, y: gravityMs2 });

  // Tune for dense ball piles. Rapier's defaults (4/4/1) leave visible
  // penetration in stacks; 12/8/2 are what its own benchmarks use.
  const ip = world.integrationParameters;
  if ("numSolverIterations" in ip) ip.numSolverIterations = 12;
  if ("numAdditionalFrictionIterations" in ip) ip.numAdditionalFrictionIterations = 8;
  if ("numInternalPgsIterations" in ip) ip.numInternalPgsIterations = 2;
  // Halve dt and substep twice per recorded frame. Same wall-clock motion
  // per recorded frame, but the solver runs on a 1/120 s window — small
  // enough that fast balls (1200 px/s ≈ 3 radii/frame at defaults) can no
  // longer skip past each other or through walls in a single step.
  const SUBSTEPS = 2;
  ip.dt = 1 / (FPS * SUBSTEPS);
  // Tell Rapier our typical object scale is the ball radius. This both
  // tightens the contact margin (prediction distance ≈ 0.002 × lengthUnit
  // → ~0.24 mm at our scale instead of 2 mm) AND scales the sleep velocity
  // threshold so balls actually reach rest before going to sleep. Leaving
  // it at the 1 m default makes balls "sleep" while drifting at ~5 px/frame,
  // which freezes them mid-trajectory and breaks the final-pile shape.
  if ("lengthUnit" in ip) ip.lengthUnit = Math.max(0.05, rM);

  // ── Static walls ─────────────────────────────────────────────────────
  // 2 m thick (100 px) — plenty even at extreme launch speeds with CCD on.
  // Thin walls + fast bodies + missed CCD frame = phantom tunneling.
  const wtM = 2.0;
  const halfWM = SRC_W / 2 * PX_TO_M;
  const halfHM = SRC_H / 2 * PX_TO_M;
  // Match wall friction to the ball-friction slider so contact behavior is
  // consistent; otherwise piles slip on walls but not on each other (or
  // vice versa) as the slider moves.
  const wallFriction = params.BALL_FRICTION;

  // Floor
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWM + wtM, wtM / 2)
      .setTranslation(cxM, cBottomM + wtM / 2)
      .setFriction(wallFriction),
  );
  // Ceiling
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWM, wtM / 2)
      .setTranslation(cxM, cTopM - wtM / 2)
      .setFriction(wallFriction),
  );
  // Left
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(wtM / 2, halfHM + wtM)
      .setTranslation(cLeftM - wtM / 2, cyM)
      .setFriction(wallFriction),
  );
  // Right
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(wtM / 2, halfHM + wtM)
      .setTranslation(cRightM + wtM / 2, cyM)
      .setFriction(wallFriction),
  );

  // ── Spawn schedule ───────────────────────────────────────────────────
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // px/frame → m/s scale. Per-hole speed/cone are read off the hole object
  // below; there's no longer a global "launch speed" / "launch cone" — each
  // hole carries its own emission character.
  const spdScale = FPS * PX_TO_M;
  const HOLE_DEFAULT_SPEED = 20;
  const HOLE_DEFAULT_CONE = 0.85;

  // Resolve each hole into world-space center + outward direction +
  // tangent (along which the spawn band extends). All in meters.
  // Spawn the ball center exactly one radius from the wall so the ball's
  // edge is flush with the wall — visually it reads as emerging from the
  // wall rather than hovering above it.
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
        cx_h = cLeftM + h.offset * srcWm;
        cy_h = cTopM + inset;
        dirX = 0;  dirY = 1;       // launch downward (+y)
        tx = 1; ty = 0;
        break;
      case "left":
        cx_h = cLeftM + inset;
        cy_h = cTopM + h.offset * srcHm;
        dirX = 1;  dirY = 0;       // launch rightward
        tx = 0; ty = 1;
        break;
      case "right":
        cx_h = cRightM - inset;
        cy_h = cTopM + h.offset * srcHm;
        dirX = -1; dirY = 0;       // launch leftward
        tx = 0; ty = 1;
        break;
      case "bottom":
      default:
        cx_h = cLeftM + h.offset * srcWm;
        cy_h = cBottomM - inset;
        dirX = 0;  dirY = -1;      // launch upward (-y in screen coords)
        tx = 1; ty = 0;
        break;
    }
    const angleRad = (h.angle || 0) * Math.PI / 180;
    const baseAngle = Math.atan2(dirY, dirX) + angleRad;
    const speedSlider = h.speed != null ? h.speed : HOLE_DEFAULT_SPEED;
    const sMin = speedSlider * 0.6 * spdScale;
    const sMax = speedSlider * spdScale;
    const cone = h.cone != null ? h.cone : HOLE_DEFAULT_CONE;
    return { cx_h, cy_h, tx, ty, widthM, baseAngle, sMin, sMax, cone };
  });

  const spawnXm  = new Float32Array(N);
  const spawnYm  = new Float32Array(N);
  const spawnVxm = new Float32Array(N);
  const spawnVym = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // Pick a hole at random (seeded). Round-robin would visibly stripe the
    // fountain when bpf is small; random gives an even mix.
    const hole = holesM[(rnd() * holesM.length) | 0];
    const tangOff = (rnd() - 0.5) * hole.widthM;
    spawnXm[i] = hole.cx_h + hole.tx * tangOff;
    spawnYm[i] = hole.cy_h + hole.ty * tangOff;
    const ang = hole.baseAngle + (rnd() - 0.5) * hole.cone;
    const spd = hole.sMin + rnd() * (hole.sMax - hole.sMin);
    spawnVxm[i] = Math.cos(ang) * spd;
    spawnVym[i] = Math.sin(ang) * spd;
  }

  // ── Record buffers ───────────────────────────────────────────────────
  const recX = new Uint16Array(N * TOTAL);
  const recY = new Uint16Array(N * TOTAL);

  // ── Run sim ──────────────────────────────────────────────────────────
  const bodies = new Array(N).fill(null);
  // Damping is staged: low during flight + early pile build-up so contacts
  // feel crisp; ramped up hard in the last ~40% of settle frames so balls
  // actually come to rest before the recording ends. Otherwise high
  // restitution + low damping can leave residual jitter at frame TOTAL,
  // which makes bake() sample colors at jittery final positions and ruins
  // the image — and because settling time depends on gravity, you'd see
  // it "break" whenever the gravity slider was off the sweet spot.
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
    // Spawn this frame's batch.
    const start = f * bpf;
    const end = Math.min(start + bpf, N);
    for (let i = start; i < end; i++) {
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnXm[i], spawnYm[i])
        .setLinvel(spawnVxm[i], spawnVym[i])
        .setLinearDamping(FLIGHT_DAMP)
        // CCD: Rapier sub-steps any body whose motion this frame would
        // exceed the contact margin, so even a ball flying at 30 m/s into
        // the wall can't tunnel. Per-body cost is paid only when motion is
        // actually fast enough to need it, so it's cheap once piles settle.
        .setCcdEnabled(true);
      const body = world.createRigidBody(bodyDesc);
      // Stash our index on the body so the active-body callback can locate
      // its slot in the record buffer without a side map.
      body.userData = i;
      const colDesc = RAPIER.ColliderDesc.ball(rM)
        .setRestitution(params.RESTITUTION)
        .setFriction(ballFriction)
        .setDensity(1.0);
      world.createCollider(colDesc, body);
      bodies[i] = body;
    }

    // Damping schedule: bump damping at three thresholds during settle so
    // residual jitter is killed before recording ends. We hit all bodies
    // (including sleeping ones — setting damping doesn't wake them) at the
    // exact frame the threshold is crossed, then leave it alone. Total
    // cost is 3 × N WASM calls over the entire sim, negligible.
    if (f === SETTLE_RAMP_F || f === SETTLE_HARD_F || f === SETTLE_LOCK_F) {
      const d = f === SETTLE_LOCK_F ? 12.0 : f === SETTLE_HARD_F ? 5.0 : 1.5;
      for (let i = 0; i < N; i++) {
        if (bodies[i]) bodies[i].setLinearDamping(d);
      }
    }

    // Substep: dt is 1/120, so two steps move sim time forward 1/60 s,
    // matching one recorded frame.
    for (let k = 0; k < SUBSTEPS; k++) world.step();

    const off = f * N;
    // Carry the previous frame forward in one block copy. Bodies that are
    // sleeping (or not yet spawned) keep their last-known positions; we
    // overwrite the awake ones below. This is one bulk memcpy instead of
    // N round-trips across the WASM bridge to ask "are you asleep?".
    if (f > 0) {
      recX.copyWithin(off, off - N, off);
      recY.copyWithin(off, off - N, off);
    }

    // Iterate only the awake bodies. Rapier's island detection means this
    // shrinks rapidly during the settle phase — once a pile stabilizes,
    // its bodies disappear from this loop entirely.
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
      // Fallback if the binding lacks forEachActiveRigidBody.
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

    // Early termination: spawning done AND every body is asleep → the rest
    // of the record is just the last frame repeated. One bulk fill, exit.
    if (activeCount === 0 && f >= params.SPAWN_FRAMES - 1) {
      stoppedAt = f + 1;
      const lastSliceX = recX.subarray(off, off + N);
      const lastSliceY = recY.subarray(off, off + N);
      for (let f2 = stoppedAt; f2 < TOTAL; f2++) {
        const o2 = f2 * N;
        recX.set(lastSliceX, o2);
        recY.set(lastSliceY, o2);
      }
      self.postMessage({ type: "progress", frame: TOTAL - 1, total: TOTAL, pct: 100 });
      break;
    }
  }

  world.free();

  return { recX, recY, scale: REC_SCALE, N, TOTAL, stoppedAt };
}
