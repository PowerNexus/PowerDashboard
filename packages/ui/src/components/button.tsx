"use client";

import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-field font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-600 shadow-card",
        secondary: "bg-surface text-fg border border-border hover:bg-surface-2",
        ghost: "text-fg hover:bg-surface-2",
        soft: "bg-accent-soft text-accent hover:bg-accent-soft/80",
        danger: "bg-danger text-white hover:bg-danger/90",
        "danger-ghost": "text-danger-ink hover:bg-danger-soft",
        outline: "border border-border-strong text-fg hover:bg-surface-2",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-sm",
        icon: "size-9",
        "icon-sm": "size-8",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, fullWidth, asChild, loading, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        // `disabled` n'est pas un attribut valide sur un <a> : on ne le pose qu'en mode bouton.
        {...(asChild
          ? { "aria-disabled": disabled || loading || undefined }
          : { disabled: disabled || loading })}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" /> : null}
        {/* Slottable indique au Slot quel enfant porte les props, même avec une icône à côté. */}
        <Slottable>{children}</Slottable>
      </Comp>
    );
  },
);
Button.displayName = "Button";
