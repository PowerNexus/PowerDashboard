# @gamedashboard/mysql

Création et suppression des bases MySQL remises aux clients.

## Pourquoi un paquet séparé

Ce code tiendrait en un seul fichier dans l'API. Il vit à part pour une raison
mécanique, découverte à l'usage : `drizzle-orm` déclare `mysql2` en dépendance
de pair. Un paquet qui dépend des deux obtient de pnpm une **instance distincte**
de `drizzle-orm`, différente de celle de `@gamedashboard/db` — deux copies du même
ORM dans le même processus, dont les types ne sont pas interchangeables et dont
les objets internes ne se reconnaissent pas entre eux.

Isoler `mysql2` ici rompt l'adjacence : l'API ne dépend plus que de
`@gamedashboard/mysql`, et sa résolution de `drizzle-orm` reste celle du reste du
monorepo.

Ce paquet ne connaît donc ni Drizzle, ni NestJS, ni le schéma du panel. Il reçoit
des coordonnées et des noms, et exécute. Le service NestJS qui l'enveloppe vit
dans l'API.

## Ce qu'il protège

MySQL ne sait pas paramétrer un identifiant : un nom de base ou d'utilisateur
n'entre dans une requête que par concaténation. C'est la voie d'injection
classique des panels de jeu, et elle s'exerce avec le compte **administrateur**
de l'hôte — donc sur toutes les bases de tous les clients, pas seulement celle
du demandeur.

Deux protections superposées, parce que l'enjeu le justifie :

1. une expression rationnelle stricte, qui n'admet ni guillemet, ni espace, ni
   point, ni caractère de contrôle ;
2. l'échappement de `mysql2` par-dessus, appliqué même à ce qui a déjà passé
   l'expression.

`multipleStatements` est laissé à `false` : sans lui, la moindre faiblesse
d'échappement se transforme en exécution arbitraire au lieu d'une requête ratée.
