# Mission : audit de sécurité OWASP ASVS niveau 2

Ce fichier est la consigne d'une session Claude chargée de l'audit de
sécurité de la V1 (PLAN §5.4 et §12.4). Il se suffit à lui-même : la session
qui le lit n'a pas besoin de l'historique des conversations précédentes.

Lire aussi, dans cet ordre : [`CLAUDE.md`](../../CLAUDE.md) (règles du
dépôt), [PLAN.md](../../PLAN.md) §5 (sécurité) et §7 (API), puis le
[guide du contributeur](../contribuer.md).

---

## 1. Le but

Vérifier le panel contre **OWASP ASVS 4.0.3, niveau 2**, et corriger ce qui
ne tient pas. Le livrable principal est un **rapport**, pas du code :
Matheo arbitre les points discutables avant toute correction.

## 2. Ce qu'on attend, dans l'ordre

1. **Branche neuve** depuis `main` : `securite/asvs-l2`.
2. **Rapport** dans `docs/securite/rapport-asvs-l2.md` (voir §6 pour la
   forme). Le pousser et ouvrir une PR **avant** de corriger quoi que ce
   soit.
3. **S'arrêter et attendre l'accord de Matheo** sur les corrections.
4. Ensuite seulement : corriger, **un défaut = un commit = un test de
   non-régression** qui échoue sans la correction (règle de `CLAUDE.md`).

## 3. Le périmètre

**Dans le périmètre :**

| Partie | Où | Pourquoi c'est sensible |
|---|---|---|
| API NestJS | `apps/api/src` | Toute la logique, l'accès aux données, les jetons |
| Interface Next.js | `apps/web/src` | Sessions en cookie, actions serveur, CSP, routes de cérémonie OAuth |
| Authentification | `packages/auth/src`, `apps/api/src/modules/auth` | Mots de passe, TOTP, clés d'accès, sessions, SSO, bouton Google |
| Contrats partagés | `packages/contracts/src` | Validation des entrées (zod), catalogue d'API |
| Base | `packages/db/src/schema`, `packages/db/migrations` | Contraintes, secrets chiffrés |
| Déploiement | `infra/prod`, `.github/workflows` | En-têtes nginx, TLS, SBOM, actions épinglées |

**Hors périmètre :**

- **Wings**, le daemon des machines de jeu. Il n'est **jamais** modifié
  (`CLAUDE.md`). En revanche, **ce que le panel lui envoie et accepte de lui**
  est dans le périmètre : `apps/api/src/modules/remote` (routes appelées par
  Wings) et `apps/api/src/modules/wings` (appels vers Wings).
- **La production** (`gamedashboard.local`) : injoignable depuis une session
  cloud, et on n'attaque pas la production.
- Les dépendances tierces elles-mêmes : l'audit `pnpm audit` tourne déjà en CI.

## 4. Les zones à regarder en priorité

Classées par gravité possible. Pour chacune : les fichiers d'entrée.

1. **Contrôle d'accès aux serveurs.** Un client ne doit jamais atteindre le
   serveur d'un autre, ni un sous-utilisateur dépasser ses permissions.
   `apps/api/src/modules/client/server-access.service.ts` (point unique de
   décision), tous les contrôleurs de `modules/client`, les permissions de
   `packages/contracts`. Chercher une route qui oublie `access.require`.
