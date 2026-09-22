# Bêta publique — panel.example.fr

Deux processus sous systemd, un vhost nginx, une base dédiée sur le PostgreSQL
déjà présent.

| | |
|---|---|
| Interface | `gamedashboard-web.service`, Next sur `127.0.0.1:3210` |
| API | `gamedashboard-api.service`, Nest sur `127.0.0.1:3211` |
| Code | `/opt/gamedashboard/app` |
| Secrets | `/opt/gamedashboard/env/{api,web}.env`, `root:gamedashboard 640` |
| Base | rôle et base `gamedashboard` sur PostgreSQL 18 |
| Certificat | générique `*.matheol.fr`, déjà renouvelé par certbot |

## Livrer une nouvelle version

Depuis le poste de développement :

```bash
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .turbo \
  --exclude .env --exclude .env.local \
  ./ prod:/opt/gamedashboard/app/
ssh prod bash /opt/gamedashboard/app/infra/prod/deploy.sh
```

`deploy.sh` est rejouable : il installe, construit, migre, réinstalle les
unités et recharge nginx. Il ne régénère aucun secret existant.

## Ce que la machine expose, et ce qu'elle n'expose pas

Le serveur est partagé : messagerie, autres sites, autres bases. Trois règles
ont guidé l'installation.

**Les deux processus n'écoutent que la boucle locale.** `HOST=127.0.0.1` pour
l'API, `--hostname 127.0.0.1` pour Next. Le défaut de l'API était `0.0.0.0`,
correct en conteneur et faux à même un hôte public : les routes
d'administration auraient été joignables sur l'adresse publique, sans passer
par le proxy. Le pare-feu n'y est pour rien — il est inactif sur cette machine.

**nginx ne relaie vers l'API que ce qui doit sortir** : `/api/v1/application/`
pour le système de facturation tiers, `/api/remote/` pour les daemons Wings,
et `/api/v1/status` pour une supervision. Tout le reste de l'API — client,
revendeur, administration — n'est appelé que par l'interface, depuis la
machine. Demandé de l'extérieur, `/api/v1/admin/...` tombe sur Next, qui
répond 404.

**L'interface n'a ni `DATABASE_URL` ni `APP_SECRET_KEY`.** Son fichier
d'environnement ne les contient pas : elle lit tout par l'API avec le cookie de
l'utilisateur. Une faille de rendu ne donne pas la base.

## Premier administrateur

```bash
cd /opt/gamedashboard/app
set -a; . /opt/gamedashboard/env/api.env; set +a
/opt/gamedashboard/bin/pnpm --filter @gamedashboard/api exec tsx scripts/create-admin.mts \
  <email> <prénom> <nom>
```

Le mot de passe est tiré au sort et affiché une seule fois. Le script ne touche
à rien si l'adresse existe déjà.

## Journaux

```bash
journalctl -u gamedashboard-api -f
journalctl -u gamedashboard-web -f
```

## Points restés ouverts

- **L'API tourne sous `tsx`**, sans étape de compilation : ce dépôt n'en a pas.
  Acceptable pour une bêta, à remplacer avant d'y mettre de vrais clients.
- **`CURSEFORGE_API_KEY` est vide** dans `web.env` : la recherche CurseForge du
  catalogue répondra 403 tant qu'une clé n'y est pas mise. Modrinth, lui,
  fonctionne sans clé.
- **Le relais `pnpm`** (`/opt/gamedashboard/bin/pnpm`) existe parce que turbo
  relance `pnpm` dans chaque paquet et trouverait sinon le pnpm global de la
  machine, qui refuse de tourner sur un projet épinglé à une autre version.
