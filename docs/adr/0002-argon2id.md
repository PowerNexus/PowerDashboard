# 0002 — Argon2id pour les mots de passe, bcrypt lu seulement

- **État** : acceptée
- **Date** : 2026-09
- **Références** : PLAN §5.1 ; `packages/auth/src/password.ts` ;
  [reprise Pterodactyl](../reprise-pterodactyl.md)

## Contexte

Pterodactyl hache les mots de passe en bcrypt. bcrypt a deux faiblesses
connues :

- **il tronque sans le dire au-delà de 72 octets**. Deux mots de passe longs
  qui partagent leurs 72 premiers octets deviennent équivalents, et une phrase
  de passe perd tout ce qui dépasse ;
- **il n'a pas de coût mémoire**. Il résiste mal au calcul massivement
  parallèle sur GPU, c'est-à-dire à l'attaque qui suit une fuite de base.

Le panel doit aussi reprendre des comptes Pterodactyl existants, dont personne
ne connaît le mot de passe en clair.

## Décision

**Le panel hache en Argon2id**, avec les paramètres OWASP (19 MiB, 2 passes,
parallélisme 1), exportés dans `ARGON2_OPTIONS` et non enfouis dans les appels.

**Il sait lire un bcrypt, sans jamais en produire.** `verifyPassword` reconnaît
les en-têtes `$2a$`, `$2b$` et `$2y$` (Pterodactyl a émis les trois selon les
versions de PHP). `needsRehash` déclare ce condensat périmé, et le contrôleur
de connexion le réécrit en Argon2id à l'instant où le mot de passe est en
clair.

## Options écartées

- **Rester en bcrypt** pour la compatibilité : on garderait ses deux défauts
  pour toujours, afin d'éviter une conversion qui ne coûte rien.
- **Refuser les condensats importés** : tout le parc passerait par « mot de
  passe oublié » le jour de la bascule, justement le jour où le support est
  déjà saturé.
- **Importer les comptes sans mot de passe** : les comptes seraient fermés.

## Conséquences

- Le parc se convertit tout seul, sans que personne ait rien à faire. Aucun
  bcrypt ne survit à sa première utilisation. Un compte jamais reconnecté
  garde son bcrypt, et c'est sa seule faiblesse résiduelle.
- Relever les paramètres Argon2 plus tard suit le même chemin : on modifie
  `ARGON2_OPTIONS`, puis `needsRehash` réécrit chaque condensat à la connexion
  suivante.
- Un condensat illisible fait échouer la connexion proprement (`false`), sans
  exception : le détail part dans les journaux, pas dans la réponse HTTP.
- **À ne pas confondre** avec le chiffrement réversible des secrets
  (`packages/auth/src/secrets.ts`). Un mot de passe se hache parce qu'on ne le
  relit jamais. Un jeton de node se chiffre parce qu'il faut le présenter à
  Wings. Se tromper de sens oblige soit à tout réémettre, soit à transformer une
  fuite de base en fuite de mots de passe.
