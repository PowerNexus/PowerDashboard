/**
 * Forme de l'utilisateur connecté, et son affichage.
 *
 * Volontairement **hors** de `server/api/client.ts` : ce module-là importe
 * `next/headers`, ce qui le réserve aux composants serveur. Un composant client
 * qui en importerait ne serait-ce qu'une fonction pure entraînerait tout le
 * module dans le paquet du navigateur, et la compilation échouerait — c'est
 * exactement ce qui est arrivé la première fois.
 *
 * Ici, rien ne dépend de Next : le type et son formatage peuvent traverser la
 * frontière dans les deux sens.
 */
export interface SessionUser {
  id: string;
  email: string;
  nameFirst: string;
  nameLast: string;
  role: string;
  avatarUrl: string | null;
  /** Par quel chemin cette session a été ouverte. */
  authMethod: string;
  /**
   * Membre du personnel qui regarde ce compte, ou `null` dans le cas courant.
   *
   * Le reste de l'objet — identité, rôle, droits — est celui du **client** :
   * c'est ce qui permet à tous les écrans de fonctionner sans rien savoir de la
   * prise en main.
   */
  impersonator: { id: string; email: string } | null;
  locale: string;
  /** Nul tant que l'adresse n'a pas été confirmée par un clic. */
  emailVerifiedAt: string | null;
  timezone: string;
}

/** Prénom et nom, ou l'adresse e-mail à défaut : un nom vide n'affiche rien. */
export function displayName(user: SessionUser): string {
  const name = `${user.nameFirst} ${user.nameLast}`.trim();
  return name === "" ? user.email : name;
}
