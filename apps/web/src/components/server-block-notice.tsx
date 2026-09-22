import type { ServerBlock } from "@gamedashboard/contracts";
import { AlertBanner } from "@gamedashboard/ui";

/**
 * Ce que le panel est en train de faire à ce serveur, et pourquoi rien n'obéit.
 *
 * Posé en tête de l'écran plutôt qu'en message d'erreur après un clic : la
 * règle existait côté API — elle refusait — mais l'interface l'ignorait, et
 * proposait un bouton « Start » actif pendant une installation. On apprenait
 * la contrainte en la heurtant.
 *
 * Le ton dépend de `transient` : ce qui se termine seul appelle à patienter,
 * ce qui ne se termine pas appelle à agir. « Patientez » devant un serveur
 * suspendu ferait attendre indéfiniment quelqu'un qui devait écrire à son
 * hébergeur.
 */
export function ServerBlockNotice({
  block,
  install,
}: {
  block: ServerBlock;
  /**
   * L'installation telle que le daemon la raconte, quand il parle.
   *
   * `null` veut dire « il n'a rien dit », ce qui n'est pas « rien ne se
   * passe » : le blocage vient de la base, pas d'ici. Une installation lancée
   * avant l'ouverture de la page n'a plus rien à raconter — le daemon ne
   * rejoue pas ce qu'il a déjà dit.
   */
  install?: { running: boolean; lines: number } | null;
}) {
  /*
   * Ce qui avance, dit par ce qui avance réellement.
   *
   * **Aucun pourcentage**, et c'est délibéré : le daemon annonce le début et
   * la fin de l'installation, jamais une proportion, et un script d'egg n'a
   * pas de longueur connue d'avance. Une barre qui progresserait ici serait
   * une animation, pas une mesure — et elle serait crue.
   *
   * Le nombre de lignes reçues, lui, est vrai. Il ne dit pas combien il en
   * reste ; il dit que quelque chose se passe, ce qui est exactement la
   * question qu'on se pose devant un écran figé.
   */
  const avance = install && install.lines > 0;

  return (
    <AlertBanner variant={block.transient ? "info" : "warning"} title={block.label}>
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          {block.transient ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 animate-pulse rounded-full bg-current"
            />
          ) : null}
          <span>{block.body}</span>
        </span>

        {avance ? (
          <span className="text-xs opacity-80">
            {install.running
              ? `Le daemon travaille : ${install.lines} ligne(s) de sortie reçues, visibles dans la console ci-dessous.`
              : `Installation terminée du côté du daemon (${install.lines} ligne(s)). Rechargez la page pour reprendre la main.`}
          </span>
        ) : null}
      </span>
    </AlertBanner>
  );
}
