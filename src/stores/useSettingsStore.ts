import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  type Hole,
  type HoleSide,
  type SimParams,
  makeHole,
  mirrorH,
  mirrorV,
} from "@/lib/types";
import { SAMPLES, DEFAULT_SAMPLE_KEY } from "@/lib/samples";
import { FOUNTAIN_PRESET, type ScenePreset } from "@/lib/presets";
import { useSimStore } from "./useSimStore";

const DEFAULT_PARAMS: SimParams = {
  QUALITY: "high",
  ...FOUNTAIN_PRESET.params,
};
const DEFAULT_HOLES: Hole[] = FOUNTAIN_PRESET.holes.map((h) => ({ ...h }));
const DEFAULT_IMAGE_KEY = DEFAULT_SAMPLE_KEY;

const initialTheme = (): "light" | "dark" => {
  if (typeof matchMedia === "undefined") return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

interface SettingsState {
  params: SimParams;
  holes: Hole[];
  imageKey: string;
  theme: "light" | "dark";
  playSpeed: number;

  setParam: <K extends keyof SimParams>(k: K, v: SimParams[K]) => void;
  setHoles: (next: Hole[]) => void;
  setHoleAt: (idx: number, patch: Partial<Hole>) => void;
  addHole: () => void;
  addHoleOnSide: (side: HoleSide, offset: number) => void;
  removeHole: (idx: number) => void;
  mirrorHole: (idx: number, axis: "h" | "v") => void;
  setImageKey: (key: string) => void;
  toggleTheme: () => void;
  setPlaySpeed: (n: number) => void;
  applyPreset: (preset: ScenePreset) => void;
  reset: () => void;
}

const ROTATION_SIDES: HoleSide[] = ["bottom", "top", "left", "right"];

const markDirty = () => useSimStore.getState().markDirty();

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      params: DEFAULT_PARAMS,
      holes: DEFAULT_HOLES,
      imageKey: DEFAULT_IMAGE_KEY,
      theme: initialTheme(),
      playSpeed: 1,

      setParam: (k, v) => {
        set((s) => ({ params: { ...s.params, [k]: v } }));
        markDirty();
      },

      setHoles: (next) => {
        set({ holes: next });
        markDirty();
      },

      setHoleAt: (idx, patch) => {
        set((s) => ({
          holes: s.holes.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
        }));
        markDirty();
      },

      addHole: () => {
        const len = get().holes.length;
        set((s) => ({
          holes: [...s.holes, makeHole(ROTATION_SIDES[len % 4])],
        }));
        useSimStore.getState().setSelectedHole(len);
        markDirty();
      },

      addHoleOnSide: (side, offset) => {
        const len = get().holes.length;
        set((s) => ({
          holes: [...s.holes, { ...makeHole(side), offset }],
        }));
        useSimStore.getState().setSelectedHole(len);
        markDirty();
      },

      removeHole: (idx) => {
        const holes = get().holes;
        if (holes.length <= 1) return;
        set({ holes: holes.filter((_, i) => i !== idx) });
        const sim = useSimStore.getState();
        if (sim.selectedHole === idx) sim.setSelectedHole(-1);
        else if (sim.selectedHole > idx) sim.setSelectedHole(sim.selectedHole - 1);
        markDirty();
      },

      mirrorHole: (idx, axis) => {
        const holes = get().holes;
        const fn = axis === "h" ? mirrorH : mirrorV;
        set({ holes: [...holes, fn(holes[idx])] });
        useSimStore.getState().setSelectedHole(holes.length);
        markDirty();
      },

      setImageKey: (key) => set({ imageKey: key }),

      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

      setPlaySpeed: (n) => set({ playSpeed: n }),

      applyPreset: (preset) => {
        set((s) => ({
          // Preserve user's current QUALITY — presets only touch the "feel".
          params: { ...preset.params, QUALITY: s.params.QUALITY },
          holes: preset.holes,
        }));
        const sim = useSimStore.getState();
        sim.setSelectedHole(-1);
        sim.markDirty();
      },

      reset: () => {
        set({
          params: DEFAULT_PARAMS,
          holes: DEFAULT_HOLES.map((h) => ({ ...h })),
          imageKey: DEFAULT_IMAGE_KEY,
          playSpeed: 1,
        });
        const sim = useSimStore.getState();
        sim.setSelectedHole(-1);
        sim.markDirty();
      },
    }),
    {
      name: "reveal:settings",
      version: 3,
      migrate: (persistedState, version) => {
        const s = persistedState as Partial<SettingsState> | undefined;
        // v0 → v1: "low" quality removed; coerce to "medium".
        if (version < 1 && s?.params && (s.params as { QUALITY?: string }).QUALITY === "low") {
          s.params = { ...s.params, QUALITY: "medium" };
        }
        // v1 → v2: trimmed sample list. Drop any persisted imageKey that's
        // neither a current sample nor an upload-{id}.
        if (
          version < 2 &&
          s?.imageKey &&
          !(s.imageKey in SAMPLES) &&
          !s.imageKey.startsWith("upload-")
        ) {
          s.imageKey = DEFAULT_IMAGE_KEY;
        }
        // v2 → v3: gravity removed. Strip the field so future writes don't
        // resurrect it via spread.
        if (version < 3 && s?.params) {
          const p = { ...(s.params as Record<string, unknown>) };
          delete p.GRAVITY;
          s.params = p as SimParams;
        }
        return s as SettingsState;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        params: s.params,
        holes: s.holes,
        // Keep sample keys and upload-{id} keys; drop legacy "upload" / unknown.
        imageKey:
          s.imageKey in SAMPLES || s.imageKey.startsWith("upload-")
            ? s.imageKey
            : DEFAULT_IMAGE_KEY,
        theme: s.theme,
        playSpeed: s.playSpeed,
      }),
    },
  ),
);
