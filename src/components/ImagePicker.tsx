import { useEffect, useRef } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { SAMPLES, makeUploadDrawer, type Drawer } from "@/lib/samples";

interface Props {
  selected: string;
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

export function ImagePicker({ selected, onSelect }: Props) {
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const { drawer, ar } = makeUploadDrawer(img);
        onSelect("upload", drawer, ar);
      };
      img.src = ev.target!.result as string;
    };
    reader.readAsDataURL(file);
  };

  const tile =
    "group relative flex aspect-[7/5] items-center justify-center overflow-hidden rounded-lg border bg-foreground/[0.04] transition-[transform,border-color] duration-150 ease-fluid active:scale-[0.97]";

  return (
    <div className="cascade grid grid-cols-2 gap-2">
      {Object.entries(SAMPLES).map(([key, sample], i) => {
        const isSel = selected === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key, sample.draw, sample.ar)}
            style={{ ["--i" as string]: i }}
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
        style={{ ["--i" as string]: Object.keys(SAMPLES).length }}
        className={cn(
          tile,
          "cursor-pointer flex-col gap-1 text-muted-foreground hover:text-foreground",
          selected === "upload"
            ? "border-foreground ring-2 ring-foreground/15 ring-offset-2 ring-offset-card"
            : "border-dashed border-border/80 hover:border-foreground/40",
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
