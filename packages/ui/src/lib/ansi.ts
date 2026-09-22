/**
 * Nettoyage des séquences d'échappement d'un flux de console.
 *
 * Un serveur de jeu n'écrit pas du texte : il écrit un flux destiné à un
 * terminal, mêlé de séquences de contrôle. Affichées telles quelles, elles
 * apparaissent en clair au milieu de la ligne — c'est ainsi qu'un `ESC[6n`
 * finit par se lire « [6n » devant la commande qu'on vient d'envoyer.
 *
 * Le parti pris est de **retirer** plutôt que d'interpréter. Convertir les
 * couleurs ANSI en balises demanderait de produire du HTML à partir de la
 * sortie d'un serveur de jeu — c'est-à-dire de laisser des joueurs choisir le
 * balisage d'une page du panel. Le jour où la console sera colorée, elle le
 * sera par un analyseur n'émettant que des classes closes, jamais par de
 * l'injection de balises.
 *
 * Les motifs sont écrits avec `` et jamais avec le caractère brut : un
 * octet d'échappement littéral rend le fichier binaire aux yeux des outils, et
 * survit mal aux copies, aux fusions et aux éditeurs.
 */

const ESC = "\\u001B";

/**
 * Séquences CSI : `ESC [ … lettre`.
 *
 * Couvre les couleurs (`ESC[32m`), les déplacements de curseur (`ESC[2J`) et
 * les interrogations comme `ESC[6n`, que le terminal d'un conteneur émet pour
 * demander la position du curseur — sans réponse possible ici, puisque
 * personne n'écoute de l'autre côté.
 */
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/** Séquences OSC : `ESC ] … BEL` ou `ESC ] … ESC \`. Titre de fenêtre, surtout. */
const OSC = new RegExp(`${ESC}\\][^\\u0007\\u001B]*(?:\\u0007|${ESC}\\\\)`, "g");

/**
 * Les autres séquences d'échappement : `ESC (B`, `ESC =`, `ESC >`, `ESC c`…
 *
 * L'octet final couvre `0` à `~`, et non `0` à `?` : la seconde plage laissait
 * passer `ESC (B` — le sélecteur de jeu de caractères, que tout terminal émet
 * au démarrage — parce que son `B` tombe au-delà. Il s'affichait alors en clair.
 *
 * Appliquée **après** CSI et OSC : sa plage engloberait leur `[` et leur `]`,
 * et elle les tronquerait en n'en retirant que les deux premiers caractères.
 */
const SHORT = new RegExp(`${ESC}[ -/]*[0-~]`, "g");

/**
 * Caractères de contrôle restants.
 *
 * Les tabulations et sauts de ligne sont **préservés** : ce sont des
 * espacements, pas des commandes, et les retirer collerait les colonnes d'une
 * sortie tabulée.
 */
// biome-ignore-start lint/suspicious/noControlCharactersInRegex: ces caractères sont précisément ce que la fonction retire.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
// biome-ignore-end lint/suspicious/noControlCharactersInRegex: fin du nettoyeur.

/**
 * Retour chariot, traité à part.
 *
 * Un serveur qui redessine une barre de progression renvoie le curseur en
 * début de ligne à chaque rafraîchissement. Le conserver ferait s'empiler les
 * états successifs sur une même ligne.
 */
const CARRIAGE_RETURN = /\r/g;

export function stripAnsi(text: string): string {
  return text
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(SHORT, "")
    .replace(CARRIAGE_RETURN, "")
    .replace(CONTROL, "");
}
