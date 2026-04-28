import { useEffect, useMemo, useRef } from "react";
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
  domSprite: Sprite | null;
  loadingTickerId: number | null;
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
  drawFrame: (recX: Uint16Array, recY: Uint16Array, scale: number, N: number, f: number) => void;
  fadeInDom: (
    sourceCanvas: HTMLCanvasElement,
    container: ContainerSize,
    containerLeft: number,
    containerTop: number,
    drawLastFrame: () => void,
  ) => void;
  clearParticles: () => void;
  showLoading: (
    sourceCanvas: HTMLCanvasElement,
    container: ContainerSize,
    containerLeft: number,
    containerTop: number,
  ) => void;
  reset: () => void;
}

function placeSprite(s: Sprite, container: ContainerSize, x: number, y: number) {
  s.x = x;
  s.y = y;
  s.width = container.w;
  s.height = container.h;
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
        // Transparent so the body's theme background shows through.
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
        domSprite: null,
        loadingTickerId: null,
      };
    })();
    // No cleanup: this hook owns the singleton WebGL/WebGPU app for the
    // lifetime of the page. Destroying it under StrictMode's double-mount
    // races the in-flight init promise and leaves stateRef pointing at a
    // dead Application.
  }, [canvasRef]);

  // Stable handle so consumers' `useCallback`s with `renderer` in deps don't
  // re-fire every render. Methods only read stateRef.current, so [] is safe.
  return useMemo<RendererHandle>(() => ({
    ready: () => readyRef.current ?? Promise.resolve(),

    bake(recX, recY, scale, N, total, sourceCanvas, container, cLeft, cTop, ballRadius) {
      const s = stateRef.current;
      if (!s) return 0;
      const { particleContainer, circleTexture } = s;
      const data = sourceCanvas.getContext("2d")!.getImageData(0, 0, container.w, container.h).data;

      // Reallocate every run. Reusing particles between runs has bitten us
      // with stale tints / positions producing scrambled images.
      for (const p of s.pixiParticles) if (p) particleContainer.removeParticle(p);
      const particles: (Particle | null)[] = new Array(N).fill(null);
      s.pixiParticles = particles;

      const lastOff = (total - 1) * N;
      const radiusScale = (ballRadius * 2) / CIRCLE_TEX_SIZE;
      let colored = 0;
      for (let i = 0; i < N; i++) {
        const qx = recX[lastOff + i];
        const qy = recY[lastOff + i];
        if (qx === 0 && qy === 0) continue;
        const ix = ((qx / scale) - cLeft) | 0;
        const iy = ((qy / scale) - cTop) | 0;
        if (ix < 0 || ix >= container.w || iy < 0 || iy >= container.h) continue;
        const pi = (iy * container.w + ix) * 4;
        if (data[pi + 3] < 32) continue;
        const tint = (data[pi] << 16) | (data[pi + 1] << 8) | data[pi + 2];
        const p = new Particle({
          texture: circleTexture,
          x: -9999, y: -9999,
          scaleX: radiusScale,
          scaleY: radiusScale,
          anchorX: 0.5,
          anchorY: 0.5,
          tint,
        });
        particleContainer.addParticle(p);
        particles[i] = p;
        colored++;
      }
      return colored;
    },

    drawFrame(recX, recY, scale, N, f) {
      const s = stateRef.current;
      if (!s) return;
      const f0 = Math.floor(f);
      const t = f - f0;
      const off0 = f0 * N;
      const inv = 1 / scale;
      const particles = s.pixiParticles;
      if (t === 0) {
        // Integer frame — fast path, no interpolation needed.
        for (let i = 0; i < N; i++) {
          const p = particles[i];
          if (!p) continue;
          const qx = recX[off0 + i];
          const qy = recY[off0 + i];
          if (qx === 0 && qy === 0) {
            p.x = -9999; p.y = -9999;
          } else {
            p.x = qx * inv;
            p.y = qy * inv;
          }
        }
      } else {
        // Slow playback (playSpeed < 1) draws the same recorded frame across
        // multiple rAFs without smoothing — visually choppy. Lerp between
        // f0 and f0+1 to recover frame-rate feel at fractional positions.
        const off1 = off0 + N;
        for (let i = 0; i < N; i++) {
          const p = particles[i];
          if (!p) continue;
          const qx0 = recX[off0 + i];
          const qy0 = recY[off0 + i];
          if (qx0 === 0 && qy0 === 0) {
            p.x = -9999; p.y = -9999;
            continue;
          }
          const qx1 = recX[off1 + i];
          const qy1 = recY[off1 + i];
          if (qx1 === 0 && qy1 === 0) {
            // Particle vanishes next frame — hold current rather than lerp
            // toward the off-screen sentinel.
            p.x = qx0 * inv;
            p.y = qy0 * inv;
          } else {
            p.x = (qx0 + (qx1 - qx0) * t) * inv;
            p.y = (qy0 + (qy1 - qy0) * t) * inv;
          }
        }
      }
      s.app.renderer.render(s.app.stage);
    },

    fadeInDom(sourceCanvas, container, cLeft, cTop, drawLast) {
      const s = stateRef.current;
      if (!s) return;
      if (s.domSprite) {
        s.app.stage.removeChild(s.domSprite);
        s.domSprite.destroy({ texture: true });
      }
      const tex = Texture.from(sourceCanvas);
      tex.source.update?.();
      const sprite = new Sprite(tex);
      placeSprite(sprite, container, cLeft, cTop);
      sprite.alpha = 0;
      s.app.stage.addChild(sprite);
      s.domSprite = sprite;

      let alpha = 0;
      const tick = () => {
        alpha = Math.min(1, alpha + 0.05);
        sprite.alpha = alpha;
        drawLast();
        if (alpha < 1) requestAnimationFrame(tick);
      };
      tick();
    },

    clearParticles() {
      const s = stateRef.current;
      if (!s) return;
      for (const p of s.pixiParticles) if (p) s.particleContainer.removeParticle(p);
      s.pixiParticles = [];
      // Force a render so the canvas blanks immediately rather than waiting
      // on the next drawFrame (which can be seconds away during precompute).
      s.app.renderer.render(s.app.stage);
    },

    showLoading(sourceCanvas, container, cLeft, cTop) {
      const s = stateRef.current;
      if (!s) return;
      if (s.loadingTickerId != null) cancelAnimationFrame(s.loadingTickerId);
      if (s.domSprite) {
        s.app.stage.removeChild(s.domSprite);
        s.domSprite.destroy({ texture: true });
      }
      const tex = Texture.from(sourceCanvas);
      tex.source.update?.();
      const sprite = new Sprite(tex);
      placeSprite(sprite, container, cLeft, cTop);
      sprite.alpha = 0;
      s.app.stage.addChild(sprite);
      s.domSprite = sprite;

      const t0 = performance.now();
      const tick = () => {
        const cur = stateRef.current;
        if (!cur || cur.domSprite !== sprite) return;
        const t = (performance.now() - t0) / 1000;
        const ease = Math.min(1, t / 0.4);
        const breath = 0.16 + 0.06 * Math.sin(t * 2.4);
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
        s.domSprite.destroy({ texture: true });
        s.domSprite = null;
      }
    },
  }), []);
}
