import { create } from "zustand";
import { type Phase } from "@/lib/types";

interface SimState {
  phase: Phase;
  progress: number;
  colored: number;
  hasCache: boolean;
  dirty: boolean;
  selectedHole: number;
  showSource: boolean;
  viewport: { w: number; h: number };
  imgAR: number;

  setPhase: (p: Phase) => void;
  setProgress: (p: number) => void;
  setColored: (c: number) => void;
  setHasCache: (b: boolean) => void;
  setDirty: (d: boolean) => void;
  markDirty: () => void;
  setSelectedHole: (i: number) => void;
  setShowSource: (b: boolean) => void;
  setViewport: (v: { w: number; h: number }) => void;
  setImgAR: (ar: number) => void;
}

export const useSimStore = create<SimState>((set) => ({
  phase: "loading",
  progress: 0,
  colored: 0,
  hasCache: false,
  dirty: true,
  selectedHole: -1,
  showSource: false,
  viewport: {
    w: typeof window !== "undefined" ? window.innerWidth : 0,
    h: typeof window !== "undefined" ? window.innerHeight : 0,
  },
  imgAR: 0,

  setPhase: (phase) => set({ phase }),
  setProgress: (progress) => set({ progress }),
  setColored: (colored) => set({ colored }),
  setHasCache: (hasCache) => set({ hasCache }),
  setDirty: (dirty) => set({ dirty }),
  markDirty: () => set({ dirty: true }),
  setSelectedHole: (selectedHole) => set({ selectedHole }),
  setShowSource: (showSource) => set({ showSource }),
  setViewport: (viewport) => set({ viewport }),
  setImgAR: (imgAR) => set({ imgAR }),
}));
