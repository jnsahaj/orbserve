import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  tip: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * A label rendered with a small (i) info marker. Hover reveals the tip.
 * Used everywhere a parameter name appears so the user can learn what
 * the knob does without having to guess.
 */
export function InfoLabel({ children, tip, className, side = "top" }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-help select-none items-center gap-1",
            className,
          )}
        >
          {children}
          <Info className="size-2.5 text-muted-foreground/40" strokeWidth={2} />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[240px] text-[10px] leading-snug"
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
