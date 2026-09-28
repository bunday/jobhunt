import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border bg-secondary text-secondary-foreground",
      good: "border-transparent bg-success/12 text-success",
      bad: "border-transparent bg-destructive/10 text-destructive",
      warn: "border-transparent bg-warning/15 text-warning",
      info: "border-transparent bg-primary/10 text-primary",
      outline: "border-border text-muted-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export const Badge = ({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => <span className={cn(badge({ tone }), className)} {...p} />;
