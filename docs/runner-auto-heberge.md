# Runner auto-hébergé

La CI (`ci.yml`) et les releases (`release.yml`) tournent sur un runner
GitHub Actions **auto-hébergé**, c'est-à-dire sur une machine à nous. GitHub
ne facture pas de minutes pour ces runners.

Les jobs demandent les étiquettes `self-hosted`, `linux` et `x64`, que tout
runner Linux x64 porte d'office. Pour viser une autre cible sans toucher aux
workflows, créez la variable de dépôt `CI_RUNNER` (Settings → Secrets and
variables → Actions → Variables). Sa valeur est du JSON :

| Valeur de `CI_RUNNER` | Effet |
|---|---|
| *(absente)* | `["self-hosted","linux","x64"]` |
| `"ubuntu-latest"` | retour aux runners hébergés par GitHub |
| `["self-hosted","linux","x64","ci"]` | seulement les runners portant en plus l'étiquette `ci` |

## Ce que la machine doit fournir

| | Pourquoi |
|---|---|
| Debian 12/13 ou Ubuntu 22.04/24.04, x64, 4 Go de RAM, 20 Go libres | le build Next.js et Storybook |
| `git`, `curl`, `tar` | checkout et installation des outils |
| **Docker**, avec l'utilisateur du runner dans le groupe `docker` | le service PostgreSQL des tests e2e, l'action Semgrep et le scan ZAP, qui sont des conteneurs (l'image de ZAP pèse 1,5 Go) |
| Les bibliothèques système de Chromium | les parcours Playwright (voir plus bas) |

Node.js, pnpm, Trivy et Chromium lui-même n'ont pas à être installés : les
workflows les posent à chaque exécution, aux versions du dépôt (`.nvmrc`,
`packageManager`).

Le port de PostgreSQL est choisi par Docker à chaque exécution : un
PostgreSQL déjà présent sur la machine garde son 5432.

## Installer

Sur la machine, en root :

```bash
apt-get update && apt-get install -y git curl tar ca-certificates
curl -fsSL https://get.docker.com | sh

useradd --create-home --shell /bin/bash runner
usermod -aG docker runner
```

Bibliothèques de Chromium, une fois pour toutes (le workflow ne peut les poser
lui-même que si l'utilisateur du runner a `sudo` sans mot de passe, ce qu'on
évite) :

```bash
apt-get install -y nodejs npm   # temporaire, pour la commande suivante
npx -y playwright install-deps chromium
```

Puis le runner lui-même. Le jeton d'enregistrement s'obtient dans
**Settings → Actions → Runners → New self-hosted runner** (il expire au bout
d'une heure) ; la page donne aussi l'archive de la dernière version et son
empreinte SHA-256, à vérifier.

```bash
sudo -iu runner
mkdir actions-runner && cd actions-runner
curl -fsSLO https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz
echo "<empreinte donnée par la page>  actions-runner-linux-x64-2.337.0.tar.gz" | sha256sum -c
tar -xzf actions-runner-linux-x64-2.337.0.tar.gz
./config.sh --url https://github.com/PowerNexus/PowerDashboard --token <JETON> --unattended
exit

cd /home/runner/actions-runner
./svc.sh install runner && ./svc.sh start
```

Le runner se met à jour tout seul ; il apparaît « Idle » dans
**Settings → Actions → Runners**.

### Sous WSL, sans systemd

`svc.sh` s'appuie sur systemd : sous WSL sans systemd, il n'installe rien.
Le runner se lance alors par `run.sh`, et WSL le démarre au boot avec Docker.
Dans `/etc/wsl.conf`, section `[boot]` (à fusionner si elle existe déjà) :

```ini
[boot]
command = service docker start; su - runner -c 'cd ~/actions-runner && nohup ./run.sh >> ~/runner.log 2>&1 &'
```

La commande s'applique au prochain démarrage de WSL. Pour la session en
cours :

```bash
sudo service docker start
sudo su - runner -c 'cd ~/actions-runner && nohup ./run.sh >> ~/runner.log 2>&1 &'
tail -f /home/runner/runner.log   # « Listening for Jobs »
```

Arrêter le runner pendant un job fait échouer ce job : attendre qu'il soit
« Idle » dans la page des runners.

### Fichiers appartenant à root dans `_work`

Une action conteneur (Semgrep) écrit en root dans l'espace de travail ; le job
d'audit les rend à l'utilisateur du runner en fin de job. Si un checkout
échoue malgré tout sur `insufficient permission for adding an object to
repository database .git/objects` (runner lancé un jour en root, job
interrompu), une fois, runner à l'arrêt :

```bash
sudo chown -R runner:runner /home/runner/actions-runner/_work
```

## Vérifier

Relancer la CI d'une PR (onglet *Checks* → *Re-run all jobs*). Les trois jobs
doivent démarrer sur la machine : `journalctl -u 'actions.runner.*' -f`
(ou `~/runner.log` sous WSL).

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
- Utilisateur `runner` sans `sudo`. Le groupe `docker` vaut root sur la
  machine : c'est une raison de plus pour la dédier.
- Toutes les actions tierces sont épinglées par empreinte de commit (voir
  l'incident `trivy-action` de mars 2026).
