import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/12 text-primary shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_18%,transparent)_inset] hover:bg-primary/18",
        secondary:
          "border-border/60 bg-secondary/70 text-secondary-foreground hover:bg-secondary",
        destructive:
          "border-destructive/30 bg-destructive/12 text-destructive hover:bg-destructive/18",
        outline: "border-border/60 bg-transparent text-foreground/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
