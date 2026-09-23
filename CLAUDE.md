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

L'environnement se prépare avec `.claude/cloud-setup.sh` (Node 24, pnpm épinglé, PostgreSQL local, `cloudflared`, `pnpm install`, migrations). Il n'y a **ni Wings, ni Docker, ni production locale** : les bancs `infra/local/verifier-*.sh` ne tournent pas ici. Sans `DATABASE_URL`, les tests d'intégration se sautent proprement.

**Tunnel Cloudflare autorisé par Matheo.** Pour montrer le panel d'une session distante, enchaîner sans redemander :

1. `bash .claude/cloud-setup.sh` (Node 24 s'installe dans `/usr/bin` ; si `/opt/node22` passe devant, préfixer `PATH=/usr/bin:$PATH`).
2. `.env` de dev tirés des `.env.example` : `APP_SECRET_KEY` d'essai (`openssl rand -base64 48`), jamais commitée ; puis `pnpm dev` (API :3201, interface :3000).
3. `cloudflared tunnel --no-autoupdate --url http://localhost:3000`, donner l'adresse `trycloudflare.com` et la reporter dans `PANEL_ORIGIN` (API et interface), sinon le contrôle d'origine refuse les requêtes.

L'adresse est publique : données de démonstration seulement, tunnel arrêté en fin de session. Il faut une sortie TCP ou UDP sur le port 7844 (`*.v2.argotunnel.com`) : si la politique réseau de l'environnement la ferme, le tunnel échoue — le dire, ne pas contourner.

## Commandes

```bash
pnpm install --frozen-lockfile
pnpm lint          # Biome
pnpm typecheck
pnpm test          # Vitest
pnpm openapi       # régénère openapi.json depuis packages/contracts/src/api-catalogue.ts
pnpm db:generate   # produit la migration d'un changement de schéma
pnpm db:check      # échoue si schéma et migrations ne sont pas en phase
```

La CI (`.github/workflows/ci.yml`) refuse un schéma sans migration et un catalogue d'API sans `openapi.json` régénéré.

## État de la V1

Fait, avec tests de non-régression :

- **Planificateur** parallélisé avec garde `enVol` (`apps/api/src/modules/scheduler/schedule-runner.service.ts`).
- **Balayages de fond** centralisés dans `battre()` (`apps/api/src/common/background-tick.ts`) : un rejet non rattrapé tuait le processus sous Node 24.
- **Changement d'egg** transactionnel, synchronisé avant réinstallation.
- **Scan ZAP en CI** (PLAN §5.4) : `infra/ci/zap-baseline.sh` dans le job e2e, passif, image épinglée ; toute alerte hors de `infra/ci/zap-regles.tsv` (exceptions justifiées) fait échouer le job. `-z -silent` : les règles sont celles de l'image épinglée, sans téléchargement au démarrage.
- **Transferts perdus** : un transfert sans compte rendu depuis `TRANSFER_STALE_MS` est clos par `ServerTransferReaperService` (le serveur restait bloqué « en transfert ») ; bascule et retour en arrière verrouillent la ligne du transfert (`server-transfer.integration.test.ts`).
- **CSP à nonce + COOP** (PLAN §5.4) : `apps/web/src/proxy.ts` tire un nonce par requête, `script-src 'nonce-…' 'strict-dynamic'` sans `'unsafe-inline'` (`lib/content-security-policy.ts`) ; balise écrite à la main = `nonce={nonce}` (lu dans `x-nonce`) ; toute page doit être rendue à la demande. `Cross-Origin-Opener-Policy: same-origin` ; pas de COEP, par choix (commentaire de `next.config.ts`). Non-régression : `apps/web/e2e/securite.spec.ts`.
- **Mots de passe** : bcrypt reconnu et réécrit en Argon2id à la première connexion (`packages/auth/src/password.ts`).
- **Reprise Pterodactyl** : `apps/api/scripts/import-pterodactyl.mts`, voir `docs/reprise-pterodactyl.md`.
- **OpenAPI + SDK** : catalogue unique `packages/contracts/src/api-catalogue.ts`, SDK écrit à la main dans `packages/sdk`.
- **Egg Minecraft Java unifié** : `infra/eggs/minecraft-java/`.
- **Machine injoignable** : `nodes.unreachableSince` (seul écrivain : `node-health-watcher.service.ts`) → `nodeOutageBlock()` (`packages/contracts/src/server.ts`) → blocage complet de l'interface serveur.
- **Rechiffrement des secrets** : `rekey-secrets.mts` reprend le format `v3:` (il le sautait, une rotation de la clé maître perdait tout) ; cœur testé dans `apps/api/src/common/rekey.ts`.
- **Documentation** (`docs/`) : six ADR (`docs/adr/`), runbooks jeton de node, machine injoignable, clé maître, déplacement de serveur, restauration de la base et incident de sécurité (`docs/runbooks/`), guide du contributeur (`docs/contribuer.md`). README à jour.
- **Schéma et migrations en phase** : instantané `0038`, migration `0038_constraint_names`, `pnpm db:check` (drizzle-kit sort en succès même quand il s'arrête sur une question).
- **Certificats des revendeurs** : un certificat expiré n'est plus « actif » (`certificateStanding`).
- **Traduction complète** : page d'erreur et page introuvable ; routes citées dans les textes vérifiées contre l'API.
- **API applicative complète et documentée** : `POST users/sso-link` et `PATCH servers/:id` (redimensionnement) ajoutés au catalogue ; toute route applicative doit y figurer. SDK : `suspendServer`/`unsuspendServer` visaient des routes inexistantes (404), corrigés ; `resizeServer` et `ssoLink` ajoutés ; chaque appel du SDK est vérifié contre le catalogue.

**La V1 est terminée.** Les runners hébergés de GitHub Actions sont suspendus (facture impayée) : les workflows visent un runner auto-hébergé (`docs/runner-auto-heberge.md`, variable `CI_RUNNER` pour changer de cible). Tant qu'aucun n'est enregistré, les vérifications se font en local — `pnpm lint && pnpm typecheck && DATABASE_URL=… pnpm test && pnpm db:check && pnpm build`, puis `pnpm e2e`.

- **`infra/prod`** : modèle de production à adapter (la bêta distante est résiliée), `deploy.sh` corrigé (il cherchait le vhost sous le nom du domaine).
- **Installation guidée** : `infra/prod/installer.sh` (panel) et `installer-wings.sh` (machine de jeu), guide pas à pas `docs/installation.md`. Le vhost démarre sur une machine neuve (map `$gd_connection`, `tls-intermediate.conf` livré, `http2` adapté à nginx < 1.25.1) — `infra-prod.test.ts`.
- **Releases** : `release.yml` (étiquette `v*`) rejoue `ci.yml`, compile, assemble (`infra/release/assembler.sh`) et publie l'archive compilée. Côté serveur, une commande : `curl …/releases/latest/download/gamedashboard.sh | sudo bash -s -- install`. `infra/prod/app.sh` est la CLI complète et autonome (publiée `gamedashboard.sh`, installée `/usr/local/bin/gamedashboard`, appelée par les scripts `app:`) : `install`, `setup`, `update` (sauvegarde puis nouvelle version), `backup` (base + `env/` en un fichier), `start|stop|restart|status|logs`, `admin`, `password`, `wings`, `release`, `help`. Jamais de script sans préfixe portant le nom d'une commande de pnpm (`setup`, `restart`…) : pnpm lance la sienne. Le contrôle de fin de `deploy.sh` cherche `>Une erreur est survenue<` : le texte seul est dans le catalogue embarqué de chaque page.
