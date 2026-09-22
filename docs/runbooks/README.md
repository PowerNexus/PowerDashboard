# Runbooks

Procédures d'exploitation, à suivre telles qu'écrites le jour où il faut agir.
Chaque runbook dit **quand** il s'applique, **ce qu'on risque**, les gestes
dans l'ordre, et comment vérifier que c'est terminé.

| Runbook | Quand |
|---|---|
| [Rotation du jeton de node](./rotation-jeton-node.md) | Rotation planifiée, fuite suspectée, node perdu après une rotation |
| [Clé maître des secrets](./cle-maitre-secrets.md) | Rotation de `APP_SECRET_KEY`, sel de dérivation changé, clé perdue |

L'installation et l'exploitation courante sont décrites à côté de
l'infrastructure :

- [`infra/local/README.md`](../../infra/local/README.md) : la production
  locale sur Codiax (`https://gamedashboard.local`), le script `panel`, les
  dix bancs `verifier-*.sh` qui éprouvent le contrat Wings ;
- [`infra/prod/README.md`](../../infra/prod/README.md) : les unités systemd,
  `deploy.sh`, le relais nginx et le premier administrateur.

## Chemins communs

La production locale et `infra/prod` partagent la même arborescence :

| | |
|---|---|
| Code | `/opt/gamedashboard/app` |
| Environnement de l'API | `/opt/gamedashboard/env/api.env` |
| Configuration d'un daemon | `/etc/pterodactyl/config.yml`, sur la machine |

Pour lancer un script de l'API avec l'environnement de production :

```bash
cd /opt/gamedashboard/app
set -a; . /opt/gamedashboard/env/api.env; set +a
pnpm --filter @gamedashboard/api exec tsx scripts/<script>.mts
```

Sous `infra/prod`, `pnpm` est le relais `/opt/gamedashboard/bin/pnpm` (voir
son README).
