import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, EyeOff, Image as ImageIcon, Moon, Play, RotateCcw, Sliders, Sun, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { ImagePicker } from "@/components/ImagePicker";
import { QualityPicker } from "@/components/QualityPicker";
import { HolesPanel } from "@/components/HolesPanel";
import { HoleEditor } from "@/components/HoleEditor";
import { HoleInlineEditor } from "@/components/HoleInlineEditor";
import { InfoLabel } from "@/components/InfoLabel";
import { PresetsPicker } from "@/components/PresetsPicker";
import { Sheet } from "@/components/Sheet";
import { SAMPLES, makeUploadDrawer, type Drawer } from "@/lib/samples";
import {
  type Phase,
  type WorkerMessage,
  containerForAR,
  deriveQuality,
} from "@/lib/types";
import { usePixiRenderer } from "@/hooks/usePixiRenderer";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSimStore } from "@/stores/useSimStore";
import { useUploadsStore } from "@/stores/useUploadsStore";

const LEFT_PANEL_W = 300;
const RIGHT_PANEL_W = 320;

const SECTION_LABEL = "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = usePixiRenderer(canvasRef);

  const params = useSettingsStore((s) => s.params);
  const setParam = useSettingsStore((s) => s.setParam);
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const setImageKey = useSettingsStore((s) => s.setImageKey);
  const playSpeed = useSettingsStore((s) => s.playSpeed);
  const setPlaySpeed = useSettingsStore((s) => s.setPlaySpeed);

  const [openSheet, setOpenSheet] = useState<"scene" | "physics" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const phase = useSimStore((s) => s.phase);
  const progress = useSimStore((s) => s.progress);
  const hasCache = useSimStore((s) => s.hasCache);
  const dirty = useSimStore((s) => s.dirty);
  const showSource = useSimStore((s) => s.showSource);
  const viewport = useSimStore((s) => s.viewport);
  const imgAR = useSimStore((s) => s.imgAR);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const containerSize = useMemo(() => containerForAR(imgAR, viewport), [imgAR, viewport]);
  const derived = useMemo(
    () => deriveQuality(params.QUALITY, containerSize),
    [params.QUALITY, containerSize],
  );

  useEffect(() => {
    const onResize = () =>
      useSimStore.getState().setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const containerOrigin = useMemo(() => ({
    left: viewport.w / 2 - containerSize.w / 2,
    top: viewport.h / 2 - containerSize.h / 2,
  }), [viewport.w, viewport.h, containerSize.w, containerSize.h]);

  const drawerRef = useRef<Drawer>(SAMPLES.spectrum.draw);

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

  const playingRef = useRef(false);
  const frameRef = useRef(0);
  // Seed of the most recently *requested* precompute. The handler checks
  // every message against this so a previous run's "done" can't get baked
  // into the renderer with the latest closure's params.
  const latestSeedRef = useRef(0);

  const tick = useCallback(() => {
    const rec = recRef.current;
    if (!rec || !playingRef.current) return;
    // Pass the fractional frame so drawFrame can lerp between f0 and f0+1
    // at slow speeds. Clamp to total-1 so we don't read past the record.
    const f = Math.min(frameRef.current, rec.total - 1);
    renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, f);
    // Playback speed only affects viewing of the cached record — the precompute
    // is unchanged. Fractional accumulation lets us go slower than 1x and skip
    // ahead for >1x without dropping the rAF cadence.
    frameRef.current += useSettingsStore.getState().playSpeed;
    if (frameRef.current >= rec.total) {
      playingRef.current = false;
      useSimStore.getState().setPhase("settled");
      renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      return;
    }
    requestAnimationFrame(tick);
  }, [renderer]);

  const newRun = useCallback(() => {
    const w = workerRef.current!;
    const sim = useSimStore.getState();
    const { params: p, holes } = useSettingsStore.getState();
    const cSize = containerForAR(sim.imgAR, sim.viewport);
    const d = deriveQuality(p.QUALITY, cSize);
    const cLeft = sim.viewport.w / 2 - cSize.w / 2;
    const cTop = sim.viewport.h / 2 - cSize.h / 2;

    const nextSeed = (Math.random() * 1e9) | 0;
    latestSeedRef.current = nextSeed;
    sim.setPhase("precomputing");
    sim.setProgress(0);
    sim.setShowSource(false);
    playingRef.current = false;
    recRef.current = null;
    frameRef.current = 0;
    renderer.reset();

    renderer.clearParticles();
    renderSource();
    renderer.showLoading(sourceCanvasRef.current!, cSize, cLeft, cTop);

    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "ready") return;
      if ("seed" in msg && msg.seed !== latestSeedRef.current) return;
      const s = useSimStore.getState();
      if (msg.type === "progress") {
        s.setProgress(msg.pct / 100);
      } else if (msg.type === "error") {
        s.setPhase("error");
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
        s.setHasCache(true);
        renderSource();
        renderer.reset();
        const c = renderer.bake(
          msg.recX, msg.recY, msg.scale, msg.N, msg.TOTAL,
          sourceCanvasRef.current!, cSize, cLeft, cTop, d.ballRadius,
        );
        s.setColored(c);
        s.setDirty(false);
        frameRef.current = 0;
        playingRef.current = true;
        s.setPhase("fountaining");
        s.setProgress(1);
        requestAnimationFrame(tick);
      }
    };
    w.postMessage({
      type: "precompute",
      seed: nextSeed,
      params: {
        BALLS_PER_FRAME: d.ballsPerFrame,
        SPAWN_FRAMES: d.spawnFrames,
        SETTLE_FRAMES: d.settleFrames,
        BALL_RADIUS: d.ballRadius,
        RESTITUTION: p.RESTITUTION,
        BALL_FRICTION: p.BALL_FRICTION,
        GRAVITY: 0,
        holes,
        containerW: cSize.w,
        containerH: cSize.h,
      },
      viewport: { W: sim.viewport.w, H: sim.viewport.h },
    });
  }, [renderer, renderSource, tick]);

  // Worker is single-threaded synchronous, so we terminate + respawn to
  // actually stop a precompute mid-flight.
  const cancelRun = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    latestSeedRef.current = -1;
    const sim = useSimStore.getState();
    sim.setProgress(0);
    renderer.reset();
    playingRef.current = false;
    recRef.current = null;
    frameRef.current = 0;
    sim.setPhase(sim.hasCache ? "settled" : "idle");
    sim.setDirty(true);
  }, [renderer]);

  const replay = useCallback(() => {
    if (!recRef.current) return;
    const sim = useSimStore.getState();
    sim.setShowSource(false);
    renderer.reset();
    playingRef.current = false;
    frameRef.current = 0;
    playingRef.current = true;
    sim.setPhase("fountaining");
    requestAnimationFrame(tick);
  }, [renderer, tick]);

  const exportVideo = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;

    // Prefer MP4 (plays everywhere — QuickTime, iOS, social uploads). Falls
    // back to WebM only on browsers without H.264 in MediaRecorder (Firefox
    // as of 2026).
    const mimeTypes = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mimeType) {
      // eslint-disable-next-line no-alert
      alert("Video export isn't supported in this browser.");
      return;
    }
    const isMp4 = mimeType.startsWith("video/mp4");
    const ext = isMp4 ? "mp4" : "webm";
    const blobType = isMp4 ? "video/mp4" : "video/webm";

    const sim = useSimStore.getState();
    const cSize = containerForAR(sim.imgAR, sim.viewport);
    const cLeft = sim.viewport.w / 2 - cSize.w / 2;
    const cTop = sim.viewport.h / 2 - cSize.h / 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    setExporting(true);
    setExportProgress(0);
    sim.setShowSource(false);

    // Stop the regular playback loop so the export tick has exclusive control.
    playingRef.current = false;
    renderer.reset();

    // Offscreen canvas — cropped to the container with a black backdrop so
    // the exported video has clean edges instead of transparent letterbox.
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.round(cSize.w * dpr);
    exportCanvas.height = Math.round(cSize.h * dpr);
    const ctx = exportCanvas.getContext("2d")!;

    // captureStream(0) means we drive frames manually via track.requestFrame()
    // so the recording is exactly rec.total frames at 60fps.
    const stream = exportCanvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start();

    const pixiCanvas = canvasRef.current!;
    // Export honors the user's playSpeed: < 1 = longer/slower video, > 1 =
    // shorter/faster. The output is recorded at rAF cadence (~60fps) so the
    // duration scales as rec.total / playSpeed seconds.
    const playSpeed = useSettingsStore.getState().playSpeed;
    let frame = 0;
    const tickExport = () => {
      if (frame >= rec.total) {
        recorder.stop();
        track.stop();
        return;
      }
      const f = Math.min(frame, rec.total - 1);
      renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, f);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      // Copy the container region from the PIXI canvas in the same task as
      // the render — most browsers preserve the drawing buffer for this
      // synchronous read even with preserveDrawingBuffer:false.
      ctx.drawImage(
        pixiCanvas,
        cLeft * dpr, cTop * dpr, cSize.w * dpr, cSize.h * dpr,
        0, 0, exportCanvas.width, exportCanvas.height,
      );
      track.requestFrame();
      frame += playSpeed;
      setExportProgress(Math.min(1, frame / rec.total));
      requestAnimationFrame(tickExport);
    };
    requestAnimationFrame(tickExport);

    await done;

    // Restore the on-screen view to the final frame.
    frameRef.current = rec.total - 1;
    renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);

    const blob = new Blob(chunks, { type: blobType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `orbserve-${ts}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExporting(false);
    setExportProgress(0);
  }, [renderer]);

  const toggleSource = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    const sim = useSimStore.getState();
    if (sim.showSource) {
      renderer.reset();
      renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      sim.setShowSource(false);
    } else {
      const cSize = containerForAR(sim.imgAR, sim.viewport);
      const left = sim.viewport.w / 2 - cSize.w / 2;
      const top = sim.viewport.h / 2 - cSize.h / 2;
      renderer.fadeInDom(sourceCanvasRef.current!, cSize, left, top, () => {
        renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, rec.total - 1);
      });
      sim.setShowSource(true);
    }
  }, [renderer]);

  // First run on mount: hydrate uploads from idb, resolve drawer from the
  // persisted imageKey (sample or upload-{id}), then kick off the sim.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await useUploadsStore.getState().hydrate();
      if (cancelled) return;
      const key = useSettingsStore.getState().imageKey;
      let drawer: Drawer = SAMPLES.spectrum.draw;
      let ar = SAMPLES.spectrum.ar;
      if (key in SAMPLES) {
        drawer = SAMPLES[key].draw;
        ar = SAMPLES[key].ar;
      } else if (key.startsWith("upload-")) {
        const entry = useUploadsStore.getState().getById(key);
        if (entry) {
          const img = await loadImage(entry.dataURL);
          if (cancelled) return;
          const result = makeUploadDrawer(img);
          drawer = result.drawer;
          ar = result.ar;
        } else {
          // Stale upload key (entry was wiped). Fall back to default.
          useSettingsStore.getState().setImageKey("spectrum");
        }
      }
      drawerRef.current = drawer;
      useSimStore.getState().setImgAR(ar);

      await renderer.ready();
      if (cancelled) return;
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      newRun();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = useCallback(() => {
    drawerRef.current = SAMPLES.spectrum.draw;
    useSimStore.getState().setImgAR(SAMPLES.spectrum.ar);
    useSettingsStore.getState().reset();
  }, []);

  const onImageSelect = useCallback((key: string, drawer: Drawer, ar: number) => {
    drawerRef.current = drawer;
    setImageKey(key);
    const sim = useSimStore.getState();
    if (Math.abs(ar - sim.imgAR) > 0.001) {
      sim.setImgAR(ar);
      sim.markDirty();
      return;
    }
    // Same AR — re-bake colors in place against the existing record.
    renderSource();
    const rec = recRef.current;
    if (!rec) return;
    const cSize = containerForAR(sim.imgAR, sim.viewport);
    const left = sim.viewport.w / 2 - cSize.w / 2;
    const top = sim.viewport.h / 2 - cSize.h / 2;
    const d = deriveQuality(useSettingsStore.getState().params.QUALITY, cSize);
    const c = renderer.bake(
      rec.recX, rec.recY, rec.scale, rec.N, rec.total,
      sourceCanvasRef.current!, cSize, left, top, d.ballRadius,
    );
    sim.setColored(c);
    const f = playingRef.current
      ? frameRef.current
      : Math.max(0, Math.min(frameRef.current, rec.total - 1));
    renderer.drawFrame(rec.recX, rec.recY, rec.scale, rec.N, f);
  }, [renderer, renderSource, setImageKey]);

  const lastARRef = useRef(imgAR);
  useEffect(() => {
    if (lastARRef.current === imgAR) return;
    lastARRef.current = imgAR;
    if (recRef.current) newRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgAR]);

  // Paste support: dropping a PNG/JPG from the clipboard onto the page
  // uploads it as a source and selects it. Skipped for input/textarea targets
  // so it doesn't fight with text fields.
  const onImageSelectRef = useRef(onImageSelect);
  useEffect(() => { onImageSelectRef.current = onImageSelect; });
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const dataURL = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const img = await loadImage(dataURL);
        const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const name = file.name && file.name !== "image.png"
          ? file.name
          : `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
        const entry = await useUploadsStore.getState().addUpload({
          name,
          dataURL,
          ar: img.width / img.height,
        });
        const { drawer, ar } = makeUploadDrawer(img);
        onImageSelectRef.current(entry.id, drawer, ar);
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Bind global keydown once and read latest handlers via refs so the
  // listener doesn't tear down + re-bind on every keystroke or slider drag.
  const newRunRef = useRef(newRun);
  const replayRef = useRef(replay);
  const cancelRef = useRef(cancelRun);
  useEffect(() => {
    newRunRef.current = newRun;
    replayRef.current = replay;
    cancelRef.current = cancelRun;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const sim = useSimStore.getState();
      const settings = useSettingsStore.getState();
      if (e.key === "r") replayRef.current();
      if (e.key === "Enter" && sim.dirty && sim.phase !== "precomputing") newRunRef.current();
      if (e.key === "Escape" && sim.phase === "precomputing") cancelRef.current();
      if ((e.key === "Backspace" || e.key === "Delete") && sim.selectedHole >= 0 && settings.holes.length > 1) {
        settings.removeHole(sim.selectedHole);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canReplay = hasCache && !exporting;
  const canNewRun = (dirty || phase === "loading" || phase === "error") && !exporting;
  const canExport = hasCache && phase !== "precomputing" && !exporting;

  return (
    <TooltipProvider delayDuration={150}>
      <canvas ref={canvasRef} className="fixed inset-0 z-0" />

      <HoleEditor />

      {/* Mobile-only top bar: logo + reset + theme. Hidden on md+ since
          those controls live in the right panel header on desktop. */}
      <header className="pointer-events-none fixed left-3 right-3 top-3 z-[4] flex items-center justify-between md:hidden">
        <h1 className="display pointer-events-auto text-[20px] leading-none">
          <BrandWord />
        </h1>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset to defaults"
            title="Reset to defaults"
            className="grid size-9 place-items-center rounded-md border border-border/60 bg-card/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="grid size-9 place-items-center rounded-md border border-border/60 bg-card/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </header>

      <aside
        className="fixed inset-y-0 left-0 z-10 hidden flex-col overflow-hidden border-r border-border/60 glass md:flex"
        style={{ width: LEFT_PANEL_W }}
      >
        <header className="flex items-baseline justify-between border-b border-border/60 px-4 py-3.5">
          <h3 className="display text-[22px] leading-none">
            <BrandWord />
          </h3>
          <span className="display-italic text-[13px] text-muted-foreground/70">scene</span>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5 pt-4">
          <SceneSections onImageSelect={onImageSelect} />
        </div>
      </aside>

      <aside
        className="fixed inset-y-0 right-0 z-10 hidden flex-col overflow-hidden border-l border-border/60 glass md:flex"
        style={{ width: RIGHT_PANEL_W }}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
          <h3 className="display text-[22px] leading-none">physics</h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleReset}
              aria-label="Reset to defaults"
              title="Reset the scene"
              className="grid size-7 place-items-center rounded-md border border-border/60 bg-card/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="grid size-7 place-items-center rounded-md border border-border/60 bg-card/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5 pt-4">
          <PhysicsSections
            params={params}
            setParam={setParam}
            playSpeed={playSpeed}
            setPlaySpeed={setPlaySpeed}
          />
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

      {/* Mobile bottom sheets — desktop renders the same content in sidebars. */}
      <Sheet
        open={openSheet === "scene"}
        onClose={() => setOpenSheet(null)}
        title="Scene"
      >
        <SceneSections onImageSelect={onImageSelect} />
      </Sheet>
      <Sheet
        open={openSheet === "physics"}
        onClose={() => setOpenSheet(null)}
        title="Physics"
      >
        <PhysicsSections
          params={params}
          setParam={setParam}
          playSpeed={playSpeed}
          setPlaySpeed={setPlaySpeed}
        />
      </Sheet>

      <div className="pointer-events-none fixed bottom-3 left-0 right-0 z-[4] flex items-center justify-center gap-2 px-3 md:bottom-5 md:left-[300px] md:right-[320px] md:gap-0 md:px-0">
        {/* Mobile-only Scene trigger */}
        <button
          type="button"
          aria-label="Open scene panel"
          onClick={() => setOpenSheet("scene")}
          className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full glass text-foreground/90 transition-colors hover:bg-foreground/[0.06] md:hidden"
        >
          <ImageIcon className="size-5" strokeWidth={1.8} />
        </button>

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
              title="Stop this run"
              className="flex items-center gap-1.5 px-4 text-[12.5px] font-medium tracking-tight text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto relative flex h-11 items-stretch overflow-hidden rounded-full glass">
            <button
              onClick={replay}
              disabled={!canReplay}
              title="Play again"
              className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="size-4" strokeWidth={1.8} />
            </button>
            <button
              onClick={toggleSource}
              disabled={phase !== "settled" || exporting}
              title={sourceButtonTitle(phase, showSource)}
              className={cn(
                "grid w-10 place-items-center transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                showSource ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground",
              )}
            >
              {showSource ? <EyeOff className="size-4" strokeWidth={1.8} /> : <Eye className="size-4" strokeWidth={1.8} />}
            </button>
            <button
              onClick={exportVideo}
              disabled={!canExport}
              title={exporting ? `Exporting... ${Math.round(exportProgress * 100)}%` : "Save as video"}
              className={cn(
                "grid w-10 place-items-center transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                exporting ? "text-foreground/90" : "text-muted-foreground",
              )}
            >
              {exporting
                ? <span className="mono text-[10px] tabular-nums">{Math.round(exportProgress * 100)}%</span>
                : <Download className="size-4" strokeWidth={1.8} />}
            </button>

            <div className="my-2 w-px bg-border/60" />

            <button
              onClick={newRun}
              disabled={!canNewRun}
              title={canNewRun ? "Run with the latest changes." : "You're already viewing the latest run."}
              className={cn(
                "flex w-[110px] items-center justify-center gap-2 text-[13px] font-medium tracking-tight transition-colors disabled:pointer-events-none md:w-[140px]",
                canNewRun
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-foreground/[0.05] text-muted-foreground/70",
              )}
            >
              <span>Run</span>
              <kbd className={cn(
                "hidden rounded px-1.5 py-0.5 text-[10px] mono md:inline-block",
                canNewRun
                  ? "bg-primary-foreground/15 text-primary-foreground/80"
                  : "bg-foreground/[0.06] text-muted-foreground/60",
              )}>⏎</kbd>
            </button>
          </div>
        )}

        {/* Mobile-only Physics trigger */}
        <button
          type="button"
          aria-label="Open physics panel"
          onClick={() => setOpenSheet("physics")}
          className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full glass text-foreground/90 transition-colors hover:bg-foreground/[0.06] md:hidden"
        >
          <Sliders className="size-5" strokeWidth={1.8} />
        </button>
      </div>
    </TooltipProvider>
  );
}

function BrandWord() {
  return (
    <>
      <span className="text-primary/90">orb</span>
      <span>serve</span>
      <span className="display-italic text-primary">.</span>
    </>
  );
}

function SceneSections({ onImageSelect }: { onImageSelect: (key: string, drawer: Drawer, ar: number) => void }) {
  return (
    <>
      <section>
        <div className="mb-2.5">
          <span className={SECTION_LABEL}>Source</span>
        </div>
        <ImagePicker onSelect={onImageSelect} />
      </section>
      <section>
        <div className="mb-2.5">
          <InfoLabel
            tip="Choose how detailed the final image should be. Higher quality uses more balls and takes longer to run."
            className={SECTION_LABEL}
          >
            Quality
          </InfoLabel>
        </div>
        <QualityPicker />
      </section>
      <section>
        <div className="mb-2.5">
          <InfoLabel
            tip="Start with a ready-made motion setup, then adjust it however you like."
            className={SECTION_LABEL}
          >
            Presets
          </InfoLabel>
        </div>
        <PresetsPicker />
      </section>
    </>
  );
}

function PhysicsSections({
  params, setParam, playSpeed, setPlaySpeed,
}: {
  params: { RESTITUTION: number; BALL_FRICTION: number };
  setParam: <K extends "RESTITUTION" | "BALL_FRICTION">(k: K, v: number) => void;
  playSpeed: number;
  setPlaySpeed: (n: number) => void;
}) {
  return (
    <>
      {/* Feel above Holes — Holes is variable-height, putting it last
          keeps the slider section anchored when holes are added/edited. */}
      <section>
        <div className="mb-2.5">
          <span className={SECTION_LABEL}>Feel</span>
        </div>
        <BigSlider
          label="bounce"
          tip="Controls how much the balls rebound after hitting each other. Lower values settle faster; higher values feel livelier."
          value={params.RESTITUTION}
          min={0} max={1} step={0.02}
          format={(v) => v.toFixed(2)}
          onChange={(v) => setParam("RESTITUTION", v)}
        />
        <BigSlider
          label="grip"
          tip="Controls how much the balls hold their place as they pile up. Lower values slide around more; higher values lock into place."
          value={params.BALL_FRICTION}
          min={0} max={1} step={0.02}
          format={(v) => v.toFixed(2)}
          onChange={(v) => setParam("BALL_FRICTION", v)}
        />
        <BigSlider
          label="speed"
          tip="Controls how fast the finished animation plays back. It does not change where the balls land."
          value={playSpeed}
          min={0.25} max={4} step={0.25}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={setPlaySpeed}
        />
      </section>

      <HolesSection />
    </>
  );
}

function HolesSection() {
  const holesCount = useSettingsStore((s) => s.holes.length);
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between">
        <InfoLabel
          tip="Choose where balls enter the canvas. Select one to edit it, or drag its handle directly on the image."
          className={SECTION_LABEL}
        >
          Holes
        </InfoLabel>
        <span className="mono text-[10.5px] tabular-nums text-muted-foreground/60">
          {holesCount}
        </span>
      </div>
      <HolesPanel />
      <HoleInlineEditor />
    </section>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sourceButtonTitle(phase: Phase, showSource: boolean): string {
  if (phase !== "settled") return "Available after the run finishes.";
  return showSource ? "Hide the original image." : "Show the original image for comparison.";
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
