# Production sous systemd

Modèle de déploiement du panel sur un serveur Linux : deux processus sous
systemd, un vhost nginx, une base dédiée sur un PostgreSQL existant. La seule
installation en service aujourd'hui est la production locale
(`https://gamedashboard.local`, voir [`infra/local`](../local/README.md)). Ce
dossier en est la version pour une vraie machine, et ce qui la distingue du
local y est écrit.

`panel.example.fr` est un nom d'exemple. Avant le premier passage, le
remplacer dans `deploy.sh` (`DOMAIN`) et dans `panel.conf` (`server_name`,
journaux, chemin du certificat).

| | |
|---|---|
| Interface | `gamedashboard-web.service`, Next sur `127.0.0.1:3210` |
| API | `gamedashboard-api.service`, Nest sur `127.0.0.1:3211` |
| Code | `/opt/gamedashboard/app` |
| Secrets | `/opt/gamedashboard/env/{api,web}.env`, `root:gamedashboard 640` |
| Base | rôle et base `gamedashboard` sur le PostgreSQL de la machine |
| Certificat | émis et renouvelé par certbot, hors de ce dépôt |
| Certificats des revendeurs | `certificates.sh`, sous `gamedashboard-certificates.timer` |

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
unités et recharge nginx, puis contrôle que les pages répondent vraiment. Il
ne régénère **jamais** un secret existant : un `APP_SECRET_KEY` régénéré rendrait
illisibles tous les secrets chiffrés en base (voir le runbook
[clé maître des secrets](../../docs/runbooks/cle-maitre-secrets.md)).

## Ce que la machine expose, et ce qu'elle n'expose pas

Trois règles ont guidé l'installation. Elles valent d'autant plus que la
machine sert d'autres sites.

**Les deux processus n'écoutent que la boucle locale.** `HOST=127.0.0.1` pour
l'API, `--hostname 127.0.0.1` pour Next. Le défaut de l'API est `0.0.0.0`,
correct en conteneur et faux sur un hôte public : les routes d'administration
seraient joignables sur l'adresse publique, sans passer par le proxy, pare-feu
actif ou non.

**nginx ne relaie vers l'API que ce qui doit sortir** : `/api/v1/application/`
pour le système de facturation tiers, `/api/remote/` pour les daemons Wings,
et `/api/v1/status` pour une supervision. Tout le reste de l'API — client,
revendeur, administration — n'est appelé que par l'interface, depuis la
machine. Demandé de l'extérieur, `/api/v1/admin/...` tombe sur Next, qui
répond 404.

**L'interface n'a ni `DATABASE_URL` ni `APP_SECRET_KEY`.** Son fichier
d'environnement ne les contient pas : elle lit tout par l'API avec le cookie de
l'utilisateur. Une faille de rendu ne donne pas la base.

**Tout est additif.** Un utilisateur système, une base, deux unités, un vhost :
rien d'existant n'est modifié, et `nginx -t` précède chaque rechargement. Le
code de refus des limitations (`limit_req_status`) est posé dans le bloc
`server` et non au niveau `http`, où il entrerait en conflit avec un autre
vhost qui le déclarerait déjà.

## Premier administrateur

```bash
cd /opt/gamedashboard/app
set -a; . /opt/gamedashboard/env/api.env; set +a
/opt/gamedashboard/bin/pnpm --filter @gamedashboard/api exec tsx scripts/create-admin.mts \
  <email> <prénom> <nom>
```

Le mot de passe est tiré au sort et affiché une seule fois. Le script ne touche
à rien si l'adresse existe déjà.

## Certificats des domaines de revendeurs

Le panel vérifie qu'un revendeur possède son domaine, mais ne peut pas lui
délivrer de TLS : il faut le serveur web et les droits de root.
`certificates.sh` fait le pont. Il demande au panel quels domaines attendent
un certificat, les obtient par certbot et rend compte de chaque tentative.
`deploy.sh` ne l'installe pas, parce qu'il demande une clé qu'un humain doit
émettre :

1. émettre depuis `/admin/api` une clé applicative portant la **seule** portée
   `domains.certificates` ;
2. la déposer dans `/opt/gamedashboard/env/.certificates-key`, `root:root 600` ;
3. installer et activer le minuteur :
   ```bash
   install -m 644 infra/prod/gamedashboard-certificates.{service,timer} /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now gamedashboard-certificates.timer
   ```

Le premier essai se fait avec `certificates.sh --staging --dry-run`.

## Journaux

```bash
journalctl -u gamedashboard-api -f
journalctl -u gamedashboard-web -f
journalctl -u gamedashboard-certificates
```

## Exploitation

Les procédures d'incident sont dans [`docs/runbooks`](../../docs/runbooks/README.md) :
rotation du jeton d'un node, machine injoignable, clé maître des secrets.

## Points ouverts

- **L'API tourne sous `tsx`**, sans étape de compilation : ce dépôt n'en a pas.
  Une sortie compilée démarrerait plus vite et n'embarquerait pas le
  compilateur en production.
- **`CURSEFORGE_API_KEY` est vide** dans `api.env` à la création : la recherche
  CurseForge du catalogue répond 403 tant qu'une clé n'y est pas mise. Modrinth
  fonctionne sans clé.
- **Le relais `pnpm`** (`/opt/gamedashboard/bin/pnpm`) existe parce que turbo
  relance `pnpm` dans chaque paquet et trouverait sinon le pnpm global de la
  machine, qui refuse de tourner sur un projet épinglé à une autre version.
