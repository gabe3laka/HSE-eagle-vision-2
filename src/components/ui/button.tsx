import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-cyan-300/20 bg-gradient-to-b from-cyan-300 to-cyan-400 text-slate-950 shadow-[0_8px_24px_-12px_rgba(34,211,238,0.9)] hover:brightness-110",
        destructive:
          "border border-red-300/15 bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[0_8px_24px_-12px_rgba(239,68,68,0.9)] hover:brightness-110",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-white/[0.07] bg-white/[0.055] text-secondary-foreground shadow-sm hover:border-white/[0.12] hover:bg-white/[0.09]",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        gradient:
          "border border-cyan-200/20 bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400 text-slate-950 shadow-[0_12px_30px_-14px_rgba(56,189,248,0.9)] hover:brightness-110",
        glass:
          "border border-white/15 bg-white/5 text-foreground backdrop-blur-md hover:bg-white/10",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
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
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
