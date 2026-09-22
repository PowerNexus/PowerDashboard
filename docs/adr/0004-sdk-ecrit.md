# 0004 — Le SDK est écrit à la main, pas généré

- **État** : acceptée
- **Date** : 2026-09
- **Références** : `packages/sdk/src/client.ts`, `packages/sdk/src/console.ts` ;
  [ADR 0003](./0003-catalogue-api-source-unique.md)

## Contexte

Une fois `openapi.json` disponible, la voie naturelle serait d'en générer le
client TypeScript. Mais la spécification ne décrit pas encore tous les corps
de requête et de réponse. Les types exacts, eux, existent déjà : ce sont les
schémas Zod de `@gamedashboard/contracts`, qu'API et interface partagent.

## Décision

**`@gamedashboard/sdk` est écrit à la main**, sur les types de `contracts`, et
ne couvre que les routes qu'un système tiers emploie réellement.

Il apporte ce qu'un `fetch` nu n'a pas :

- **des refus lisibles** : `ApiProblem` porte `status` *et* `detail` du Problem
  Details. Le code dit s'il faut réessayer, le détail dit quoi changer ;
- **une échéance** (10 s par défaut) : sans elle, un panel qui accepte la
  connexion sans jamais répondre fige l'appelant ;
- **la clé posée une fois**, au lieu d'un en-tête recopié à chaque appel,
  dont l'oubli produit des 401 qu'on cherche longtemps ;
- l'ouverture de la console temps réel (`openServerConsole`).

## Options écartées

- **Générer depuis `openapi.json`** : des corps non décrits deviendraient des
  méthodes typées `unknown`. On aurait l'illusion d'un contrat là où il n'y en
  a pas, ce qui est pire que pas de types du tout.
- **Une méthode par chemin du catalogue** : une surface que personne ne relit,
  et qui vieillit sans que personne le voie.

## Conséquences

- Une route utile à un intégrateur s'ajoute au SDK à la main, avec son test
  dans `client.test.ts`. Le SDK n'est pas exhaustif, et c'est voulu.
- Les types du SDK ne peuvent pas diverger de l'API : ils viennent du même
  paquet.
- **À revoir** quand `openapi.json` décrira tous les corps : la génération
  redeviendrait honnête, et l'arbitrage serait à refaire.
