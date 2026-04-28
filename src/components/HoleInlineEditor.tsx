import { FlipHorizontal2, FlipVertical2, Trash2, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { InfoLabel } from "@/components/InfoLabel";
import {
  type Hole,
  HOLE_DEFAULT_SPEED,
  HOLE_DEFAULT_CONE,
} from "@/lib/types";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSimStore } from "@/stores/useSimStore";

const ROW_LABEL_CLASS = "text-[10px] uppercase tracking-wider text-muted-foreground/70";

export function HoleInlineEditor() {
  const index = useSimStore((s) => s.selectedHole);
  const setSelected = useSimStore((s) => s.setSelectedHole);
  const hole = useSettingsStore((s) => (index >= 0 ? s.holes[index] : undefined));
  const totalHoles = useSettingsStore((s) => s.holes.length);
  const setHoleAt = useSettingsStore((s) => s.setHoleAt);
  const removeHole = useSettingsStore((s) => s.removeHole);
  const mirrorHole = useSettingsStore((s) => s.mirrorHole);

  if (index < 0 || !hole) return null;

  const speed = hole.speed ?? HOLE_DEFAULT_SPEED;
  const cone = hole.cone ?? HOLE_DEFAULT_CONE;

  const update = (patch: Partial<Hole>) => setHoleAt(index, patch);

  return (
    <div className="animate-popover-in mt-3 overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]">
      <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-tight">
          <span className="size-1.5 rounded-full bg-primary" />
          Hole {String(index + 1).padStart(2, "0")}
          <span className="font-normal text-muted-foreground/70">· {hole.side}</span>
        </span>
        <button
          onClick={() => setSelected(-1)}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Close editor"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-2 px-2.5 py-2.5">
        <SliderRow
          label="offset"
          tip="Moves this hole along its wall."
          value={hole.offset * 100}
          min={0} max={100} step={1}
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => update({ offset: v / 100 })}
        />
        <SliderRow
          label="width"
          tip="Sets how wide the opening is. Wider openings make a broader stream."
          value={hole.width}
          min={20} max={600} step={4}
          format={(v) => `${Math.round(v)}px`}
          onChange={(v) => update({ width: v })}
        />
        <SliderRow
          label="angle"
          tip="Aims the stream left or right from the wall."
          value={hole.angle}
          min={-90} max={90} step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v) => update({ angle: v })}
        />
        <SliderRow
          label="speed"
          tip="Sets how forcefully balls leave this hole."
          value={speed}
          min={2} max={60} step={1}
          format={(v) => `${Math.round(v)}`}
          onChange={(v) => update({ speed: v })}
        />
        <SliderRow
          label="cone"
          tip="Adds spread to the stream. Low values make a tight beam; high values make a fan."
          value={cone}
          min={0} max={2.5} step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => update({ cone: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-1.5 border-t border-border/40 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => mirrorHole(index, "h")}
            title="Copy to the opposite side"
            className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FlipHorizontal2 className="size-3.5" strokeWidth={1.8} />
          </button>
          <button
            onClick={() => mirrorHole(index, "v")}
            title="Copy above or below"
            className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FlipVertical2 className="size-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => removeHole(index)}
          disabled={totalHoles <= 1}
          className="gap-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  );
}

function SliderRow({
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
    <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
      <InfoLabel tip={tip} className={ROW_LABEL_CLASS}>
        {label}
      </InfoLabel>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
      <span className="text-right text-[10px] tabular-nums text-muted-foreground">
        {format(value)}
      </span>
    </div>
  );
}
