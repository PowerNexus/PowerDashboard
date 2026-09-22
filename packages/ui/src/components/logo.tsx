import { cn } from "../lib/cn";

/**
 * Adresse du logo, **résolue par le serveur selon le domaine d'arrivée**.
 *
 * Ce n'est pas un fichier : c'est une route qui redirige vers le logo de la
 * marque servie. Un composant client n'a aucun moyen de savoir chez quel
 * revendeur on est arrivé — cette adresse, elle, le sait, et reste la même
 * partout où le logo apparaît.
 */
export const DEFAULT_LOGO_SRC = "/brand/logo";

export interface LogoProps {
  size?: number;
  src?: string;
  alt?: string;
  className?: string;
}

/**
 * Le signe seul, sans le nom.
 *
 * Le fichier livré portait le signe **et** le mot-symbole « game Dashboard ».
 * Le mot est retiré ici : il est écrit en texte partout où il apparaît, ce qui
 * le rend traduisible, lisible par un lecteur d'écran, et surtout remplaçable
 * par le nom d'un revendeur. Un nom cuit dans une image ne se remplace pas.
 */
export function LogoMark({ size = 32, src = DEFAULT_LOGO_SRC, alt = "", className }: LogoProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={cn("shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export interface BrandProps {
  name?: string;
  tagline?: string;
  size?: number;
  src?: string;
  className?: string;
}

/** Logo + nom en capitales, avec sous-titre optionnel (cf. « CENTRE D'AIDE »). */
export function Brand({ name = "GAMEDASHBOARD", tagline, size = 32, src, className }: BrandProps) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark size={size} src={src} alt={name} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-wide text-fg">{name}</span>
        {tagline ? (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
