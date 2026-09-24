# Héberger le panel sur un hébergement cPanel

Pour un hébergement mutualisé sous cPanel qui propose **« Setup Node.js
App »** (CloudLinux et Passenger), **PostgreSQL** et les **tâches cron**. Sur
un serveur à soi, préférer l'installation guidée ([installation.md](./installation.md)) :
nginx et systemd y font mieux ce que ce guide contourne (voir *Limites*).

Rien ne se construit sur l'hébergement : il n'a ni la mémoire ni le temps que
demande `next build`. Le runner construit le panel après chaque CI verte sur
`main` et pousse la construction sur la branche **`deploiement`** du dépôt
(`.github/workflows/deploiement.yml`, `infra/cpanel/publier-construction.sh`).
Sur l'hébergement, une tâche cron la récupère avec git
(`infra/cpanel/deployer.sh`).

La branche ne porte qu'un commit, sans parent, remplacé à chaque
publication : le code suivi, l'interface compilée et un fichier `RELEASE`
qui nomme le commit de `main` d'origine. Elle ne s'empile pas : le dépôt ne
grossit pas d'une interface compilée à chaque publication.

```
visiteurs, Wings, facturation
        │  https://<domaine>
        ▼
Apache ─► Passenger ─► interface (Next) ──► https://api.<domaine>
                                              │
                               Apache ─► Passenger ─► API (NestJS) ─► PostgreSQL
```

Deux applications Node.js, chacune sur son nom. L'adresse du panel ne sert
que l'interface : les appels de Wings (`/api/remote/…`, `/api/application/…`)
et ceux de la facturation (`/api/v1/application/…`) y sont **relayés** vers
l'API par Next (`apps/web/src/server/api-relay.ts`), exactement pour les
chemins que nginx aiguille en production. Wings reste inchangé.

Sur l'hébergement, tout vit hors de `public_html` :

```
~/gamedashboard/
  depot/                     le clone de la branche deploiement
  env/api.env, env/web.env   réglages et secrets (0600)
  versions/<id>/             les constructions extraites
  actuelle -> versions/<id>  la version en service
  passenger/api/             racine d'application de l'API
  passenger/interface/       racine d'application de l'interface
  journal/                   journal des mises à jour
```

## 1. Base PostgreSQL

cPanel › **Bases de données PostgreSQL** : créer une base, un utilisateur avec
un mot de passe long, et donner à l'utilisateur tous les droits sur la base.
cPanel préfixe les deux noms par celui du compte (`compte_gamedashboard`).

## 2. Domaines

- **Le domaine du panel.** Sa racine de documents (souvent `public_html`)
  doit être **vide** : Passenger sert tel quel tout fichier qui s'y trouve,
  avant de passer la main à l'application. Un ancien clone du dépôt, dossier
  `.git` compris, y serait public. L'effacer par le gestionnaire de fichiers
  (fichiers cachés affichés) ; *Supprimer* dans « Git Version Control » ne
  retire que le suivi, pas les fichiers.
- **Un sous-domaine pour l'API**, `api.<domaine>` : cPanel › **Domaines** ›
  Créer.
- **HTTPS pour les deux** : cPanel › **SSL/TLS Status** › AutoSSL, puis
  « Forcer la redirection HTTPS » dans **Domaines**.

## 3. Réglages

Dans le gestionnaire de fichiers (ou le Terminal de cPanel), créer
`~/gamedashboard/env/` et y poser deux fichiers, **permissions 0600** :

`api.env`

```bash
DATABASE_URL=postgres://compte_gd:<mot de passe>@localhost:5432/compte_gamedashboard
APP_SECRET_KEY=<voir ci-dessous>
PANEL_ORIGIN=https://<domaine>
# L'adresse IP du serveur : cPanel l'affiche dans la colonne « Informations
# générales » (adresse IP partagée). Voir « Limites ».
TRUSTED_PROXIES=127.0.0.1, ::1, <adresse IP du serveur>
```

