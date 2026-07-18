import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer select-none",
    "transition-[transform,color,background-color,border-color,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "active:scale-[0.98]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground",
          "shadow-[0_1px_0_0_color-mix(in_oklch,white_25%,transparent)_inset,0_10px_24px_-12px_color-mix(in_oklch,var(--color-primary)_75%,transparent)]",
          "hover:from-primary hover:to-primary hover:shadow-[0_1px_0_0_color-mix(in_oklch,white_30%,transparent)_inset,0_14px_32px_-12px_color-mix(in_oklch,var(--color-primary)_85%,transparent)]",
        ].join(" "),
        destructive: [
          "bg-gradient-to-b from-destructive to-destructive/85 text-destructive-foreground",
          "shadow-[0_1px_0_0_color-mix(in_oklch,white_20%,transparent)_inset,0_10px_24px_-12px_color-mix(in_oklch,var(--color-destructive)_75%,transparent)]",
          "hover:shadow-[0_1px_0_0_color-mix(in_oklch,white_25%,transparent)_inset,0_14px_32px_-12px_color-mix(in_oklch,var(--color-destructive)_85%,transparent)]",
        ].join(" "),
        outline: [
          "border border-border/70 bg-card/60 text-foreground backdrop-blur-md",
          "shadow-[0_1px_0_0_color-mix(in_oklch,white_6%,transparent)_inset]",
          "hover:bg-accent/60 hover:text-accent-foreground hover:border-primary/40",
        ].join(" "),
        secondary: [
          "bg-secondary/80 text-secondary-foreground backdrop-blur-md",
          "shadow-[0_1px_0_0_color-mix(in_oklch,white_8%,transparent)_inset]",
          "hover:bg-secondary",
        ].join(" "),
        ghost: "text-foreground/80 hover:bg-accent/50 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-[0.95rem]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