2. **Rôles et administration.** Personnel, revendeurs, clients.
   `modules/admin/admin.guard.ts`, `staff-2fa.guard.ts`, `modules/reseller`
   (un revendeur ne doit voir que **ses** machines et **ses** clients),
   `modules/auth/impersonation*.ts` (prise en main d'un compte).
3. **Sessions et authentification.** `session.guard.ts`,
   `browser-session.guard.ts`, `session-issuer.service.ts` (point commun
   d'ouverture de session : suspension, alertes), `login-challenge.ts`
   (défi chiffré du second facteur), `passkey.*`, `packages/auth/src/*`
   (Argon2id, TOTP, codes de secours, limitation des tentatives).
4. **Cérémonies externes.** `sso.service.ts` (annuaire OIDC **et** bouton
   Google : même rapprochement de comptes), `billing-sso.service.ts` (lien à
   usage unique venu de la facturation), côté interface
   `apps/web/src/server/ceremony.ts` (vérification de `state`, cookies PKCE).
   Question clé : un attaquant peut-il se faire rattacher le compte de
   quelqu'un d'autre ?
5. **CSRF.** Les commentaires du dépôt affirment que « l'API vérifie Origin
   et un jeton en double soumission » (`infra/ci/zap-regles.tsv`, PLAN
   §5.4). **À vérifier dans le code, sans le supposer** : `apps/api/src/main.ts`
   (CORS limité à `PANEL_ORIGIN`), les gardes, les actions serveur de Next.
6. **Routes appelées par Wings.** `modules/remote` : `node-token.guard.ts`
   (jeton du node), et surtout la règle « un node ne touche qu'aux serveurs
   qu'il héberge » (`remote-backup.service.ts`, `remote-server.service.ts`,
   `sftp-auth.service.ts`).
7. **Clés d'API.** Clés personnelles et applicatives : portées, liste d'IP
   (`packages/auth/src/ip-allowlist.ts`), expiration, stockage haché
   (`api-key.repository.ts`, `modules/application`).
8. **Secrets au repos.** `packages/auth/src/secrets.ts` (format `v3:`),
   `rekey-secrets.mts`, réglages secrets de `platform-settings.service.ts`
   (un secret ne doit jamais ressortir par une route).
9. **Fichiers et sauvegardes.** Liens signés de téléchargement (Wings et S3,
   `modules/storage/s3.service.ts`, `wings-token.service.ts`), envoi de
   fichiers, chemins (traversée de répertoires).
10. **En-têtes et navigateur.** CSP à nonce (`apps/web/src/proxy.ts`,
    `lib/content-security-policy.ts`), COOP, cookies (`HttpOnly`, `Secure`,
    `SameSite`), vhost nginx (`infra/prod`).
11. **Journalisation.** Ce qui est tracé (`modules/activity`), et ce qui ne
    doit **pas** l'être : mots de passe, jetons, secrets, corps d'erreur de
    fournisseurs.

## 5. Ce qui est déjà vérifié

Ne pas refaire, mais on peut s'en servir comme preuve dans le rapport :

- **Scan ZAP passif** en CI (`infra/ci/zap-baseline.sh`, exceptions
  justifiées dans `infra/ci/zap-regles.tsv`).
- **CSP sans `'unsafe-inline'`** pour les scripts, testée par
  `apps/web/e2e/securite.spec.ts`.
- **Cérémonie Google** : `google-sign-in.integration.test.ts` (PKCE, adresse
  vérifiée, pas de création quand les inscriptions sont fermées, absent quand
  l'annuaire est obligatoire).
- **Rapprochement SSO** : `sso-resolve.test.ts` (refus d'une adresse non
  vérifiée, refus de détourner un compte déjà lié).
- **Alertes de connexion** : `security-alert.integration.test.ts`.
- **SBOM** attesté à chaque release (`release.yml`).

## 6. La forme du rapport

`docs/securite/rapport-asvs-l2.md`, en français. Pour **chaque exigence
ASVS de niveau 2** (V1 à V14) :

| Colonne | Contenu |
|---|---|
| Exigence | Numéro et intitulé court (ex. `2.1.1 Mot de passe ≥ 12 caractères`) |
| Verdict | **Conforme**, **Non conforme**, **Partiel** ou **Sans objet** |
| Preuve | Fichier et ligne, test, ou commande qui le montre |
| Correction | Pour un non conforme : ce qu'il faudrait changer, et sa gravité (critique, haute, moyenne, basse) |

En tête du rapport : un résumé de dix lignes au plus, puis la **liste des
non-conformités triées par gravité**. C'est la seule partie que Matheo lira
en entier ; le tableau complet sert de preuve.

Règles :
- **Une affirmation = une preuve.** Pas de « probablement conforme ».
- **Un doute se teste.** Écrire un test ou lancer une requête plutôt que
  conclure à la lecture. Un test qui démontre une faille reste dans le
  dépôt, avec sa correction.
- **Sans objet** se justifie en une phrase (ex. « pas d'envoi de fichiers
  XML »).

## 7. Comment tester en session cloud

Voir `CLAUDE.md`, section « En session distante ». En résumé :

```bash
bash .claude/cloud-setup.sh           # Node 24, pnpm, PostgreSQL, dépendances
export PATH=/usr/bin:$PATH             # si /opt/node22 passe devant
pnpm lint && pnpm typecheck
DATABASE_URL=postgres://gamedashboard:gamedashboard@127.0.0.1:5432/gamedashboard pnpm test
```

Pour attaquer une instance qui tourne :

1. Une base jetable : `createdb`, puis
   `DATABASE_URL=… pnpm --filter @gamedashboard/db db:migrate`.
2. Un compte administrateur : `apps/api/scripts/create-admin.mts` et
   `reset-password.mts` (voir le job e2e de `.github/workflows/ci.yml`).
3. L'API (`apps/api`, `pnpm exec tsx src/main.ts`, avec `DATABASE_URL`,
   `APP_SECRET_KEY` d'essai tirée par `openssl rand -base64 48`,
   `PORT=3201`, `PANEL_ORIGIN=http://localhost:3000`) et l'interface
   compilée (`pnpm --filter @gamedashboard/web build`, puis `next start`
   avec `API_URL` et `PANEL_ORIGIN`).
4. Attaquer avec `curl` ou Playwright (Chromium est préinstallé, voir
   `apps/web/e2e`). Docker se lance avec `sudo dockerd` si besoin d'un MinIO.

Pièges connus :
- **Ne jamais tuer un processus avec `pkill -f`** : le motif trouve aussi le
  shell qui lance la commande, et la session s'interrompt.
- Le test `security-alert.integration.test.ts › n'empêche ni ne retarde la
  connexion` dépasse son délai de 5 s dans un conteneur lent (Argon2), avec
  ou sans changement. Ce n'est pas une faille.
- La CI tourne sur le runner auto-hébergé de Matheo, **éteint quand son PC
  l'est** : ne pas attendre la CI, vérifier en local.

## 8. Les règles à ne pas enfreindre

- **Tout en français** : rapport, commits, commentaires, tests.
- **Wings n'est jamais modifié.**
- **Aucun secret dans le dépôt**, même d'essai.
- **Jamais de test sauté, désactivé ou affaibli** pour faire passer la suite.
- **Pas de refonte** au passage : une correction fait ce que le défaut
  demande, rien de plus.
- **Dépendance à mettre à jour** : toujours la dernière version stable.
