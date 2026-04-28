import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Moon, Play, Sun } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { ImagePicker } from "@/components/ImagePicker";
import { QualityPicker } from "@/components/QualityPicker";
import { HolesPanel } from "@/components/HolesPanel";
import { HoleEditor } from "@/components/HoleEditor";
import { HoleInlineEditor } from "@/components/HoleInlineEditor";
import { InfoLabel } from "@/components/InfoLabel";
import { SAMPLES, type Drawer } from "@/lib/samples";
import {
  type Hole,
  type SimParams,
  type WorkerMessage,
  containerForAR,
  deriveQuality,
  HOLE_DEFAULT_CONE,
  HOLE_DEFAULT_SPEED,
  mirrorH as mirrorHFn,
  mirrorV as mirrorVFn,
} from "@/lib/types";
import { usePixiRenderer } from "@/hooks/usePixiRenderer";
import { cn } from "@/lib/utils";

const DEFAULT_PARAMS: SimParams = {
  QUALITY: "medium",
  RESTITUTION: 0.08,
  BALL_FRICTION: 0.55,
  GRAVITY: 1.0,
};

const DEFAULT_HOLES: Hole[] = [
  { side: "bottom", offset: 0.5, width: 100, angle: 0 },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = usePixiRenderer(canvasRef);

  const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [holes, setHoles] = useState<Hole[]>(DEFAULT_HOLES);
  const [selectedHole, setSelectedHole] = useState(-1);
  const [seed, setSeed] = useState(() => (Math.random() * 1e9) | 0);

  const [phase, setPhase] = useState<
    "loading" | "idle" | "precomputing" | "fountaining" | "settled" | "error"
  >("loading");
  const [progress, setProgress] = useState(0);
  const [colored, setColored] = useState(0);
  const [hasCache, setHasCache] = useState(false);
  // Mirrors `dirtyRef` for rendering. dirtyRef stays for synchronous
  // checks inside callbacks; this is purely the visual flag for "New run".
  const [dirty, setDirty] = useState(true);

  const [imageKey, setImageKey] = useState("reveal");
  const [imgAR, setImgAR] = useState(SAMPLES.reveal.ar);
  const drawerRef = useRef<Drawer>(SAMPLES.reveal.draw);

  const [showSource, setShowSource] = useState(false);

  // Theme — persisted across reloads, applied as a `dark` class on <html>.
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
    if (stored === "light" || stored === "dark") return stored;
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const containerSize = useMemo(() => containerForAR(imgAR), [imgAR]);
  const derived = useMemo(
    () => deriveQuality(params.QUALITY, containerSize),
    [params.QUALITY, containerSize],
  );

  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  if (!sourceCanvasRef.current) {
    sourceCanvasRef.current = document.createElement("canvas");
  }
  useEffect(() => {
    const c = sourceCanvasRef.current!;
    c.width = containerSize.w;
    c.height = containerSize.h;
  }, [containerSize.w, containerSize.h]);

  const renderSource = useCallback(() => {
    const c = sourceCanvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawerRef.current(ctx, { w: c.width, h: c.height });
  }, []);

  const workerRef = useRef<Worker | null>(null);
  if (!workerRef.current) {
    workerRef.current = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
  }

  const recRef = useRef<{
    recX: Uint16Array;
    recY: Uint16Array;
    scale: number;
    N: number;
    total: number;
  } | null>(null);

  const dirtyRef = useRef(true);
  const markDirty = () => {
    dirtyRef.current = true;
    setDirty(true);
  };
  const playingRef = useRef(false);
  const frameRef = useRef(0);

  const tick = useCallback(() => {
    const rec = recRef.current;
    if (!rec || !playingRef.current) return;
    renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, frameRef.current);
    frameRef.current++;
    if (frameRef.current >= rec.total) {
      playingRef.current = false;
      setPhase("settled");
      renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      return;
    }
    requestAnimationFrame(tick);
  }, [renderer]);

  // Run a fresh precompute. Bumps the seed so each "New run" yields
  // different stochastic emission, and resets dirty state when the
  // worker completes successfully.
  const newRun = useCallback(() => {
    const w = workerRef.current!;
    const nextSeed = (Math.random() * 1e9) | 0;
    setSeed(nextSeed);
    setPhase("precomputing");
    setProgress(0);
    setShowSource(false);
    playingRef.current = false;
    renderer.reset();

    const cLeft = viewport.w / 2 - containerSize.w / 2;
    const cTop = viewport.h / 2 - containerSize.h / 2;

    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "ready") return;
      if (msg.type === "progress") {
        setProgress(msg.pct / 100);
      } else if (msg.type === "error") {
        setPhase("error");
        // eslint-disable-next-line no-console
        console.error("[worker]", msg.message);
      } else if (msg.type === "done") {
        recRef.current = {
          recX: msg.recX,
          recY: msg.recY,
          scale: msg.scale,
          N: msg.N,
          total: msg.TOTAL,
        };
        setHasCache(true);
        renderSource();
        const c = renderer.bake(
          msg.recX, msg.recY, msg.scale, msg.N, msg.TOTAL,
          sourceCanvasRef.current!, containerSize, cLeft, cTop, derived.ballRadius,
        );
        setColored(c);
        dirtyRef.current = false;
        setDirty(false);
        frameRef.current = 0;
        playingRef.current = true;
        setPhase("fountaining");
        setProgress(1);
        requestAnimationFrame(tick);
      }
    };
    w.postMessage({
      type: "precompute",
      seed: nextSeed,
      params: {
        BALLS_PER_FRAME: derived.ballsPerFrame,
        SPAWN_FRAMES: derived.spawnFrames,
        SETTLE_FRAMES: derived.settleFrames,
        BALL_RADIUS: derived.ballRadius,
        RESTITUTION: params.RESTITUTION,
        BALL_FRICTION: params.BALL_FRICTION,
        GRAVITY: params.GRAVITY,
        holes: holes.map((h) => ({ ...h })),
        containerW: containerSize.w,
        containerH: containerSize.h,
      },
      viewport: { W: viewport.w, H: viewport.h },
    });
  }, [renderer, viewport, params, holes, containerSize, derived, renderSource, tick]);

  // Pure cache playback. Never triggers precompute. Available whenever a
  // cached recording exists — even mid-precompute (you'll be re-watching
  // the previous run).
  const replay = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    setShowSource(false);
    renderer.reset();
    playingRef.current = false;
    frameRef.current = 0;
    playingRef.current = true;
    setPhase("fountaining");
    requestAnimationFrame(tick);
  }, [renderer, tick]);

  const toggleSource = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (showSource) {
      renderer.reset();
      renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      setShowSource(false);
    } else {
      const cLeft = viewport.w / 2 - containerSize.w / 2;
      const cTop = viewport.h / 2 - containerSize.h / 2;
      renderer.fadeInDom(sourceCanvasRef.current!, containerSize, cLeft, cTop, () => {
        renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      });
      setShowSource(true);
    }
  }, [renderer, showSource, viewport, containerSize]);

  // First run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await renderer.ready();
      if (cancelled) return;
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      newRun();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onImageSelect = useCallback((key: string, drawer: Drawer, ar: number) => {
    drawerRef.current = drawer;
    setImageKey(key);
    if (Math.abs(ar - imgAR) > 0.001) {
      setImgAR(ar);
      markDirty();
    } else {
      // Same AR — re-bake colors against existing record without dirtying.
      renderSource();
      const rec = recRef.current;
      if (rec) {
        const cLeft = viewport.w / 2 - containerSize.w / 2;
        const cTop = viewport.h / 2 - containerSize.h / 2;
        const c = renderer.bake(
          rec.recX, rec.recY, rec.scale, rec.N, rec.total,
          sourceCanvasRef.current!, containerSize, cLeft, cTop, derived.ballRadius,
        );
        setColored(c);
        const f = playingRef.current
          ? frameRef.current
          : Math.max(0, Math.min(frameRef.current, rec.total - 1));
        renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, f);
      }
    }
  }, [renderer, viewport.w, viewport.h, derived.ballRadius, renderSource, imgAR, containerSize]);

  const lastARRef = useRef(imgAR);
  useEffect(() => {
    if (lastARRef.current === imgAR) return;
    lastARRef.current = imgAR;
    if (recRef.current) newRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgAR]);

  const setParam = useCallback(<K extends keyof SimParams>(k: K, v: SimParams[K]) => {
    setParams((p) => ({ ...p, [k]: v }));
    markDirty();
  }, []);

  const setHolesUpdating = useCallback((next: Hole[]) => {
    setHoles(next);
    markDirty();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "r") replay();
      if (e.key === "Enter" && dirtyRef.current) newRun();
      if ((e.key === "Backspace" || e.key === "Delete") && selectedHole >= 0 && holes.length > 1) {
        setHolesUpdating(holes.filter((_, i) => i !== selectedHole));
        setSelectedHole(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, newRun, holes, selectedHole, setHolesUpdating]);

  const addHole = () => {
    const sides = ["bottom", "top", "left", "right"] as const;
    const next = sides[holes.length % sides.length];
    setHolesUpdating([
      ...holes,
      { side: next, offset: 0.5, width: 100, angle: 0, speed: HOLE_DEFAULT_SPEED, cone: HOLE_DEFAULT_CONE },
    ]);
    setSelectedHole(holes.length);
  };

  const updateSelectedHole = (patch: Partial<Hole>) => {
    if (selectedHole < 0) return;
    setHolesUpdating(holes.map((h, i) => (i === selectedHole ? { ...h, ...patch } : h)));
  };
  const deleteSelectedHole = () => {
    if (selectedHole < 0 || holes.length <= 1) return;
    setHolesUpdating(holes.filter((_, i) => i !== selectedHole));
    setSelectedHole(-1);
  };
  const mirrorSelectedH = () => {
    if (selectedHole < 0) return;
    const m = mirrorHFn(holes[selectedHole]);
    setHolesUpdating([...holes, m]);
    setSelectedHole(holes.length);
  };
  const mirrorSelectedV = () => {
    if (selectedHole < 0) return;
    const m = mirrorVFn(holes[selectedHole]);
    setHolesUpdating([...holes, m]);
    setSelectedHole(holes.length);
  };

  function phaseToLabel(): string {
    switch (phase) {
      case "precomputing": return "computing";
      case "fountaining":  return "falling";
      case "settled":      return "ready";
      case "error":        return "error";
      case "loading":      return "loading";
      default:             return "idle";
    }
  }
  const phaseLabel = phaseToLabel();

  function statusDotClass(): string {
    if (phase === "settled") return "bg-foreground/80";
    if (phase === "error") return "bg-destructive";
    return "bg-foreground/60 animate-pulse";
  }

  const canReplay = hasCache;
  const canNewRun = dirty || phase === "loading" || phase === "error";

  return (
    <TooltipProvider delayDuration={150}>
      <canvas ref={canvasRef} className="fixed inset-0 z-0" />

      {/* Soft warm vignette around the canvas — wallpaper feel. Derives from
          --primary so the glow tints with the accent in either theme. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(80%_60%_at_50%_0%,hsl(var(--primary)/0.10),transparent_70%),radial-gradient(80%_60%_at_50%_100%,hsl(var(--primary)/0.14),transparent_70%)]"
      />

      <HoleEditor
        holes={holes}
        selected={selectedHole}
        viewport={viewport}
        container={containerSize}
        onChange={setHolesUpdating}
        onSelect={setSelectedHole}
      />

      {/* LEFT — Scene. Full-height, flush left, hairline border on inner edge. */}
      <aside className="fixed inset-y-0 left-0 z-10 flex w-[300px] flex-col overflow-hidden border-r border-border/60 glass warm-vignette">
        <header className="flex items-baseline justify-between border-b border-border/60 px-4 py-3.5">
          <h3 className="display text-[22px] leading-none">
            reveal<span className="display-italic text-primary">.</span>
          </h3>
          <span className="display-italic text-[13px] text-muted-foreground/70">
            scene
          </span>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5 pt-4">
          <section>
            <div className="mb-2.5">
              <InfoLabel
                tip="The picture you want the settled balls to recreate. Each ball samples a pixel color at its final resting position."
                className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
              >
                Source
              </InfoLabel>
            </div>
            <ImagePicker selected={imageKey} onSelect={onImageSelect} />
          </section>
          <section>
            <div className="mb-2.5">
              <InfoLabel
                tip="Bundles ball radius, emission rate, and settle time into one knob. Total ball count is auto-sized to fill the container at the chosen density."
                className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
              >
                Quality
              </InfoLabel>
            </div>
            <QualityPicker
              value={params.QUALITY}
              container={containerSize}
              onChange={(q) => setParam("QUALITY", q)}
            />
          </section>
        </div>
      </aside>

      {/* RIGHT — Physics. Full-height, flush right, hairline border on inner edge. */}
      <aside className="fixed inset-y-0 right-0 z-10 flex w-[320px] flex-col overflow-hidden border-l border-border/60 glass warm-vignette">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
          <h3 className="display text-[22px] leading-none">physics</h3>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="grid size-7 place-items-center rounded-md border border-border/60 bg-card/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5 pt-4">
          {/* FEEL first — fixed-height section, never shifts when holes change. */}
          <section>
            <div className="mb-2.5">
              <InfoLabel
                tip="The three sliders that change how the simulation feels. Tooltips on each label explain what they do."
                className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
              >
                Feel
              </InfoLabel>
            </div>
            <BigSlider
              label="gravity"
              tip="Downward acceleration in pixels per frame². 0 = zero-G (balls drift on momentum and walls); 1.0 ≈ 7g (the default — fast-settling pile)."
              value={params.GRAVITY}
              min={0} max={2.5} step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setParam("GRAVITY", v)}
            />
            <BigSlider
              label="restitution"
              tip="Bounciness of ball-on-ball and ball-on-wall collisions. 0 = clay (no bounce, balls stick where they land — best for crisp lattices); 1 = perfect rebound."
              value={params.RESTITUTION}
              min={0} max={1} step={0.02}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setParam("RESTITUTION", v)}
            />
            <BigSlider
              label="friction"
              tip="Coulomb friction at every contact. 0 = ice (piles slump); 1 = sandpaper (lattice grains lock in place and grain boundaries persist)."
              value={params.BALL_FRICTION}
              min={0} max={1} step={0.02}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setParam("BALL_FRICTION", v)}
            />
          </section>

          {/* HOLES second — variable-height (list grows, editor toggles). */}
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <InfoLabel
                tip="Spots on the container walls where balls erupt from. Drag the handle on the canvas to move; drag the rotation grip to aim. Right-click a hole to delete."
                className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
              >
                Holes
              </InfoLabel>
              <span className="mono text-[10.5px] tabular-nums text-muted-foreground/60">
                {holes.length}
              </span>
            </div>
            <HolesPanel
              holes={holes}
              selected={selectedHole}
              onChange={setHolesUpdating}
              onSelect={setSelectedHole}
              onAdd={addHole}
            />
            {selectedHole >= 0 && holes[selectedHole] && (
              <HoleInlineEditor
                hole={holes[selectedHole]}
                index={selectedHole}
                totalHoles={holes.length}
                onChange={updateSelectedHole}
                onDelete={deleteSelectedHole}
                onDeselect={() => setSelectedHole(-1)}
                onMirrorH={mirrorSelectedH}
                onMirrorV={mirrorSelectedV}
              />
            )}
          </section>
        </div>

        {/* Footer — auxiliary metadata (container size). */}
        <footer className="border-t border-border/60 px-4 py-2.5">
          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground/60">
            <span className="display-italic">container</span>
            <span className="mono tabular-nums">
              {containerSize.w} × {containerSize.h}
            </span>
          </div>
        </footer>
      </aside>

      {/* BOTTOM — two-pill dock: a status pill and a beefier action pill
          containing both secondary icon actions and the primary CTA. Each
          pill has fixed-width sub-columns so dynamic text never shifts the
          layout. */}
      <div
        className="pointer-events-none fixed bottom-5 z-[4] flex items-center justify-center gap-2.5"
        style={{ left: 300, right: 320 }}
      >
        {/* Status pill — fixed width, phase + count, progress underline. */}
        <div className="pointer-events-auto relative grid h-11 w-[230px] grid-cols-[14px_1fr_8px_auto] items-center gap-2 overflow-hidden rounded-full glass px-4 text-[12px] tabular-nums">
          <span className={cn("size-2 rounded-full transition-colors", statusDotClass())} />
          <span className="font-medium tracking-tight text-foreground/90">
            {phaseLabel}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-right text-muted-foreground/80">
            <b className="font-medium text-foreground/90">{colored.toLocaleString()}</b>
            <span className="ml-1">balls</span>
          </span>
          {/* Progress line */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute bottom-0 left-0 col-span-full h-[2px] origin-left bg-primary",
              "transition-[transform,opacity] duration-200 ease-fluid",
              phase === "precomputing" ? "opacity-100" : "opacity-0",
            )}
            style={{ width: "100%", transform: `scaleX(${progress})` }}
          />
        </div>

        {/* Action pill — secondary icons + primary CTA, all in one piece. */}
        <div className="pointer-events-auto flex h-11 items-stretch overflow-hidden rounded-full glass">
          <button
            onClick={replay}
            disabled={!canReplay}
            title="Replay the last run from cache"
            className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Play className="size-4" strokeWidth={1.8} />
          </button>
          <button
            onClick={toggleSource}
            disabled={phase !== "settled"}
            title={sourceButtonTitle(phase, showSource)}
            className={cn(
              "grid w-10 place-items-center transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
              showSource ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground",
            )}
          >
            {showSource ? <EyeOff className="size-4" strokeWidth={1.8} /> : <Eye className="size-4" strokeWidth={1.8} />}
          </button>

          <div className="my-2 w-px bg-border/60" />

          <button
            onClick={newRun}
            disabled={!canNewRun || phase === "precomputing"}
            title={
              !canNewRun
                ? "Nothing has changed since the last run."
                : "Re-run physics with the current parameters."
            }
            className={cn(
              "flex w-[140px] items-center justify-center gap-2 text-[13px] font-medium tracking-tight transition-colors",
              canNewRun && phase !== "precomputing"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-foreground/[0.05] text-muted-foreground/70",
              "disabled:pointer-events-none",
            )}
          >
            <span>Reveal</span>
            <kbd className={cn(
              "rounded px-1.5 py-0.5 text-[10px] mono",
              canNewRun && phase !== "precomputing"
                ? "bg-primary-foreground/15 text-primary-foreground/80"
                : "bg-foreground/[0.06] text-muted-foreground/60",
            )}>⏎</kbd>
          </button>
        </div>
      </div>
    </TooltipProvider>
  );
}

function sourceButtonTitle(phase: string, showSource: boolean): string {
  if (phase !== "settled") return "Available once balls have settled.";
  return showSource ? "Hide the source image overlay." : "Overlay the source image for comparison.";
}

function BigSlider({
  label, tip, value, min, max, step, format, onChange,
}: {
  label: string;
  tip: string;
  value: number;
  min: number; max: number; step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between">
        <InfoLabel
          tip={tip}
          className="text-[10px] uppercase tracking-[0.10em] text-muted-foreground/70"
        >
          {label}
        </InfoLabel>
        <span className="mono text-[10px] tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
