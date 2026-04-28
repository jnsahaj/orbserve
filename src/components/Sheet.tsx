import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  // Lock body scroll while a sheet is open so the page behind doesn't scroll
  // when the user pans inside the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity duration-200 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border/60 glass shadow-2xl transition-transform duration-300 ease-fluid md:hidden",
          open ? "translate-y-0" : "pointer-events-none translate-y-full",
        )}
      >
        <div className="flex items-center justify-center pb-1 pt-2">
          <span className="h-1 w-10 rounded-full bg-foreground/20" />
        </div>
        <header className="flex items-center justify-between px-4 pb-3">
          <h3 className="display text-[18px] leading-none">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {children}
        </div>
      </div>
    </>
  );
}
