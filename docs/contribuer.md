# Contribuer

Tout le projet est rédigé **en français** : code, commentaires,
documentation, messages de commit. Les commentaires disent *pourquoi* : ce
qu'on a écarté, le défaut qu'une ligne empêche, l'incident qui l'a motivée. Le
*quoi*, le code le dit déjà.

## Installer

- **Node 24** (`.nvmrc`) et **pnpm à la version épinglée** dans `package.json`
  (`corepack enable` suffit).
- **PostgreSQL** pour les tests d'intégration. Sans `DATABASE_URL`, ils se
  sautent proprement et le disent.
- **Docker**, **Wings** et la production locale seulement pour les bancs
  `infra/local/verifier-*.sh` (voir plus bas).

```bash
pnpm install --frozen-lockfile
pnpm services:up      # PostgreSQL, Redis, MinIO, Mailpit
pnpm db:migrate
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Sur le poste de Matheo, le dépôt vit sur ext4 dans WSL, jamais sur `/mnt/c`
([ADR 0006](./adr/0006-depot-sur-ext4.md)). Le serveur de dev lui appartient :
on ne le tue ni ne le relance sans qu'il le demande. Une session distante se
prépare avec `bash .claude/cloud-setup.sh`.

## Les règles qui ne se discutent pas

1. **Wings n'est jamais modifié.** Le panel s'adapte à son contrat
   ([ADR 0001](./adr/0001-wings-conserve.md)). Une divergence se corrige côté
   panel, même quand le daemon a l'air d'avoir tort.
2. **Chaque correction de défaut vient avec son test de non-régression.** Le
   test doit échouer sur l'ancien code. Vérifier qu'il échoue, pas seulement
   qu'il passe.
3. **Aucun secret dans le dépôt.** Seuls les `.env.example` sont versionnés.
4. **Dépendances : toujours les dernières versions stables.** Les overrides
   vivent dans `pnpm-workspace.yaml` (pnpm 11 ne lit plus le champ `pnpm` de
   `package.json`), de même que `allowBuilds`, la liste des paquets autorisés à
   exécuter un script d'installation. Toute ligne ajoutée là s'accompagne de
   sa raison.

## Où mettre quoi

| Paquet | Contient | N'importe pas |
|---|---|---|
| `packages/contracts` | Schémas Zod, types, **règles métier partagées** (`nodeStatus`, `nodeOutageBlock`…), catalogue d'API | l'interface, l'API |
| `packages/ui` | Design system : atomes, molécules, organismes, gabarits | la moindre logique métier |
| `packages/auth` | Hachage, chiffrement des secrets, TOTP, jetons | NestJS |
| `packages/db` | Schéma Drizzle et migrations | |
| `packages/i18n` | Catalogues FR/EN | |
| `packages/sdk` | Client TypeScript des intégrateurs ([ADR 0004](./adr/0004-sdk-ecrit.md)) | |
| `apps/api` | NestJS : modules, guards, balayages de fond, scripts d'exploitation | |
| `apps/web` | Next.js : pages, hooks | la base, les clés |

**Une règle qui doit être la même partout va dans `contracts`**, pas dans
l'écran qui l'a vue en premier. Deux copies d'une règle finissent toujours par
diverger.

## Interface

- **Une page = gabarit + hooks + organismes, moins de 80 lignes.** Au-delà, un
  organisme manque.
- **Aucune couleur en dur** : uniquement les tokens de
  `packages/ui/src/styles/tokens.css`. Chaque composant doit fonctionner dans
  les deux thèmes, et la vitrine `/design` sert à le vérifier, en
  développement (`pnpm dev`) : en production elle répond « introuvable ».
- `SelectMenu` plutôt que `<select>`, `RelativeTime` pour toute date relative
  (voir le README).
- **Textes** : le français fait foi dans `packages/i18n/src/messages/fr.json`.
  `messages.test.ts` refuse une clé absente en anglais, une clé orpheline ou une
  variable différente.
- Une mesure inconnue est **absente**, jamais à zéro. `MetricBar` accepte
  `null` ([ADR 0005](./adr/0005-machine-muette.md)).

## API

- **Autorisation** : l'identité et le rôle par les guards (`SessionGuard`,
  `AdminWriteGuard`, `ApplicationGuard` avec `@RequireScopes`), et la
  permission sur un serveur par `ServerAccessService.require(principal, id,
  "files.write")`. On ne fait jamais de contrôle ad hoc dans un service. Une
  permission ajoutée au catalogue doit être exigée quelque part :
  `permissions-coverage.test.ts` le vérifie.
- **Toute entrée passe par Zod.** Les refus sortent en Problem Details, avec
  un `detail` qui dit quoi changer.
- **Un balayage de fond s'arme par `battre()`**
  (`apps/api/src/common/background-tick.ts`), jamais par
  `setInterval(() => void this.tick())`. `void` n'attrape pas le rejet, et
  Node 24 tue alors le processus entier.
- **Hacher ou chiffrer** : ce qu'on ne relit jamais (mots de passe, sessions,
  clés d'API) se hache. Ce qu'il faut présenter à un tiers (jeton de node, mot
  de passe MySQL, secret de webhook) se chiffre avec `encryptRowSecret`
  (`apps/api/src/common/row-secrets.ts`), qui lie la valeur à sa ligne : un
  chiffré recopié sur une autre ligne ne se relit plus. L'identifiant de la
  ligne doit donc exister avant l'écriture (`randomUUID()` passé à
  `values({ id, … })`). Une nouvelle colonne chiffrée **s'ajoute à
  `SECRET_COLUMNS`** (même fichier) **et à `REKEY_TARGETS`**
  (`apps/api/src/common/rekey.ts`), sans quoi une rotation de la clé maître la
  perd
  ([runbook](./runbooks/cle-maitre-secrets.md)) ; `rekey.test.ts` compare les
  deux listes.

### Ajouter une route publique

Dans le même commit :

1. le contrôleur ;
2. la ligne correspondante dans `packages/contracts/src/api-catalogue.ts` ;
3. `pnpm openapi`, puis commiter `openapi.json` régénéré.

`api-reference-coverage.test.ts` vérifie que la route documentée existe, et la
CI vérifie que la spécification est à jour
([ADR 0003](./adr/0003-catalogue-api-source-unique.md)).

### Modifier le schéma

1. Modifier `packages/db/src/schema/`.
2. `pnpm db:generate`, relire la migration produite, la commiter **avec son
   instantané** (`migrations/meta/NNNN_snapshot.json`).
3. `pnpm db:check` doit répondre « Schéma et migrations en phase ».

**Une migration écrite à la main** (trigger, index partiel, reprise de
données) se génère d'abord avec `pnpm db:generate --custom`, qui produit un
fichier SQL vide *et* son instantané, puis se remplit. Sans instantané,
drizzle-kit compare le schéma à un état ancien. C'est arrivé aux
migrations 0027 à 0037, et la migration 0038 a dû en réparer les suites.

Ne pas se fier au code de sortie de `drizzle-kit generate` : sans terminal, il
s'arrête sur ses questions de renommage et sort quand même en succès.
`db:check` lit sa sortie pour cette raison.

Les migrations sont **rétro-compatibles** (expand/contract) : on ajoute la
nouvelle colonne, on bascule le code, puis on retire l'ancienne dans une
livraison suivante.

## Tests

```bash
pnpm lint        # Biome
pnpm typecheck
pnpm test        # Vitest
pnpm db:check    # schéma et migrations en phase
pnpm openapi     # puis git diff openapi.json : doit rester vide
```

Pas besoin de tout recompiler après chaque retouche : la suite complète se
justifie après un changement structurel, et avant de pousser.

- **Unitaires** : `*.test.ts` à côté du code.
- **Intégration** : `*.integration.test.ts`, sur une base jetable
  (`apps/api/src/test/throwaway-database.ts`). `DATABASE_URL=… pnpm test` les
  exécute (turbo transmet la variable) ; sans elle, ils se sautent et le
  disent.
- **Contrat Wings** : les bancs `infra/local/verifier-*.sh`, contre un Wings
  réel ([`infra/local/README.md`](../infra/local/README.md)). Ils ne tournent
  que sur Codiax, pas en CI ni en session distante. À lancer après toute
  modification de ce que le panel envoie à Wings ou de ce qu'il en reçoit.
- **E2E** : `pnpm e2e` (Playwright), contre l'API réelle et PostgreSQL. La
  même suite porte :
  - **Lighthouse** (`e2e/performance.spec.ts`), profil bureau : performance,
    accessibilité et bonnes pratiques à 90 au moins, référencement à 80. Les
    scores s'écrivent au journal, même au vert ;
  - **les régressions visuelles** (`e2e/visuel.spec.ts`) : chaque écran
    comparé à sa capture de référence, bureau et mobile.

  Le compte d'essai est administrateur, et la seconde preuve du personnel est
  exigée par défaut : la CI la lève pour sa base jetable seule (étape
  « Seconde preuve du personnel levée » de `ci.yml`). Sur une base locale
  jetable, même geste avant `pnpm e2e` :
  `insert into settings (key, value) values ('security.staffRequires2fa', 'false')`.

On teste ce qui a des règles (seuils, précédences, permissions, formats) ; le
rendu, lui, n'est tenu que par les captures.

### Captures de référence

Elles se prennent **sur le runner et nulle part ailleurs** : le rendu des
polices change d'une machine à l'autre, et une capture prise sur un poste ou
dans une session distante ferait échouer la CI sur des différences
d'anticrénelage.

- **Une capture manque** (écran ajouté) : son test est sauté, et le dit.
- **Un écran a changé, et c'est voulu** : la CI échoue sur la différence.
  Lancer *Actions › Captures de référence › Run workflow* sur la branche : le
  workflow reprend toutes les captures sur le runner et les commite. Son
  commit ne relance pas la CI ; pousser ensuite, ou relancer la CI.
- **Un écran a changé sans le vouloir** : c'est ce que la suite est là pour
  attraper. Le rapport Playwright montre l'image attendue, l'image obtenue et
  leur différence.

Ce qui change d'une exécution à l'autre sans que l'interface change se déclare
dans le code : `<time>` et `data-instable` sont masqués d'un aplat,
`data-instable-liste` est retiré de la capture (une liste dont la longueur
varie).

## Ce que la CI refuse

`.github/workflows/ci.yml` bloque sur : lint, types, tests, build, build de
Storybook, **un schéma sans migration**, **un catalogue d'API sans
`openapi.json` régénéré**, `pnpm audit` dès le niveau *low*, Trivy (dépendances,
secrets, configuration), Semgrep et le **scan ZAP** de l'application compilée.
`pnpm outdated -r` informe sans bloquer.

Une alerte ZAP nouvelle se corrige, ou s'accepte dans
`infra/ci/zap-regles.tsv` avec sa raison. Le scan se rejoue en local après
`pnpm build`, avec Docker et une base migrée :
`DATABASE_URL=… APP_SECRET_KEY=… bash infra/ci/zap-baseline.sh`.

## Git

La branche principale est `main`. On ne commite et ne pousse que sur demande
de Matheo. Un commit = un changement cohérent, décrit en français, qui dit
pourquoi.

## Documenter une décision

Une décision structurante, c'est-à-dire qu'on ne pourrait pas défaire sans
toucher plusieurs paquets, s'écrit en ADR dans `docs/adr/`
([format](./adr/README.md)). Une procédure qu'on suivra un jour sous pression
s'écrit en runbook dans `docs/runbooks/`.