`web.env`

```bash
API_URL=https://api.<domaine>
PANEL_ORIGIN=https://<domaine>
```

`APP_SECRET_KEY` chiffre les secrets rangés en base : la tirer sur son propre
poste (`openssl rand -base64 48`, 32 caractères au moins) et **en garder une
copie hors de l'hébergement**. Sans elle, une sauvegarde de la base ne se
relit pas ([runbook de la clé maître](./runbooks/cle-maitre-secrets.md)). Les autres
variables facultatives sont décrites dans `apps/api/.env.example`.

Les réglages vivent dans ces fichiers, pas dans l'écran « Setup Node.js
App » : cPanel garde ses variables en clair dans ses propres réglages. Une
variable posée dans l'écran l'emporte sur le fichier.

## 4. Première installation

**Le clone, dans « Git Version Control »** (facultatif : sans lui, le script
clone lui-même) : *Create*, avec

| | |
|---|---|
| Clone a Repository | activé |
| Clone URL | `https://github.com/PowerNexus/PowerDashboard.git` |
| Repository Path | `gamedashboard/depot` |
| Repository Name | `GameDashboard` |

cPanel clone `main` ; le script passe le clone sur `deploiement` et l'y
tient. Ne pas le cloner dans `public_html`.

**L'installation**, dans le **Terminal** de cPanel (Avancé › Terminal) :

```bash
curl -fsSL https://raw.githubusercontent.com/PowerNexus/PowerDashboard/deploiement/infra/cpanel/deployer.sh | bash
```

Il récupère la branche, en extrait la construction dans un dossier neuf,
installe les dépendances aux versions du lockfile (quelques minutes), joue
les migrations, puis pose `actuelle` et les deux racines d'application. Sans
Terminal : la même commande en tâche cron « une fois par minute », le temps
d'un passage, puis retirer la tâche.

Node 24 est cherché sous `/opt/alt/alt-nodejs24` ; ailleurs, le désigner par
`GAMEDASHBOARD_NODE=/chemin/vers/bin`.

## 5. Applications Node.js

cPanel › **Setup Node.js App** › *Create Application*, deux fois :

| | API | Interface |
|---|---|---|
| Node.js version | 24 | 24 |
| Application mode | Production | Production |
| Application root | `gamedashboard/passenger/api` | `gamedashboard/passenger/interface` |
| Application URL | `api.<domaine>` | `<domaine>` |
| Application startup file | `app.cjs` | `app.cjs` |

Aucune variable d'environnement dans cet écran (étape 3), et **jamais**
« Run NPM Install » : les dépendances sont celles du lockfile, posées par
`deployer.sh` avec pnpm. Si l'écran propose un « Passenger log file », y
mettre `gamedashboard/journal/api.log` et `…/interface.log` : c'est là que
s'écrit une erreur de démarrage.

## 6. Tâches cron

cPanel › **Tâches cron** :

```bash
# Mise à jour : ne fait rien tant que rien de neuf n'est publié.
*/5 * * * * bash $HOME/gamedashboard/actuelle/infra/cpanel/deployer.sh >> $HOME/gamedashboard/journal/deployer.log 2>&1

# Maintien en éveil : la sonde de l'interface interroge l'API.
* * * * * curl -fsS -o /dev/null --max-time 20 https://<domaine>/api/health
```

La seconde est **indispensable**. Passenger arrête une application restée
quelques minutes sans requête, et avec l'API s'arrêteraient le planificateur,
la surveillance des machines, les webhooks et les relevés.

## 7. Premier compte administrateur

Dans le Terminal :

```bash
export PATH=/opt/alt/alt-nodejs24/root/usr/bin:$PATH
cd ~/gamedashboard/actuelle/apps/api
DATABASE_URL="$(node -e 'process.loadEnvFile(process.argv[1]); process.stdout.write(process.env.DATABASE_URL)' ~/gamedashboard/env/api.env)" \
  node_modules/.bin/tsx scripts/create-admin.mts vous@exemple.fr Prénom Nom
```

