# Runner auto-hébergé

La CI (`ci.yml`), les releases (`release.yml`) et les captures de référence
(`captures.yml`) tournent sur un runner GitHub Actions **auto-hébergé**,
c'est-à-dire sur une machine à nous. GitHub ne facture pas de minutes pour
ces runners.

Les jobs prennent **n'importe quel runner auto-hébergé** (étiquette
`self-hosted`), Windows ou Linux, pourvu qu'il ait Docker ; la machine
actuelle est un Windows x64. Pour viser une autre cible sans toucher aux
workflows, créez la variable de dépôt `CI_RUNNER` (Settings → Secrets and
variables → Actions → Variables). Sa valeur est du JSON :

| Valeur de `CI_RUNNER` | Effet |
|---|---|
| *(absente)* | `"self-hosted"` : le premier runner auto-hébergé libre |
| `["self-hosted","windows"]` | seulement les runners Windows |
| `"ubuntu-latest"` | retour aux runners hébergés par GitHub |

Les trois cibles marchent sans autre changement : le runner ne fait que
piloter Docker depuis bash.

## Comment un job tourne

GitHub Actions ne lance sur Windows ni `services:` ni action conteneur
(« Container operations are only supported on Linux runners »), et le projet
suppose Linux partout : scripts bash, `@node-rs/argon2` natif de l'archive
cPanel, captures de référence `-linux`. Chaque job ouvre donc **son propre
conteneur Linux** et y exécute toutes ses commandes, par
`infra/ci/linux.sh` :

1. `linux.sh ouvrir [--postgres]` crée un réseau, un volume, au besoin un
   PostgreSQL, puis le conteneur Node (image épinglée par empreinte), et y
   **copie** le dépôt. Rien n'est monté depuis le disque de Windows : un
   montage NTFS rend `pnpm install` très lent.
2. `linux.sh lancer '…'` exécute une commande dans le dépôt copié ;
   `linux.sh outil <image> …` lance Trivy ou Semgrep sur le même volume.
3. `linux.sh rapatrier <chemin>` recopie vers le runner ce qui doit en
   sortir (archive de release, captures, rapports).
4. `linux.sh fermer`, toujours exécuté, retire conteneurs, volume et réseau.

