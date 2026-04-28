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

      let particles = s.pixiParticles;
      let visible = s.visible;
      if (!particles || particles.length !== N) {
        for (const p of particles) if (p) particleContainer.removeParticle(p);
        particles = new Array(N).fill(null);
        visible = new Uint8Array(N);
        s.pixiParticles = particles;
        s.visible = visible;
      } else {
        visible.fill(0);
      }
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

    reset() {
      const s = stateRef.current;
      if (!s) return;
      if (s.domSprite) {
        s.app.stage.removeChild(s.domSprite);
        s.domSprite.destroy();
        s.domSprite = null;
      }
    },
  };
}
