/**
 * Rôles qui donnent accès à l'espace d'administration.
 *
 * La liste est recopiée de `AdminGuard`, côté API, et c'est une duplication
 * assumée : le paquet `@gamedashboard/api` n'est pas importable depuis le web — il
 * embarque NestJS, Drizzle et le pilote PostgreSQL, qui n'ont rien à faire
 * dans un paquet destiné au navigateur.
 *
 * La duplication est sans danger tant qu'on se souvient laquelle fait foi :
 * **celle de l'API**. Celle-ci ne décide de rien, elle évite seulement
 * d'afficher un espace dont chaque requête sera de toute façon refusée. Les
 * deux ne peuvent pas diverger dangereusement — au pire, cet écran montre un
 * menu qui ne mène qu'à des 404.
 */
export const ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "support"]);

/**
 * Rôles qui peuvent **écrire** la configuration de la plateforme.
 *
 * Recopiée de `AdminWriteGuard`, comme `ADMIN_ROLES` l'est d'`AdminGuard`, et
 * pour la même raison : le paquet de l'API n'est pas importable depuis le web.
 * La duplication reste sans danger tant qu'on se souvient laquelle fait foi —
 * **celle de l'API** ; celle-ci n'accorde rien, elle évite seulement de
 * proposer un geste qui sera refusé.
 *
 * La distinction avec `ADMIN_ROLES` porte tout son sens ici. Le support voit
 * l'espace d'administration — répondre à un client demande de regarder ses
 * serveurs — mais n'y écrit pas. Lui montrer « Relier HostBill » l'enverrait
 * vers un formulaire qu'il ne peut pas enregistrer : une invitation à faire
 * quelque chose d'impossible, ce qui est pire que le silence.
 */
export const CONFIGURATION_ROLES: ReadonlySet<string> = new Set(["admin"]);
