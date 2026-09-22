import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { LogoMark } from "./logo";

export interface AuthCardProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Carte d'authentification centrée : logo, sur-titre capitales accent, titre, texte, contenu, pied. */
export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
  className,
}: AuthCardProps) {
  return (
    <div
      className={cn(
        "w-full max-w-[440px] rounded-card border border-border bg-surface px-8 py-10 shadow-lg",
        className,
      )}
    >
      <div className="mb-6 flex flex-col items-center text-center">
        <LogoMark size={44} className="mb-5" />
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[28px] font-semibold leading-tight text-fg">{title}</h1>
        {description ? (
          <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
      {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
    </div>
  );
}

/** Séparateur « ou avec votre e-mail ». */
export function OrDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-muted">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Bouton OAuth pleine largeur avec logo. */
export function OAuthButton({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full cursor-pointer items-center justify-center gap-3 rounded-field border border-border bg-surface text-sm font-semibold text-fg transition-colors hover:bg-surface-2 [&_svg]:size-[18px]"
    >
      {icon}
      {children}
    </button>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1C3.2 21.3 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.3c-.5-1.5-.5-3.1 0-4.6V6.6H1.2c-1.6 3.2-1.6 7.1 0 10.3l4.1-2.6z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.7 0 3.3.6 4.5 1.7l3.4-3.4C17.9 1.2 15.1 0 12 0 7.3 0 3.2 2.7 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
      />
    </svg>
  );
}
