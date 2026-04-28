import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRESETS } from "@/lib/presets";
import { useSettingsStore } from "@/stores/useSettingsStore";

export function PresetsPicker() {
  const applyPreset = useSettingsStore((s) => s.applyPreset);
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.map((p) => (
        <Tooltip key={p.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => applyPreset(p)}
              className="rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-[11px] font-medium tracking-tight text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground active:scale-[0.97]"
            >
              {p.label}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[220px] text-[11px]">
            {p.description}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
