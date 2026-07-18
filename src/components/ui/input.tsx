import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-10 w-full rounded-lg border border-border/60 bg-input/50 px-3.5 py-2 text-sm shadow-[0_1px_0_0_color-mix(in_oklch,white_4%,transparent)_inset] backdrop-blur-md",
          "transition-[color,background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground/70",
          "hover:border-border",
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:bg-input/70 focus-visible:ring-4 focus-visible:ring-primary/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
