import { cn } from "../lib/cn";
import { DEFAULT_LOGO_SRC } from "./logo";

/**
 * Durée d'un cycle complet de l'animation de marque.
 *
 * **Exportée, et injectée dans la feuille de style** : l'animation vivait dans
 * un fichier WebP dont la durée était recopiée ici à la main, avec un
 * commentaire priant qu'on pense à changer les deux ensemble. Les deux
 * valeurs finissent toujours par diverger. Elles n'en font plus qu'une : le
 * composant pose `--gd-splash-cycle`, et chaque étape du mouvement est
 * exprimée en pourcentage de ce cycle. Changer ce nombre change l'animation
 * **et** la tenue de l'écran, du même geste.
 */
export const SPLASH_CYCLE_MS = 2_400;

export interface SplashScreenProps {
  /** Ce qu'on attend, dit en une ligne. Omis, l'écran reste muet — c'est bien aussi. */
  label?: string;
  /**
   * Nom de la marque, écrit sous le signe.
   *
   * **Du texte, et non une image** : c'est ce qui rend l'écran de démarrage
   * blanc-marque. Un revendeur qui règle son nom le voit ici sans qu'on ait
   * rien à fabriquer pour lui.
   */
  name?: string;
  /** Signe affiché. Par défaut l'adresse qui résout le logo du domaine d'arrivée. */
  logoSrc?: string;
  className?: string;
  /**
   * Fond opaque, sombre, indépendant du thème.
   *
   * Réservé au tout premier affichage, avant que quoi que ce soit d'autre
   * n'existe à l'écran. Ailleurs — une navigation entre deux pages déjà
   * peintes — ce fond produirait un éclair sombre au milieu d'une interface
   * claire, ce qui se lit comme un bogue plutôt que comme un chargement.
   */
  cover?: boolean;
}

/**
 * Écran de démarrage, **composé à partir de la marque servie**.
 *
 * Il y avait ici un WebP animé de trente-trois images, aux couleurs de
 * GameDashboard, peignant son propre fond noir. Il avait trois défauts, et le
 * troisième était rédhibitoire :
 *
 * 1. il fallait le compositer en `screen` pour que son rectangle noir ne se
 *    découpe pas sur l'écran, et rendre en plus un logo fixe masqué, parce
 *    qu'un WebP animé ne se met pas en pause sous `prefers-reduced-motion` ;
 * 2. sa durée était recopiée dans le code, à charge pour le prochain de ne pas
 *    l'oublier ;
 * 3. **il ignorait la marque.** Un revendeur pouvait régler son logo, son nom
 *    et sa couleur : la première chose que voyait son client était le phénix
 *    violet de GameDashboard. La marque blanche fuyait par l'écran de
 *    démarrage, c'est-à-dire par le premier écran.
 *
 * Tout est donc composé à l'affichage, à partir de ce que l'administrateur
 * règle déjà et de rien d'autre :
 *
 * - **le signe** vient de `/brand/logo`, l'adresse qui résout le logo du
 *   domaine d'arrivée — le revendeur n'a rien à faire pour qu'il suive ;
 * - **le nom** est du texte, passé en propriété ;
 * - **la couleur** est `--gd-accent-500`, que la racine pose déjà avant la
 *   première peinture. Le halo, le trait et la teinte du fond en descendent
 *   tous les trois : une seule valeur réglée, trois éléments qui s'accordent.
 *
 * Il ne reste aucun fichier à refabriquer quand la marque change.
 */
export function SplashScreen({
  label,
  name,
  logoSrc = DEFAULT_LOGO_SRC,
  className,
  cover,
}: SplashScreenProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6",
        cover ? "gd-splash-cover" : "bg-bg",
        className,
      )}
      // Le cycle voyage du code vers la feuille de style, jamais l'inverse.
      style={{ "--gd-splash-cycle": `${SPLASH_CYCLE_MS}ms` } as React.CSSProperties}
      // Le lecteur d'écran annonce l'attente ; l'animation, elle, ne lui
      // apprendrait rien.
      role="status"
      aria-live="polite"
      aria-label={label ?? "Chargement"}
    >
      <div className="gd-splash-stage">
        {/*
         * Le halo est un frère du signe, pas son arrière-plan.
         *
         * Posé derrière en `position: absolute`, il peut déborder largement du
         * signe sans l'agrandir ni décaler ce qui suit. Un `box-shadow` sur le
         * logo aurait suivi la forme du rectangle de l'image, pas celle de
         * l'oiseau.
         */}
        <span className="gd-splash-halo" aria-hidden="true" />
        <img src={logoSrc} alt="" className="gd-splash-mark" draggable={false} />
      </div>

      {name ? <p className="gd-splash-name">{name}</p> : null}

      {/*
       * Le trait de progression ne mesure rien, et ne le prétend pas.
       *
       * Il balaie une fois, à la durée du cycle. Une barre qui avancerait par
       * paliers inventés serait un mensonge sur un état qu'on ne connaît pas :
       * l'écran tient une durée décidée, pas un chargement mesuré.
       */}
      <span className="gd-splash-sweep" aria-hidden="true" />

      {label ? <p className="gd-splash-label text-muted text-sm">{label}</p> : null}
    </div>
  );
}
