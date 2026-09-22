import { cn } from "../lib/cn";

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = { sm: "size-7 text-xs", md: "size-9 text-sm", lg: "size-12 text-base" };

/** Avatar à initiale sur fond accent (cf. header « M » de la capture). */
export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-accent-fg",
        SIZES[size],
        className,
      )}
      role="img"
      aria-label={name}
    >
      {/* L'image est décorative : le nom est déjà porté par le aria-label du conteneur. */}
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initial}
    </span>
  );
}
