import { cn } from "@/lib/utils";
import {
  type Quality,
  QUALITY_PRESETS,
  containerForAR,
  deriveQuality,
} from "@/lib/types";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSimStore } from "@/stores/useSimStore";

const ORDER: Quality[] = ["medium", "high", "ultra"];

function fmtCount(n: number) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function QualityPicker() {
  const value = useSettingsStore((s) => s.params.QUALITY);
  const setParam = useSettingsStore((s) => s.setParam);
  const imgAR = useSimStore((s) => s.imgAR);
  const viewport = useSimStore((s) => s.viewport);
  const container = containerForAR(imgAR, viewport);
  const derived = deriveQuality(value, container);
  return (
    <div>
      <div className="flex rounded-full border border-border/60 bg-card/50 p-0.5 backdrop-blur-md">
        {ORDER.map((q) => {
          const isSel = q === value;
          return (
            <button
              key={q}
              onClick={() => setParam("QUALITY", q)}
              className={cn(
                "flex-1 rounded-full px-2 py-1.5 text-[11.5px] font-medium tracking-tight transition-[colors,transform] duration-150 ease-fluid active:scale-[0.97]",
                isSel
                  ? "bg-foreground text-background shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {QUALITY_PRESETS[q].label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[10.5px] text-muted-foreground/70">
        <span className="display-italic text-[12px] text-foreground/70">
          {fmtCount(derived.totalBalls)} balls
        </span>
        <span className="mono">r ≈ {derived.ballRadius}px</span>
      </div>
    </div>
  );
}
