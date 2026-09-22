# Environnement de développement

```bash
docker compose -f infra/docker/compose.dev.yml up -d
```

## Le démon Docker ne redémarre pas tout seul

La distribution WSL **Codiax tourne sans systemd**, donc rien ne relance
`dockerd` à l'ouverture d'une session. Après un redémarrage de WSL, le premier
`docker` échouera avec « Cannot connect to the Docker daemon ». Il faut le
relancer :

```bash
sudo service docker start
```

Pour que ce soit automatique, il faudrait activer systemd en ajoutant
`[boot]\nsystemd=true` à `/etc/wsl.conf`, puis `wsl --shutdown` côté Windows.
Ce n'est pas fait ici, et délibérément : l'arrêt de WSL tuerait le serveur de
développement en cours. C'est un choix à faire à un moment où rien ne tourne.

Docker Engine vient du dépôt officiel Docker (`download.docker.com`) et non du
paquet Ubuntu : c'est ici la couche d'isolation, sa version compte. La clé du
dépôt est dans `/etc/apt/keyrings/docker.asc`, empreinte
`9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`.

| Service | Adresse | Identifiants |
|---|---|---|
| PostgreSQL 17 | `localhost:5432` | `gamedashboard` / `gamedashboard`, base `gamedashboard` |
| Redis 8 | `localhost:6379` | — |
| MinIO (S3) | `localhost:9000`, console `:9001` | `gamedashboard` / `gamedashboard-dev-secret` |
| Mailpit | SMTP `:1025`, interface `:8025` | — |

Tous les ports sont liés à `127.0.0.1` et non à `0.0.0.0` : une base de
développement sans mot de passe sérieux ne doit pas être joignable depuis le
réseau local, ni depuis un réseau public si la machine s'y trouve.

Ensuite, dans `apps/*/.env.local` :

```
DATABASE_URL=postgres://gamedashboard:gamedashboard@localhost:5432/gamedashboard
REDIS_URL=redis://localhost:6379
```

Puis appliquer le schéma :

```bash
pnpm --filter @gamedashboard/db db:migrate
```

## Pourquoi le panel n'est pas dans ce fichier

`web`, `api` et `worker` tournent sur la machine via `pnpm dev`. Le
rechargement à chaud à travers un montage de volume est lent et peu fiable, et
déboguer un processus conteneurisé coûte plus qu'il ne rapporte en
développement. Le compose ne fournit que ce qu'on ne souhaite pas installer sur
son poste.

## Le daemon Wings

Déclaré dans le profil `daemon`, inactif par défaut. **Il faut d'abord que
l'API tourne** : Wings l'interroge dès son démarrage et s'arrête sinon.

```bash
pnpm --filter @gamedashboard/api dev          # API sur :3201
docker compose -f infra/docker/compose.dev.yml --profile daemon up -d wings
docker compose -f infra/docker/compose.dev.yml logs -f wings
```

Il lui faut `infra/docker/wings/config.yml`, qui porte le jeton du node et
n'est donc pas versionné. Il se télécharge depuis `/admin/nodes` une fois le
node créé ; en attendant, on l'écrit à la main avec un jeton dont le condensat
SHA-256 est inscrit dans `nodes.daemon_token_enc`.

### Trois réglages appris en le branchant pour de vrai

**`remote: http://host.docker.internal:3201`.** L'API tourne sur la machine et
non dans le compose ; le service déclare `extra_hosts: host-gateway` pour que
ce nom résolve sur Docker Linux.

**Le sous-réseau doit être choisi.** Wings crée son interface en 172.18.0.0/16
par défaut, déjà prise par le réseau du compose : Docker refuse alors avec
« Pool overlaps with other one on this address space ». La configuration fixe
172.22.0.0/16.

**`config.yml` n'est pas monté en lecture seule.** Wings normalise sa
configuration au démarrage et la réécrit ; en `:ro` il s'arrête sur « failed to
write configuration to disk ». Le fichier est donc une copie de travail que le
daemon modifie, pas une source de vérité.

### Accès au socket Docker

Wings reçoit le socket Docker de l'hôte : c'est un accès équivalent à root sur
la machine. Acceptable sur un poste de développement, jamais sur un hôte
partagé.
