import { create } from "zustand";
import { openDB, type IDBPDatabase } from "idb";

export interface UploadEntry {
  id: string;
  name: string;
  dataURL: string;
  ar: number;
  createdAt: number;
}

const DB_NAME = "reveal";
const STORE = "uploads";

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

interface UploadsState {
  uploads: UploadEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addUpload: (data: { name: string; dataURL: string; ar: number }) => Promise<UploadEntry>;
  removeUpload: (id: string) => Promise<void>;
  getById: (id: string) => UploadEntry | undefined;
}

export const useUploadsStore = create<UploadsState>((set, get) => ({
  uploads: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const db = await getDB();
    const all = (await db.getAll(STORE)) as UploadEntry[];
    all.sort((a, b) => b.createdAt - a.createdAt);
    set({ uploads: all, hydrated: true });
  },

  addUpload: async ({ name, dataURL, ar }) => {
    const entry: UploadEntry = {
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      dataURL,
      ar,
      createdAt: Date.now(),
    };
    const db = await getDB();
    await db.put(STORE, entry);
    set((s) => ({ uploads: [entry, ...s.uploads] }));
    return entry;
  },

  removeUpload: async (id) => {
    const db = await getDB();
    await db.delete(STORE, id);
    set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
  },

  getById: (id) => get().uploads.find((u) => u.id === id),
}));
