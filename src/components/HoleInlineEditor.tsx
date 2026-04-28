import { FlipHorizontal2, FlipVertical2, Trash2, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoLabel } from "@/components/InfoLabel";
import {
  type Hole,
  type HoleSide,
  HOLE_DEFAULT_SPEED,
  HOLE_DEFAULT_CONE,
} from "@/lib/types";

interface Props {
  hole: Hole;
  index: number;
  totalHoles: number;
  onChange: (patch: Partial<Hole>) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onMirrorH: () => void;
  onMirrorV: () => void;
}

const ROW_LABEL_CLASS = "text-[10px] uppercase tracking-wider text-muted-foreground/70";

export function HoleInlineEditor({
  hole, index, totalHoles, onChange, onDelete, onDeselect, onMirrorH, onMirrorV,
}: Props) {
  const speed = hole.speed ?? HOLE_DEFAULT_SPEED;
  const cone = hole.cone ?? HOLE_DEFAULT_CONE;

  return (
    <div className="animate-popover-in mt-3 overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]">
      <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-tight">
          <span className="size-1.5 rounded-full bg-primary" />
          Hole {String(index + 1).padStart(2, "0")}
          <span className="font-normal text-muted-foreground/70">· {hole.side}</span>
        </span>
        <button
          onClick={onDeselect}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Close editor"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-2 px-2.5 py-2.5">
        <Row label="side" tip="Which container wall this hole is on. Drag the hole on the canvas to switch sides freely.">
          <Select
            value={hole.side}
            onValueChange={(v) => onChange({ side: v as HoleSide })}
          >
            <SelectTrigger className="h-7 px-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="bottom">bottom</SelectItem>
                <SelectItem value="top">top</SelectItem>
                <SelectItem value="left">left</SelectItem>
                <SelectItem value="right">right</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Row>
        <SliderRow
          label="offset"
          tip="Position along the wall. 0 = top/left edge, 100 = bottom/right edge."
          value={hole.offset * 100}
          min={0} max={100} step={1}
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => onChange({ offset: v / 100 })}
        />
        <SliderRow
          label="width"
          tip="Lateral spread of the spawn zone. Wider holes emit balls across a longer band of the wall."
          value={hole.width}
          min={20} max={600} step={4}
          format={(v) => `${Math.round(v)}px`}
          onChange={(v) => onChange({ width: v })}
        />
        <SliderRow
          label="angle"
          tip="Tilts the launch direction off the inward normal. 0° = straight in; ±90° = parallel to the wall."
          value={hole.angle}
          min={-90} max={90} step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v) => onChange({ angle: v })}
        />
        <SliderRow
          label="speed"
          tip="Initial launch speed of balls leaving this hole, in pixels per frame. Higher = balls fly farther before gravity overcomes them."
          value={speed}
          min={2} max={60} step={1}
          format={(v) => `${Math.round(v)}`}
          onChange={(v) => onChange({ speed: v })}
        />
        <SliderRow
          label="cone"
          tip="Random angular spread on each launch, in radians. 0 = perfectly straight stream; 2.5 ≈ full half-circle fan."
          value={cone}
          min={0} max={2.5} step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ cone: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-1.5 border-t border-border/40 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={onMirrorH}
            title="Duplicate this hole, mirrored across the vertical axis"
            className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FlipHorizontal2 className="size-3.5" strokeWidth={1.8} />
          </button>
          <button
            onClick={onMirrorV}
            title="Duplicate this hole, mirrored across the horizontal axis"
            className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FlipVertical2 className="size-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onDelete}
          disabled={totalHoles <= 1}
          className="gap-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 data-icon="inline-start" /> Delete
        </Button>
      </div>
    </div>
  );
}

function Row({
  label, tip, children,
}: {
  label: string;
  tip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[44px_1fr] items-center gap-2">
      <InfoLabel tip={tip} className={ROW_LABEL_CLASS}>
        {label}
      </InfoLabel>
      {children}
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
