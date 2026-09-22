import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "./session.guard";

/**
 * Une prise en main est **en lecture seule**, et cela se tient ici.
 *
 * C'est le choix central de cette fonction. Une prise en main qui pourrait
 * écrire créerait un trou d'imputabilité : chaque geste serait consigné au nom
 * du client — c'est son compte, c'est sa session — et plus rien ne dirait que
 * l'agent d'assistance en est l'auteur. Un serveur supprimé pendant une prise
 * en main deviendrait une suppression que le client jure ne pas avoir faite, et
 * le journal lui donnerait tort.
 *
 * Refuser l'écriture referme le problème à la racine, plutôt que d'ajouter
 * l'emprunteur dans une centaine d'appels au journal — ce qu'un seul oubli
 * suffirait à trahir.
 *
 * Ce que ça coûte est assumé : l'assistance ne peut pas « réparer à la place
 * de ». Elle voit ce que le client voit, ce qui est le besoin réel — « le
 * bouton ne marche pas chez moi » — et agit ensuite depuis l'administration,
 * sous son propre nom.
 *
 * Le garde est posé sur les routes client et sur les routes de compte de
 * `/api/v1/auth` qui écrivent (clés SSH, passkeys, sessions, 2FA, mot de
 * passe) : une clé SSH ajoutée pendant une prise en main ouvrirait un accès
 * SFTP durable au nom du client. Seuls `logout` et `impersonation/stop` en
 * sont exempts, puisqu'ils ferment la prise en main. Les routes
 * d'administration sont hors d'atteinte de toute façon : la session porte le
 * rôle du client.
 */
@Injectable()
export class ImpersonationReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { method?: string }>();

    // Pas d'emprunt : rien à dire. C'est le cas de toutes les requêtes
    // ordinaires, et ce garde doit leur coûter une comparaison.
    if (!request.user?.impersonator) return true;

    /*
     * `GET` et `HEAD` seulement.
     *
     * La liste est celle des méthodes sans effet, pas celle des routes
     * inoffensives : juger route par route demanderait de tenir un inventaire,
     * et une route ajoutée sans y penser serait ouverte par défaut. Ici elle
     * est fermée par défaut.
     */
    const method = (request.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return true;

    throw new ForbiddenException(
      "Vous regardez ce compte en tant que membre du personnel : cette session est en lecture seule.",
    );
  }
}