## 8. Machines de jeu

Comme ailleurs ([installation.md](./installation.md)) : Wings s'adresse à
`https://<domaine>`, que l'interface relaie vers l'API.

**Le panel doit pouvoir joindre chaque Wings** (port 8080 par défaut, ou
celui déclaré pour le node). Beaucoup d'hébergements mutualisés filtrent les
connexions sortantes : si les nodes restent « injoignables » alors que Wings
tourne, demander l'ouverture du port à l'hébergeur, ou faire écouter Wings
sur 443.

## Vérifier

```bash
curl -s https://<domaine>/api/health                  # {"status":"ok"}
curl -s https://<domaine>/api/v1/status | head -c 80  # le statut, relayé
curl -s -o /dev/null -w '%{http_code}\n' https://<domaine>/api/remote/servers   # 403 : l'API répond, sans jeton
```

Puis, connecté : Compte › Sécurité › Sessions actives doit montrer **votre**
adresse, pas celle du serveur. Sinon, `TRUSTED_PROXIES` ne contient pas la
bonne adresse, et tous les visiteurs partageraient un seul compteur de
tentatives de connexion.

## Revenir en arrière

Les deux versions précédentes restent dans `versions/` :

```bash
cd ~/gamedashboard
ls -t versions/
ln -sfn versions/<id> .actuelle.nouvelle && mv -Tf .actuelle.nouvelle actuelle
touch passenger/api/tmp/restart.txt passenger/interface/tmp/restart.txt
```

Les migrations, elles, ne se défont pas : ne revenir en arrière que sur une
version dont le schéma est compatible. Le prochain passage du cron
réinstallera la construction publiée ; suspendre la tâche le temps de
corriger.

## Sauvegarder

`gamedashboard backup` n'existe pas ici. Deux choses à mettre à l'abri,
ensemble : la base (cPanel › **Sauvegarde**, ou `pg_dump` dans le Terminal)
et `~/gamedashboard/env/`, qui porte `APP_SECRET_KEY`.

## Limites

Ce qu'un serveur à soi fait et qu'un hébergement mutualisé ne fait pas :

- **L'API a une adresse publique.** `api.<domaine>` répond à tout Internet ;
  en production, nginx ne laisse sortir que les préfixes publics. Toutes les
  routes restent authentifiées. Pour la fermer, ajouter au `.htaccess` de la
  racine du sous-domaine, hors du bloc que gère CloudLinux :
  `Require ip <adresse IP du serveur>`. Vérifier ensuite qu'un appel depuis
  l'extérieur reçoit 403, et que le panel fonctionne toujours : si la
  machine sort par une autre adresse, l'interface ne joindrait plus l'API.
- **Pas de limitation de débit en amont.** Les zones `limit_req` de
  `infra/prod/panel.conf` n'existent pas ici. Restent celles de l'API :
  tentatives de connexion, réinitialisations, envois de courriel.
- **Les voisins partagent l'adresse du serveur.** Elle figure dans
  `TRUSTED_PROXIES` : un autre compte de la même machine peut appeler l'API
  en se donnant une fausse adresse. Cela fausse un compteur par adresse ou
  une adresse affichée, jamais un droit.
- **Un seul processus par application.** Passenger n'en démarre qu'un pour
  une application Node, qui traite les requêtes en parallèle ; les tâches de
  fond de l'API le supposent. Ne pas régler plusieurs instances.
- **Pas d'en-tête HSTS.** nginx le pose en production. L'ajouter au
  `.htaccess` du domaine du panel :
  `Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"`.
- **Mémoire bornée.** L'hébergement limite la mémoire du compte : un panel
  qui renvoie des erreurs 503 sous charge s'y heurte peut-être.
