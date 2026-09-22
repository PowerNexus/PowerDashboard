"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode, useId, useState } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
  inputSize?: "md" | "lg";
}

/** Champ avec icône à gauche, slot à droite, halo accent au focus (cf. login). */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leadingIcon, trailing, invalid, inputSize = "md", ...props }, ref) => (
    <div
      className={cn(
        "flex items-center gap-2 rounded-field border bg-surface-2 px-3 text-sm transition-shadow focus-within:border-accent focus-within:shadow-[var(--gd-ring)]",
        inputSize === "lg" ? "h-11" : "h-10",
        invalid ? "border-danger" : "border-border",
        props.disabled && "opacity-60",
        className,
      )}
    >
      {leadingIcon ? <span className="text-faint [&_svg]:size-4">{leadingIcon}</span> : null}
      <input
        ref={ref}
        className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint focus:shadow-none"
        aria-invalid={invalid || undefined}
        {...props}
      />
      {trailing ? <span className="text-faint [&_svg]:size-4">{trailing}</span> : null}
    </div>
  ),
);
Input.displayName = "Input";

export interface PasswordInputProps extends Omit<InputProps, "type" | "trailing"> {
  /** Libellés accessibles du bouton de visibilité, pour les applications traduites. */
  hideLabel?: string;
  showLabel?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    { hideLabel = "Masquer le mot de passe", showLabel = "Afficher le mot de passe", ...props },
    ref,
  ) => {
    const [visible, setVisible] = useState(false);
    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="cursor-pointer text-faint hover:text-fg"
            aria-label={visible ? hideLabel : showLabel}
          >
            {visible ? <EyeOff /> : <Eye />}
          </button>
        }
        {...props}
      />
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export interface FormFieldProps {
  label: string;
  description?: string;
  error?: string;
  action?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}

/** Label + contrôle + description/erreur. `action` = lien à droite du label (« Mot de passe oublié ? »). */
export function FormField({
  label,
  description,
  error,
  action,
  children,
  className,
}: FormFieldProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold text-fg">
          {label}
        </label>
        {action}
      </div>
      {children(id)}
      {error ? (
        <p className="text-xs text-danger-ink">{error}</p>
      ) : description ? (
        <p className="text-xs text-muted">{description}</p>
      ) : null}
    </div>
  );
}
