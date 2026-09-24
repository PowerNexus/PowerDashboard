/**
 * Ce que le journal d'activité retient d'une commande de console.
 *
 * **Le premier mot, et la longueur du reste. Jamais les arguments.** Décision
 * de Matheo après l'audit ASVS (NC-13). Le journal d'un serveur est lisible
 * par `activity.read` — le préréglage « lecteur » l'a —, conservé un an et
 * exporté en CSV ; or c'est dans les arguments que passent les secrets : un
 * `/login <mot de passe>` d'AuthMe, un `rcon_password …`, un `changepassword`.
 *
 * Masquer seulement les commandes connues pour être sensibles a été écarté :
 * la liste serait fausse au premier plugin qui en invente une. Le premier mot
 * suffit à ce qu'on cherche dans un journal — qui a fait `op`, `ban`, `stop` —
 * et la longueur distingue un `ban` nu d'un `ban` qui nomme quelqu'un.
 *
 * Une règle, ici, pour toutes les voies qui consignent une commande : celles
 * qui passent par le panel et celles que Wings rapporte.
 */
export interface ConsoleCommandTrace {
  /** Premier mot, borné : un mot démesuré n'est plus un nom de commande. */
  command: string;
  /** Nombre de caractères après le premier mot, espaces de tête exclues. */
  argumentsLength: number;
}

/**
 * Longueur maximale d'une commande de console, en caractères.
 *
 * La seule borne était le mégaoctet du corps Fastify, qui partait tel quel
 * sur l'entrée du jeu. Huit mille caractères laissent passer un `tellraw` ou
 * un `data merge` chargés, et rien de ce qu'un humain tape.
 */
export const MAX_CONSOLE_COMMAND_LENGTH = 8192;

/** Au-delà, le « premier mot » est autre chose qu'un nom de commande. */
const MAX_COMMAND_WORD = 64;

export function consoleCommandTrace(command: string): ConsoleCommandTrace {
  const texte = command.trim();
  const fin = texte.search(/\s/);
  const mot = fin === -1 ? texte : texte.slice(0, fin);
  const reste = fin === -1 ? "" : texte.slice(fin).trimStart();
  return { command: mot.slice(0, MAX_COMMAND_WORD), argumentsLength: reste.length };
}
