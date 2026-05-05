import { ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type HoleSide } from "@/lib/types";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSimStore } from "@/stores/useSimStore";

const BASE_ANGLES_BY_SIDE: Record<HoleSide, number> = {
  bottom: 0,
  top:    180,
  left:   90,
  right:  270,
};

export function HolesPanel() {
  const holes = useSettingsStore((s) => s.holes);
  const addHole = useSettingsStore((s) => s.addHole);
  const removeHole = useSettingsStore((s) => s.removeHole);
  const selected = useSimStore((s) => s.selectedHole);
  const setSelected = useSimStore((s) => s.setSelectedHole);

  const canDelete = holes.length > 1;

  return (
    <div>
      <ul className="overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.025]">
        {holes.map((h, i) => {
          const isSel = i === selected;
          const totalRotation = BASE_ANGLES_BY_SIDE[h.side] + (h.angle || 0);
          return (
            <li
              key={i}
              className={cn(
                "group flex items-center gap-2 border-b border-border/40 px-2.5 py-2 last:border-b-0 transition-colors",
                isSel ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
              )}
            >
              <button
                onClick={() => setSelected(isSel ? -1 : i)}
                className="flex flex-1 items-center gap-2.5 text-left"
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-md border transition-colors",
                    isSel
                      ? "border-foreground/80 bg-foreground text-background"
                      : "border-border/70 bg-card/40 text-muted-foreground",
                  )}
                >
                  <ArrowUp
                    className="size-3"
                    strokeWidth={2}
                    style={{ transform: `rotate(${totalRotation}deg)` }}
                  />
                </span>
                <span className="flex flex-1 items-baseline gap-1.5">
                  <span className="text-[12px] font-medium tracking-tight">
                    {h.side}
                  </span>
                  <span className="mono text-[10.5px] tabular-nums text-muted-foreground/80">
                    {Math.round(h.offset * 100)}%
                  </span>
                  {h.angle !== 0 && (
                    <span className="mono text-[10.5px] tabular-nums text-muted-foreground/60">
                      {h.angle > 0 ? "+" : ""}{Math.round(h.angle)}°
                    </span>
                  )}
                </span>
                <span className="display-italic text-[12px] text-muted-foreground/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </button>
              <button
                onClick={() => removeHole(i)}
                disabled={!canDelete}
                title={canDelete ? "Remove hole" : "At least one hole is required"}
                className="grid size-6 place-items-center rounded-md text-muted-foreground/0 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:hidden group-hover:text-muted-foreground/70"
              >
                <Trash2 className="size-3" strokeWidth={2} />
              </button>
            </li>
          );
        })}
      </ul>

      <button
        onClick={addHole}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/70 px-2 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="size-3.5" strokeWidth={2} />
        add hole
      </button>
    </div>
  );
}
