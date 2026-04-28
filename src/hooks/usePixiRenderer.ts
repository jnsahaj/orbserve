import { useEffect, useRef } from "react";
import {
  Application,
  ParticleContainer,
  Particle,
  Texture,
  Sprite,
} from "pixi.js";
import type { ContainerSize } from "@/lib/types";

const CIRCLE_TEX_SIZE = 64;

interface RendererState {
  app: Application;
  particleContainer: ParticleContainer;
  circleTexture: Texture;
  pixiParticles: (Particle | null)[];
  visible: Uint8Array;
  domSprite: Sprite | null;
  loadingTickerId: number | null;   // RAF id of the active loading-pulse loop
}

export interface RendererHandle {
  ready: () => Promise<void>;
  bake: (
    recX: Uint16Array,
    recY: Uint16Array,
    scale: number,
    N: number,
    total: number,
    sourceCanvas: HTMLCanvasElement,
    container: ContainerSize,
    containerLeft: number,
    containerTop: number,
    ballRadius: number,
  ) => number;
  drawFrame: (
    recX: Uint16Array,
    recY: Uint16Array,
    scale: number,
    N: number,
    f: number,
  ) => void;
  fadeInDom: (
    sourceCanvas: HTMLCanvasElement,
    container: ContainerSize,
    containerLeft: number,
    containerTop: number,
    drawLastFrame: () => void,
  ) => void;
  /** Wipe every particle currently on stage. Used at run start so the
      previous run's image doesn't linger during the new precompute. */
  clearParticles: () => void;
  /** Show a faint, gently-pulsing copy of the source image on the stage as
      a "we're working on it" indicator. Stays up until reset() is called. */
  showLoading: (
    sourceCanvas: HTMLCanvasElement,
    container: ContainerSize,
    containerLeft: number,
    containerTop: number,
  ) => void;
  reset: () => void;
}