Le store pnpm, le Chromium de Playwright et le cache de build de Next restent
d'une exécution à l'autre dans les volumes Docker `gd-ci-pnpm-store`,
`gd-ci-playwright`, `gd-ci-next-cache` et `gd-ci-next-autonome-cache`
(construction de l'archive autonome). Les vider (`docker volume rm`) ne coûte
qu'un job plus lent. Le scan ZAP
(`infra/ci/zap-baseline.sh`) partage le réseau du conteneur du job.

Rien de ce qu'un job écrit en root ne reste dans `_work` : le dossier du
runner ne contient que le checkout et ce qu'on y rapatrie.

## Ce que la machine doit fournir

| | Pourquoi |
|---|---|
| Windows 10/11 ou Server 2022+, x64, 8 Go de RAM, 30 Go libres | Docker, le build Next.js et Storybook dans le conteneur |
| **Docker Desktop** (moteur WSL 2, conteneurs Linux), démarré avec la session | tous les jobs ; l'image de ZAP pèse 1,5 Go |
| **Git for Windows**, à son emplacement par défaut | `shell: bash` des workflows |
| **GitHub CLI** (`gh`) | publication des releases, commit des captures |

Node.js, pnpm, Trivy, Semgrep et Chromium n'ont pas à être installés : ils
vivent dans les conteneurs, aux versions du dépôt.

Le service du runner ne lit pas le `PATH` de la session, et le `bash` de WSL
(`C:\Windows\System32\bash.exe`) ne voit ni `docker.exe` ni les chemins du
runner. La première étape de chaque job, en PowerShell, cherche donc le bash
de Git for Windows (`C:\Program Files\Git\bin`, puis l'installation par
utilisateur) et `docker.exe` (`C:\Program Files\Docker\Docker\resources\bin`),
et les place en tête du `PATH` des étapes suivantes. Si l'un manque, le job
s'arrête là et le dit.

Les workflows posent `core.autocrlf false` avant le checkout, et
`.gitattributes` impose LF : un script bash en CRLF casserait dans le
conteneur.

## Installer

Dans un PowerShell administrateur :

```powershell
winget install --id Docker.DockerDesktop -e
winget install --id Git.Git -e
winget install --id GitHub.cli -e
```

Dans Docker Desktop : **Settings → General → Start Docker Desktop when you
sign in**, et le moteur WSL 2 (par défaut). Vérifier :
`docker run --rm hello-world`.

Puis le runner lui-même. Le jeton d'enregistrement s'obtient dans
**Settings → Actions → Runners → New self-hosted runner** (choisir Windows ;
il expire au bout d'une heure). La page donne l'archive de la dernière
version et son empreinte SHA-256, à vérifier :

```powershell
mkdir C:\actions-runner; cd C:\actions-runner
Invoke-WebRequest -Uri <archive donnée par la page> -OutFile runner.zip
(Get-FileHash runner.zip -Algorithm SHA256).Hash   # comparer à la page
Expand-Archive runner.zip -DestinationPath .
./config.cmd --url https://github.com/PowerNexus/PowerDashboard --token <JETON> --unattended --runasservice
```

Le service doit tourner sous un compte qui a accès à Docker Desktop, c'est-à-dire
membre du groupe local `docker-users` ; sinon chaque job s'arrête sur
« permission denied while trying to connect to the docker API ». Dans un
PowerShell administrateur, avec le compte du service (`svc-gh-runner` sur la
machine actuelle) :

```powershell
Add-LocalGroupMember -Group docker-users -Member svc-gh-runner
Get-Service actions.runner.* | Restart-Service
```

Docker Desktop doit tourner (démarré avec la session). Le runner se met à jour tout seul ; il apparaît « Idle »
dans **Settings → Actions → Runners**.

Arrêter le runner pendant un job fait échouer ce job : attendre qu'il soit
« Idle » dans la page des runners. Un job coupé net peut laisser un
conteneur `gd-ci-…` : `docker ps -a --filter name=gd-ci-` les montre, et
`docker rm -f` puis `docker volume prune` les retirent.

### Veille de Docker Desktop

Entre deux jobs, Docker ne doit rien garder d'actif : chaque job retire ses
conteneurs, même en échec (`linux.sh fermer`), et le suivant retire ceux
qu'un job tué net aurait laissés depuis plus de deux heures (`linux.sh
balayer`, conteneurs marqués `gd-ci`). Il reste à laisser Docker Desktop
arrêter sa machine virtuelle quand plus rien ne tourne : **Settings →
Resources → Advanced → Resource Saver**, activé, délai de 5 minutes. La
machine virtuelle est alors arrêtée, sa mémoire rendue à Windows, et elle
redémarre d'elle-même à la première commande `docker` du job suivant (quelques
secondes de plus au démarrage). Les caches (volumes `gd-ci-pnpm-store`,
`gd-ci-playwright`, `gd-ci-next-*`) et les images survivent à la veille.

### Mémoire de Docker Desktop

Le build de Next.js et les tests tournent dans la machine virtuelle WSL 2 de
Docker Desktop, qui ne reçoit par défaut que la moitié de la mémoire de
Windows. Une commande tuée en « code 137 » en manque : le job le dit et
donne la mémoire vue par Docker. Pour en donner davantage (8 Go au moins),
dans `%UserProfile%\.wslconfig` du compte qui lance Docker Desktop :

```ini
[wsl2]
memory=12GB
swap=8GB
```

puis `wsl --shutdown` et relancer Docker Desktop.

## Vérifier

Relancer la CI d'une PR (onglet *Checks* → *Re-run all jobs*). Les trois jobs
doivent démarrer sur la machine ; `docker ps --filter name=gd-ci-` montre
leurs conteneurs pendant qu'ils tournent.

## Sécurité

Un runner auto-hébergé exécute le code de la branche testée **avec les droits
de son utilisateur**, sur notre réseau.

- `ci.yml` ne lance aucun job pour une PR venue d'un fork : sur un dépôt
  public, n'importe qui pourrait sinon faire tourner son code sur la machine.
  Ce filtre est vérifié par `apps/api/src/common/infra-prod.test.ts`.
- Si le dépôt devient public, activer aussi **Settings → Actions → General →
  Require approval for all outside collaborators**.
- Machine dédiée : jamais la production, jamais une machine Wings. Aucun secret
  de production dans son environnement.
- Accès à Docker vaut administrateur de la machine : c'est une raison de plus
  pour la dédier.
- Toutes les actions tierces et toutes les images sont épinglées par
  empreinte (voir l'incident `trivy-action` de mars 2026) : images dans
  `infra/ci/linux.sh`, `infra/ci/outils.env` et `infra/ci/zap-baseline.sh`.
