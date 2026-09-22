# 0003 — Le catalogue d'API est la source unique de la spécification

- **État** : acceptée
- **Date** : 2026-09
- **Références** : PLAN §7 ; `packages/contracts/src/api-catalogue.ts`,
  `packages/contracts/scripts/emit-openapi.mts`, `openapi.json`,
  `apps/api/src/modules/application/api-reference-coverage.test.ts`

## Contexte

Les routes publiques sont décrites à deux endroits : l'écran « API » du panel,
qu'un intégrateur lit, et la spécification OpenAPI, que ses outils lisent.
Tenues en double, elles finissent par se contredire, et personne ne sait plus
laquelle croire.

Même avec une seule liste, l'écart avec le code réel s'était déjà produit. Sept
routes annoncées étaient fausses : `ws-token` au lieu de `websocket`, un `PUT`
qui était un `POST`, `rotate-password` au lieu de `rotate`, etc. Une ligne
fausse s'affiche exactement comme une vraie, et l'intégrateur ne découvre
l'erreur qu'en production, chez lui.

## Décision

**`packages/contracts/src/api-catalogue.ts` est l'unique source.** L'écran
« API » le rend pour un lecteur humain, et `pnpm openapi` en tire
`openapi.json`. Il vit dans `contracts`, pour que ni l'interface ni le
générateur ne dépende de l'autre.

Deux contrôles le tiennent :

- **en CI**, l'étape « Spécification OpenAPI à jour » relance `pnpm openapi` et
  refuse tout écart avec `openapi.json` versionné ;
- **en test**, `api-reference-coverage.test.ts` vérifie que chaque route
  documentée existe bien dans les contrôleurs. Il lit les deux sources en
  texte : recopier les routes dans une troisième liste aurait exactement le
  défaut qu'on surveille.

## Options écartées

- **Générer la spécification depuis les décorateurs NestJS** : elle décrirait
  toutes les routes, internes comprises, et rien de ce qu'un lecteur a besoin
  de savoir (portée requise, regroupement, phrase d'explication).
- **Écrire `openapi.json` à la main** : c'est la double source qu'on cherche à
  supprimer.

## Conséquences

- Ajouter ou modifier une route publique se fait en trois gestes, dans le même
  commit : le contrôleur, la ligne du catalogue, puis `pnpm openapi`. La CI
  refuse le commit s'il en manque un.
- `openapi.json` est un fichier **généré mais versionné** : il ne se retouche
  jamais à la main.
- La spécification ne décrit pas encore tous les corps de requête. C'est une
  des raisons de l'[ADR 0004](./0004-sdk-ecrit.md).
