import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Moon, Play, Sun, X } from "lucide-react";
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
  type Phase,
  type SimParams,
  type WorkerMessage,
  containerForAR,
  deriveQuality,
  makeHole,
  mirrorH as mirrorHFn,
  mirrorV as mirrorVFn,
} from "@/lib/types";
import { usePixiRenderer } from "@/hooks/usePixiRenderer";
import { cn } from "@/lib/utils";

const LEFT_PANEL_W = 300;
const RIGHT_PANEL_W = 320;

const DEFAULT_PARAMS: SimParams = {
  QUALITY: "medium",
  RESTITUTION: 0.08,
  BALL_FRICTION: 0,
  GRAVITY: 0,
};

const DEFAULT_HOLES: Hole[] = [makeHole("bottom")];

const SECTION_LABEL = "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = usePixiRenderer(canvasRef);

  const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [holes, setHoles] = useState<Hole[]>(DEFAULT_HOLES);
  const [selectedHole, setSelectedHole] = useState(-1);

  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [colored, setColored] = useState(0);
  const [hasCache, setHasCache] = useState(false);
  // Mirror of dirtyRef. The ref is for synchronous reads inside callbacks;
  // this drives re-renders of the Reveal CTA.
  const [dirty, setDirty] = useState(true);

  const [imageKey, setImageKey] = useState("reveal");
  const [imgAR, setImgAR] = useState(SAMPLES.reveal.ar);
  const drawerRef = useRef<Drawer>(SAMPLES.reveal.draw);

  const [showSource, setShowSource] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
    if (stored === "light" || stored === "dark") return stored;
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
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

  const containerOrigin = useMemo(() => ({
    left: viewport.w / 2 - containerSize.w / 2,
    top: viewport.h / 2 - containerSize.h / 2,
  }), [viewport.w, viewport.h, containerSize.w, containerSize.h]);

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
    workerRef.current = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  }
  // No cleanup: worker is a page-lifetime singleton. Terminating on unmount
  // races StrictMode's double-mount and orphans the in-flight first-run
  // precompute (its "done" arrives at a freshly-spawned successor with no
  // matching seed and gets dropped, leaving the user stuck at 0%).

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
  // Seed of the most recently *requested* precompute. The handler checks
  // every message against this so a previous run's "done" can't get baked
  // into the renderer with the latest closure's params.
  const latestSeedRef = useRef(0);

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

  const newRun = useCallback(() => {
    const w = workerRef.current!;
    const nextSeed = (Math.random() * 1e9) | 0;
    latestSeedRef.current = nextSeed;
    setPhase("precomputing");
    setProgress(0);
    setShowSource(false);
    playingRef.current = false;
    recRef.current = null;
    frameRef.current = 0;
    renderer.reset();

    const { left: cLeft, top: cTop } = containerOrigin;

    renderer.clearParticles();
    renderSource();
    renderer.showLoading(sourceCanvasRef.current!, containerSize, cLeft, cTop);

    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "ready") return;
      if ("seed" in msg && msg.seed !== latestSeedRef.current) return;
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
        renderer.reset();
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
        holes,
        containerW: containerSize.w,
        containerH: containerSize.h,
      },
      viewport: { W: viewport.w, H: viewport.h },
    });
  }, [renderer, viewport, params, holes, containerSize, containerOrigin, derived, renderSource, tick]);

  // Worker is single-threaded synchronous, so we terminate + respawn to
  // actually stop a precompute mid-flight.
  const cancelRun = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    latestSeedRef.current = -1;
    setProgress(0);
    renderer.reset();
    playingRef.current = false;
    recRef.current = null;
    frameRef.current = 0;
    setPhase(hasCache ? "settled" : "idle");
    dirtyRef.current = true;
    setDirty(true);
  }, [renderer, hasCache]);

  const replay = useCallback(() => {
    if (!recRef.current) return;
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
      const { left, top } = containerOrigin;
      renderer.fadeInDom(sourceCanvasRef.current!, containerSize, left, top, () => {
        renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      });
      setShowSource(true);
    }
  }, [renderer, showSource, containerSize, containerOrigin]);

  // First run on mount.
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
      return;
    }
    // Same AR — re-bake colors in place against the existing record.
    renderSource();
    const rec = recRef.current;
    if (!rec) return;
    const { left, top } = containerOrigin;
    const c = renderer.bake(
      rec.recX, rec.recY, rec.scale, rec.N, rec.total,
      sourceCanvasRef.current!, containerSize, left, top, derived.ballRadius,
    );
    setColored(c);
    const f = playingRef.current
      ? frameRef.current
      : Math.max(0, Math.min(frameRef.current, rec.total - 1));
    renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, f);
  }, [renderer, derived.ballRadius, renderSource, imgAR, containerSize, containerOrigin]);

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

  // Bind global keydown once and read latest handlers/state via refs so the
  // listener doesn't tear down + re-bind on every keystroke or slider drag.
  const newRunRef = useRef(newRun);
  const replayRef = useRef(replay);
  const cancelRef = useRef(cancelRun);
  const stateRef = useRef({ phase, holes, selectedHole, setHolesUpdating, setSelectedHole });
  useEffect(() => {
    newRunRef.current = newRun;
    replayRef.current = replay;
    cancelRef.current = cancelRun;
    stateRef.current = { phase, holes, selectedHole, setHolesUpdating, setSelectedHole };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = stateRef.current;
      if (e.key === "r") replayRef.current();
      if (e.key === "Enter" && dirtyRef.current && s.phase !== "precomputing") newRunRef.current();
      if (e.key === "Escape" && s.phase === "precomputing") cancelRef.current();
      if ((e.key === "Backspace" || e.key === "Delete") && s.selectedHole >= 0 && s.holes.length > 1) {
        s.setHolesUpdating(s.holes.filter((_, i) => i !== s.selectedHole));
        s.setSelectedHole(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addHole = () => {
    const sides = ["bottom", "top", "left", "right"] as const;
    setHolesUpdating([...holes, makeHole(sides[holes.length % sides.length])]);
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
  const mirrorSelected = (fn: (h: Hole) => Hole) => () => {
    if (selectedHole < 0) return;
    setHolesUpdating([...holes, fn(holes[selectedHole])]);
    setSelectedHole(holes.length);
  };

  const phaseLabel = (
    phase === "precomputing" ? "computing" :
    phase === "fountaining" ? "falling" :
    phase === "settled" ? "ready" :
    phase
  );

  const statusDot = (
    phase === "settled" ? "bg-foreground/80" :
    phase === "error" ? "bg-destructive" :
    "bg-foreground/60 animate-pulse"
  );

  const canReplay = hasCache;
  const canNewRun = dirty || phase === "loading" || phase === "error";

  return (
    <TooltipProvider delayDuration={150}>
      <canvas ref={canvasRef} className="fixed inset-0 z-0" />

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

      <aside
        className="fixed inset-y-0 left-0 z-10 flex flex-col overflow-hidden border-r border-border/60 glass warm-vignette"
        style={{ width: LEFT_PANEL_W }}
      >
        <header className="flex items-baseline justify-between border-b border-border/60 px-4 py-3.5">
          <h3 className="display text-[22px] leading-none">
            reveal<span className="display-italic text-primary">.</span>
          </h3>
          <span className="display-italic text-[13px] text-muted-foreground/70">scene</span>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5 pt-4">
          <section>
            <div className="mb-2.5">
              <InfoLabel
                tip="The picture you want the settled balls to recreate. Each ball samples a pixel color at its final resting position."
                className={SECTION_LABEL}
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
                className={SECTION_LABEL}
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

      <aside
        className="fixed inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l border-border/60 glass warm-vignette"
        style={{ width: RIGHT_PANEL_W }}
      >
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
          {/* Feel above Holes — Holes is variable-height, putting it last
              keeps the slider section anchored when holes are added/edited. */}
          <section>
            <div className="mb-2.5">
              <InfoLabel
                tip="The three sliders that change how the simulation feels. Tooltips on each label explain what they do."
                className={SECTION_LABEL}
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

          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <InfoLabel
                tip="Spots on the container walls where balls erupt from. Drag the handle on the canvas to move; drag the rotation grip to aim. Right-click a hole to delete."
                className={SECTION_LABEL}
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
                onMirrorH={mirrorSelected(mirrorHFn)}
                onMirrorV={mirrorSelected(mirrorVFn)}
              />
            )}
          </section>
        </div>

        <footer className="border-t border-border/60 px-4 py-2.5">
          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground/60">
            <span className="display-italic">container</span>
            <span className="mono tabular-nums">
              {containerSize.w} × {containerSize.h}
            </span>
          </div>
        </footer>
      </aside>

      <div
        className="pointer-events-none fixed bottom-5 z-[4] flex items-center justify-center"
        style={{ left: LEFT_PANEL_W, right: RIGHT_PANEL_W }}
      >
        {phase === "precomputing" ? (
          <div className="pointer-events-auto relative flex h-11 items-stretch overflow-hidden rounded-full glass">
            <div className="flex items-center gap-3 pl-4 pr-3 text-[12px]">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
              <span className="font-medium tracking-tight text-foreground/90">computing</span>
              <span aria-hidden className="relative ml-1 h-[5px] w-[140px] overflow-hidden rounded-full bg-foreground/[0.08]">
                <span
                  className="absolute inset-y-0 left-0 origin-left rounded-full bg-primary transition-transform duration-200 ease-fluid"
                  style={{ width: "100%", transform: `scaleX(${progress})` }}
                />
              </span>
              <span className="mono w-9 tabular-nums text-right text-[11px] text-muted-foreground/80">
                {Math.round(progress * 100)}%
              </span>
            </div>

            <div className="my-2 w-px bg-border/60" />

            <button
              onClick={cancelRun}
              title="Cancel this precompute (Esc)"
              className="flex items-center gap-1.5 px-4 text-[12.5px] font-medium tracking-tight text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto relative flex h-11 items-stretch overflow-hidden rounded-full glass">
            <div className="flex items-center gap-2 px-4 text-[12px] tabular-nums">
              <span className={cn("size-2 shrink-0 rounded-full transition-colors", statusDot)} />
              <span className="font-medium tracking-tight text-foreground/90">{phaseLabel}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/80">
                <b className="font-medium text-foreground/90">{colored.toLocaleString()}</b>
                <span className="ml-1">balls</span>
              </span>
            </div>

            <div className="my-2 w-px bg-border/60" />

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
              disabled={!canNewRun}
              title={canNewRun ? "Re-run physics with the current parameters." : "Nothing has changed since the last run."}
              className={cn(
                "flex w-[140px] items-center justify-center gap-2 text-[13px] font-medium tracking-tight transition-colors disabled:pointer-events-none",
                canNewRun
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-foreground/[0.05] text-muted-foreground/70",
              )}
            >
              <span>Reveal</span>
              <kbd className={cn(
                "rounded px-1.5 py-0.5 text-[10px] mono",
                canNewRun
                  ? "bg-primary-foreground/15 text-primary-foreground/80"
                  : "bg-foreground/[0.06] text-muted-foreground/60",
              )}>⏎</kbd>
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function sourceButtonTitle(phase: Phase, showSource: boolean): string {
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
        <InfoLabel tip={tip} className="text-[10px] uppercase tracking-[0.10em] text-muted-foreground/70">
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
