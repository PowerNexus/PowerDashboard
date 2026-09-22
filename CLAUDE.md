# GameDashboard — consignes pour Claude Code

Panel de gestion de serveurs de jeu (remplaçant de Pterodactyl, Wings conservé).
Référence complète : [PLAN.md](./PLAN.md). Démarrage et conventions : [README.md](./README.md).
Tout le projet — code, commentaires, documentation — est rédigé **en français**.

## Règles de travail

- **Wings reste strictement non modifié.** Le panel s'adapte à son contrat, jamais l'inverse (PLAN §4.3, §5.5).
- **Dépendances : toujours les dernières versions stables**, pour la sécurité.
- **Ne pas compiler après chaque retouche.** Un `pnpm typecheck && pnpm test` complet se justifie après un changement structurel.
- **Aucun secret dans le dépôt.** Les `.env` sont ignorés à tous les niveaux ; seuls les `.env.example` sont versionnés.
- **Git** : ne commiter ou pousser que sur demande de Matheo. Branche principale `main`.
- **Aucune mention de l'ancien hébergeur de la bêta distante**, résiliée. La seule installation est la production locale `https://gamedashboard.local`.
- Une page = template + hooks + organismes, moins de 80 lignes. Aucune couleur en dur : tokens de `packages/ui/src/styles/tokens.css`.
- Chaque correction de défaut s'accompagne d'un test de non-régression.

### Sur le poste de Matheo seulement (WSL « Codiax »)

- Le dépôt vit sur ext4 (`/root/workspace/GameDashboard`), pas sur `/mnt/c` : `drvfs` n'émet pas d'`inotify` et le rechargement à chaud cassait sans le dire. Ne pas réintroduire `watchOptions.pollIntervalMs` (mesuré, sans effet).
- **Le serveur de dev appartient à Matheo** : ne jamais le tuer ni le relancer sans qu'il le demande.
- Toute exécution passe par Codiax, jamais par le shell Windows.
- Sans systemd : après un redémarrage de WSL, `sudo service docker start`.

### En session distante (cloud)

L'environnement se prépare avec `.claude/cloud-setup.sh` (Node 24, pnpm épinglé, PostgreSQL local, `pnpm install`, migrations). Il n'y a **ni Wings, ni Docker, ni production locale** : les bancs `infra/local/verifier-*.sh` ne tournent pas ici. Sans `DATABASE_URL`, les tests d'intégration se sautent proprement.

## Commandes

```bash
pnpm install --frozen-lockfile
pnpm lint          # Biome
pnpm typecheck
pnpm test          # Vitest
pnpm openapi       # régénère openapi.json depuis packages/contracts/src/api-catalogue.ts
pnpm db:generate   # doit ne rien produire si schéma et migrations sont en phase
```

La CI (`.github/workflows/ci.yml`) refuse un schéma sans migration et un catalogue d'API sans `openapi.json` régénéré.

## État de la V1

Fait, avec tests de non-régression :

- **Planificateur** parallélisé avec garde `enVol` (`apps/api/src/modules/scheduler/schedule-runner.service.ts`).
- **Balayages de fond** centralisés dans `battre()` (`apps/api/src/common/background-tick.ts`) : un rejet non rattrapé tuait le processus sous Node 24.
- **Changement d'egg** transactionnel, synchronisé avant réinstallation.
- **Mots de passe** : bcrypt reconnu et réécrit en Argon2id à la première connexion (`packages/auth/src/password.ts`).
- **Reprise Pterodactyl** : `apps/api/scripts/import-pterodactyl.mts`, voir `docs/reprise-pterodactyl.md`.
- **OpenAPI + SDK** : catalogue unique `packages/contracts/src/api-catalogue.ts`, SDK écrit à la main dans `packages/sdk`.
- **Egg Minecraft Java unifié** : `infra/eggs/minecraft-java/`.
- **Machine injoignable** : `nodes.unreachableSince` (seul écrivain : `node-health-watcher.service.ts`) → `nodeOutageBlock()` (`packages/contracts/src/server.ts`) → blocage complet de l'interface serveur.

**Reste à faire — `docs/`**, dernier chantier V1 : ADR, runbooks, guide du contributeur.
Seul `docs/reprise-pterodactyl.md` existe.

ADR à rédiger (décisions déjà tranchées, raisons dans le code et PLAN) :
Wings conservé tel quel · Argon2id plutôt que bcrypt · catalogue d'API comme source unique de la spécification · SDK écrit plutôt que généré · machine muette comme état de premier rang · dépôt sur ext4 plutôt que `drvfs`.

Matière des runbooks : rotation du jeton de node (`POST /admin/nodes/:id/token/rotate`, refusée si le daemon ne répond pas ; banc `infra/local/verifier-rotation.sh`), perte ou changement de sel d'`APP_SECRET_KEY` (`packages/auth/src/secrets.ts`, `apps/api/scripts/rekey-secrets.mts`), `infra/local/README.md`, `infra/prod/README.md`.

À vérifier avec Matheo : `infra/prod/README.md` décrit encore une « bêta publique », probablement périmée.
