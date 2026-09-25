import { type ConsoleLine, consoleLevel, parseAnsi, stripAnsi } from "@gamedashboard/ui";

/**
 * Le préfixe que Wings colle à ses propres messages.
 *
 * Il est **renommé à l'affichage**, jamais dans le daemon : Wings reste
 * intact, c'est la règle du projet. La console est de toute façon le bon
 * endroit pour le faire — c'est là que le nom compte, et le remplacer à la
 * source obligerait à maintenir une version modifiée du daemon pour un
 * libellé.
 *
 * Le nom de la machine remplace « Pterodactyl » : sur un compte qui tient
 * plusieurs serveurs, savoir **quel node** parle vaut mieux que de lire le nom
 * d'un logiciel que le client n'a pas à connaître.
 */
const DAEMON_PREFIX = /^\[Pterodactyl Daemon\]:?\s*/;

let sequence = 0;

/**
 * Une ligne brute du daemon devient une ligne de console.
 *
 * Le flux est destiné à un terminal, pas à une page : `text` est le texte nu
 * (sans séquence d'échappement, c'est lui qu'on cherche et qu'on filtre), et
 * `segments` en garde les couleurs, lues en classes closes par `parseAnsi`.
 *
 * Une ligne du daemon devient une ligne du panel : le préfixe quitte le texte
 * pour devenir une étiquette, ce qui permet de la surligner d'un bloc là où un
 * préfixe collé au texte se confondrait avec la sortie du jeu. Ces messages
 * disent pourquoi un serveur refuse de démarrer : ils doivent se voir. Leurs
 * couleurs sont abandonnées, le surlignage en tient lieu.
 */
export function toConsoleLine(
  raw: string,
  source: ConsoleLine["source"],
  label: string,
): ConsoleLine {
  const clean = stripAnsi(raw);
  const isDaemon = DAEMON_PREFIX.test(clean);
  const text = isDaemon ? clean.replace(DAEMON_PREFIX, "") : clean;
  const system = isDaemon || source === "system";
  sequence += 1;
  return {
    id: `${Date.now()}-${sequence}`,
    text,
    segments: system ? undefined : parseAnsi(raw),
    level: consoleLevel(text),
    source: isDaemon ? "system" : source,
    label: system ? label : undefined,
  };
}