export function usePixiRenderer(canvasRef: React.RefObject<HTMLCanvasElement>): RendererHandle {
  const stateRef = useRef<RendererState | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (readyRef.current) return;

    readyRef.current = (async () => {
      const app = new Application();
      await app.init({
        canvas,
        resizeTo: window,
        // Transparent so the theme-driven body background shows through —
        // light mode reveals cream paper, dark mode reveals warm-black.
        backgroundAlpha: 0,
        antialias: false,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgpu",
      });
      app.ticker.stop();

      const off = document.createElement("canvas");
      off.width = off.height = CIRCLE_TEX_SIZE;
      const cctx = off.getContext("2d")!;
      const cx = CIRCLE_TEX_SIZE / 2;
      cctx.beginPath();
      cctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
      cctx.fillStyle = "#ffffff";
      cctx.fill();
      const circleTexture = Texture.from(off);

      const particleContainer = new ParticleContainer({
        dynamicProperties: { position: true, scale: false, tint: false, rotation: false },
      });
      app.stage.addChild(particleContainer);

      stateRef.current = {
        app,
        particleContainer,
        circleTexture,
        pixiParticles: [],
        visible: new Uint8Array(0),
        domSprite: null,
        loadingTickerId: null,
      };
    })();
  }, [canvasRef]);

  return {
    ready: () => readyRef.current ?? Promise.resolve(),

    bake(recX, recY, scale, N, total, sourceCanvas, container, cLeft, cTop, ballRadius) {
      const s = stateRef.current;
      if (!s) return 0;
      const { particleContainer, circleTexture } = s;
      const ctx = sourceCanvas.getContext("2d")!;
      const data = ctx.getImageData(0, 0, container.w, container.h).data;

      // Always start from a clean slate. Reusing particles between runs is
      // an attractive nuisance — old tints and stale positions can leak
      // between runs in subtle ways, and have caused "scrambled final
      // image" bugs after parameter tweaks. Worth the small cost of
      // re-allocating N Pixi particles per run.
      for (const p of s.pixiParticles) if (p) particleContainer.removeParticle(p);
      const particles = new Array(N).fill(null);
      const visible = new Uint8Array(N);
      s.pixiParticles = particles;
      s.visible = visible;
      const lastOff = (total - 1) * N;
      const radiusScale = (ballRadius * 2) / CIRCLE_TEX_SIZE;
      let colored = 0;
      for (let i = 0; i < N; i++) {
        const qx = recX[lastOff + i];
        const qy = recY[lastOff + i];
        if (qx === 0 && qy === 0) continue;
        const x = qx / scale;
        const y = qy / scale;
        const ix = (x - cLeft) | 0;
        const iy = (y - cTop) | 0;
        if (ix < 0 || ix >= container.w || iy < 0 || iy >= container.h) continue;
        const pi = (iy * container.w + ix) * 4;
        if (data[pi + 3] < 32) continue;
        const r = data[pi], g = data[pi + 1], b = data[pi + 2];
        let p = particles[i];
        if (!p) {
          p = new Particle({
            texture: circleTexture,
            x: -9999, y: -9999,
            scaleX: radiusScale,
            scaleY: radiusScale,
            anchorX: 0.5,
            anchorY: 0.5,
            tint: (r << 16) | (g << 8) | b,
          });
          particleContainer.addParticle(p);
          particles[i] = p;
        } else {
          p.tint = (r << 16) | (g << 8) | b;
          p.scaleX = p.scaleY = radiusScale;
        }
        visible[i] = 1;
        colored++;
      }
      for (let i = 0; i < N; i++) {
        if (!visible[i] && particles[i]) {
          particleContainer.removeParticle(particles[i]!);
          particles[i] = null;
        }
      }
      // Park every particle off-screen so that, between bake and the first
      // drawFrame call, the renderer doesn't briefly composite particles at
      // wherever they happened to be from the previous run's last frame.
      for (let i = 0; i < N; i++) {
        const p = particles[i];
        if (p) { p.x = -9999; p.y = -9999; }
      }
      return colored;
    },

    drawFrame(recX, recY, scale, N, f) {
      const s = stateRef.current;
      if (!s) return;
      const off = f * N;
      const inv = 1 / scale;
      const particles = s.pixiParticles;
      for (let i = 0; i < N; i++) {
        const p = particles[i];
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
      s.app.renderer.render(s.app.stage);
    },

    fadeInDom(sourceCanvas, container, cLeft, cTop, drawLast) {
      const s = stateRef.current;
      if (!s) return;
      if (s.domSprite) {
        s.app.stage.removeChild(s.domSprite);
        s.domSprite.destroy();
      }
      const tex = Texture.from(sourceCanvas);
      tex.source.update?.();
      const sprite = new Sprite(tex);
      sprite.x = cLeft;
      sprite.y = cTop;
      sprite.width = container.w;
      sprite.height = container.h;
      sprite.alpha = 0;
      s.app.stage.addChild(sprite);
      s.domSprite = sprite;

      let alpha = 0;
      const tick = () => {
        alpha += 0.05;
        if (alpha > 1) alpha = 1;
        sprite.alpha = alpha;
        drawLast();
        if (alpha < 1) requestAnimationFrame(tick);
      };
      tick();
    },

    clearParticles() {
      const s = stateRef.current;
      if (!s) return;
      const { particleContainer, pixiParticles } = s;
      for (const p of pixiParticles) if (p) particleContainer.removeParticle(p);
      s.pixiParticles = [];
      s.visible = new Uint8Array(0);
      // Force one render so the canvas immediately shows nothing — without
      // this the prior frame stays on screen until the next drawFrame call,
      // which can be seconds away while a precompute is running.
      s.app.renderer.render(s.app.stage);
    },

    showLoading(sourceCanvas, container, cLeft, cTop) {
      const s = stateRef.current;
      if (!s) return;
      // Tear down anything we previously had up.
      if (s.loadingTickerId != null) {
        cancelAnimationFrame(s.loadingTickerId);
        s.loadingTickerId = null;
      }
      if (s.domSprite) {
        s.app.stage.removeChild(s.domSprite);
        s.domSprite.destroy();
        s.domSprite = null;
      }
      const tex = Texture.from(sourceCanvas);
      tex.source.update?.();
      const sprite = new Sprite(tex);
      sprite.x = cLeft;
      sprite.y = cTop;
      sprite.width = container.w;
      sprite.height = container.h;
      sprite.alpha = 0;
      s.app.stage.addChild(sprite);
      s.domSprite = sprite;

      // Pulse: fade in to 0.18, breathe between 0.10 and 0.22, fast easing.
      // Reads as "the system is alive and chewing on this image" without
      // ever distracting from the eventual reveal.
      const t0 = performance.now();
      const tick = () => {
        const cur = stateRef.current;
        if (!cur || cur.domSprite !== sprite) return;
        const t = (performance.now() - t0) / 1000;
        const ease = Math.min(1, t / 0.4);                     // 400ms fade-in
        const breath = 0.16 + 0.06 * Math.sin(t * 2.4);        // gentle pulse
        sprite.alpha = ease * breath;
        cur.app.renderer.render(cur.app.stage);
        cur.loadingTickerId = requestAnimationFrame(tick);
      };
      s.loadingTickerId = requestAnimationFrame(tick);
    },

    reset() {
      const s = stateRef.current;
      if (!s) return;
      if (s.loadingTickerId != null) {
        cancelAnimationFrame(s.loadingTickerId);
        s.loadingTickerId = null;
      }
      if (s.domSprite) {
        s.app.stage.removeChild(s.domSprite);
        s.domSprite.destroy();
        s.domSprite = null;
      }
    },
  };
}
