import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function SectionLabel({ children, className, action }: Props) {
  return (
    <div
      className={cn(
        "mt-4 mb-2 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.10em] text-muted-foreground/70 first:mt-1",
        className,
      )}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
