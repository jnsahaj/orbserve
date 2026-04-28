import { useEffect, useRef } from "react";
import { Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SAMPLES, DEFAULT_SAMPLE_KEY, makeUploadDrawer, type Drawer } from "@/lib/samples";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useUploadsStore, type UploadEntry } from "@/stores/useUploadsStore";

interface Props {
  onSelect: (key: string, drawer: Drawer, ar: number) => void;
}

const TILE_W = 240;
const TILE_H = 172;

function SampleThumb({ draw }: { draw: Drawer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = TILE_W * dpr;
    c.height = TILE_H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, { w: TILE_W, h: TILE_H });
  }, [draw]);
  return (
    <canvas
      ref={ref}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

export function ImagePicker({ onSelect }: Props) {
  const selected = useSettingsStore((s) => s.imageKey);
  const uploads = useUploadsStore((s) => s.uploads);
  const addUpload = useUploadsStore((s) => s.addUpload);
  const removeUpload = useUploadsStore((s) => s.removeUpload);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataURL = ev.target!.result as string;
      const img = new Image();
      img.onload = async () => {
        const entry = await addUpload({
          name: file.name,
          dataURL,
          ar: img.width / img.height,
        });
        const { drawer, ar } = makeUploadDrawer(img);
        onSelect(entry.id, drawer, ar);
      };
      img.src = dataURL;
    };
    reader.readAsDataURL(file);
  };

  const selectUpload = (entry: UploadEntry) => {
    const img = new Image();
    img.onload = () => {
      const { drawer, ar } = makeUploadDrawer(img);
      onSelect(entry.id, drawer, ar);
    };
    img.src = entry.dataURL;
  };

  const handleRemoveUpload = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await removeUpload(id);
    if (selected === id) {
      const fallback = SAMPLES[DEFAULT_SAMPLE_KEY];
      onSelect(DEFAULT_SAMPLE_KEY, fallback.draw, fallback.ar);
    }
  };

  const tile =
    "group relative flex aspect-[7/5] items-center justify-center overflow-hidden rounded-lg border bg-foreground/[0.04] transition-[transform,border-color] duration-150 ease-fluid active:scale-[0.97]";

  let i = 0;

  return (
    <div className="cascade grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1 -mr-1">
      {uploads.map((entry) => {
        const isSel = selected === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => selectUpload(entry)}
            style={{ ["--i" as string]: i++ }}
            className={cn(
              tile,
              isSel
                ? "border-foreground ring-2 ring-foreground/15 ring-offset-2 ring-offset-card"
                : "border-border/60 hover:border-foreground/40",
            )}
            title={entry.name}
          >
            <img
              src={entry.dataURL}
              alt={entry.name}
              className="size-full object-cover"
              draggable={false}
            />
            <span
              role="button"
              tabIndex={0}
              aria-label="Remove upload"
              onClick={(e) => handleRemoveUpload(e, entry.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRemoveUpload(e as unknown as React.MouseEvent, entry.id);
                }
              }}
              className="absolute right-1.5 top-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/55 text-white/90 opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
            >
              <X className="size-3" strokeWidth={2.5} />
            </span>
          </button>
        );
      })}
      {Object.entries(SAMPLES).map(([key, sample]) => {
        const isSel = selected === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key, sample.draw, sample.ar)}
            style={{ ["--i" as string]: i++ }}
            className={cn(
              tile,
              isSel
                ? "border-foreground ring-2 ring-foreground/15 ring-offset-2 ring-offset-card"
                : "border-border/60 hover:border-foreground/40",
            )}
            title={key}
          >
            <SampleThumb draw={sample.draw} />
          </button>
        );
      })}
      <label
        style={{ ["--i" as string]: i }}
        className={cn(
          tile,
          "cursor-pointer flex-col gap-1 text-muted-foreground hover:text-foreground",
          "border-dashed border-border/80 hover:border-foreground/40",
        )}
      >
        <Upload className="size-4" strokeWidth={1.6} />
        <span className="text-[11px] font-medium">Upload</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </label>
    </div>
  );
}
