#!/usr/bin/env bash
#
# La ligne de commande de GameDashboard, derrière les scripts `app:` du
# package.json :
#
#   pnpm app:install          vérifie Node.js et pnpm, installe les dépendances
#   pnpm app:setup            installation guidée ; relancée, met à jour
#   pnpm app:start            démarre le panel et attend qu'il réponde
#   pnpm app:stop             l'arrête (les serveurs de jeu continuent)
#   pnpm app:restart          le redémarre
#   pnpm app:status           état des services, adresse, version
#   pnpm app:logs [api|web]   journaux en direct
#   pnpm app:admin <email> <prénom> <nom>   crée un administrateur
#   pnpm app:password <email>               tire un nouveau mot de passe
#   pnpm app:wings            prépare cette machine à faire tourner des jeux
#   pnpm app:release <vX.Y.Z> assemble une archive publiable (mainteneurs)
#   pnpm app:help             cette liste
#
# Pourquoi un préfixe : pnpm a ses propres commandes, et elles passent avant
# les scripts du projet. `pnpm setup` règle le dossier global de pnpm et
# modifie le .bashrc sans jamais lancer notre installation ; `pnpm restart`
# enchaîne des scripts plutôt que d'en lancer un. Sous `app:`, aucun nom ne
# peut être capté ainsi, et `pnpm app:` suivi de Tab les liste toutes.
#
# Le panel tourne sous systemd, depuis /opt/gamedashboard/app, quel que soit
# le dossier d'où l'on tape la commande. Ce qui demande les droits de root
# se relance tout seul par sudo.
set -euo pipefail
# Les dossiers système sont ajoutés **après** le PATH de l'utilisateur, pas
# avant : devant, ils masquaient un Node installé par nvm ou fnm, et
# app:install jugeait la version du système au lieu de celle qu'il utilise.
export PATH=$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RACINE=$(cd "$ICI/../.." && pwd)
INSTALLE=/opt/gamedashboard
SERVICES=(gamedashboard-api gamedashboard-web)
NODE_MIN=24

ACTION=${1:-help}
shift || true

if [ -t 1 ]; then G=$'\033[1m' V=$'\033[32m' R=$'\033[31m' Z=$'\033[0m'; else G='' V='' R='' Z=''; fi
echec() { printf '%s✘ %s%s\n' "$R" "$1" "$Z" >&2; shift; for l in "$@"; do printf '  %s\n' "$l" >&2; done; exit 1; }

aide() {
  cat <<EOF
${G}GameDashboard — commandes${Z}

  Installer
    pnpm app:install            vérifie Node.js et pnpm, installe les dépendances
    pnpm app:setup              installation guidée ; relancée, met à jour
    pnpm app:wings              prépare cette machine à faire tourner des jeux (Wings)

  Au quotidien
    pnpm app:start              démarre le panel
    pnpm app:stop               l'arrête (les serveurs de jeu continuent)
    pnpm app:restart            le redémarre
    pnpm app:status             état, adresse et version
    pnpm app:logs [api|web]     journaux en direct (Ctrl+C pour sortir)

  Comptes
    pnpm app:admin <email> <prénom> <nom>   crée un administrateur
    pnpm app:password <email>               tire un nouveau mot de passe

  Mainteneurs
    pnpm app:release <vX.Y.Z>   assemble une archive publiable, après pnpm build

  Guide complet : docs/installation.md
EOF
}

# Ce qui touche au panel installé : il faut qu'il existe, et être root.
exige_installation() {
  [ -f /etc/systemd/system/gamedashboard-api.service ] \
    || echec "Le panel n'est pas encore installé sur cette machine." "Lancer d'abord : pnpm app:setup   (voir docs/installation.md)"
}
exige_root() {
  if [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null 2>&1 || echec "Il faut les droits de root, et sudo est absent." "Se connecter en root, puis relancer."
    exec sudo bash "${BASH_SOURCE[0]}" "$ACTION" "$@"
  fi
}

origine() { sed -n 's/^PANEL_ORIGIN=//p' "$INSTALLE/env/api.env" 2>/dev/null | head -n 1; }

# `systemctl start` rend la main dès que le processus est lancé, pas quand il
# répond : on attend l'écoute effective, comme deploy.sh.
attend() {
  local port=$1 nom=$2 _
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
      printf '  %s✔%s %s répond\n' "$V" "$Z" "$nom"
      return 0
    fi
    sleep 1
  done
  printf '  %s✘%s %s ne répond toujours pas après 60 s — pnpm app:logs %s\n' "$R" "$Z" "$nom" "$nom"
  return 1
}

demarrer() {
  systemctl enable --now "${SERVICES[@]}" >/dev/null 2>&1
  echo "Démarrage…"
  local ok=0
  attend 3211 api || ok=1
  attend 3210 web || ok=1
  if [ "$ok" = 0 ]; then printf '\n%sLe panel est en ligne : %s%s\n' "$G" "$(origine)" "$Z"; fi
  return "$ok"
}

# Un script de l'API, lancé sur la base du panel installé. Seule l'adresse de
# la base lui est transmise : la clé de chiffrement n'a rien à y faire.
script_api() {
  local script=$1
  shift
  cd "$INSTALLE/app/apps/api"
  DATABASE_URL="$(grep '^DATABASE_URL=' "$INSTALLE/env/api.env" | cut -d= -f2-)" \
    ./node_modules/.bin/tsx "scripts/$script" "$@"
}

case $ACTION in
  install)
    command -v node >/dev/null 2>&1 \
      || echec "Node.js est absent." "Voir docs/installation.md, étape 4.2."
    MAJEUR=$(node -p 'process.versions.node.split(".")[0]')
    [ "$MAJEUR" -ge "$NODE_MIN" ] \
      || echec "Node.js $(node -v) est trop ancien : il faut la version $NODE_MIN ou plus." "Voir docs/installation.md, étape 4.2."
    printf '  %s✔%s Node.js %s, pnpm %s\n' "$V" "$Z" "$(node -v)" "$(pnpm -v)"
    cd "$RACINE"
    pnpm install --frozen-lockfile
    printf '\n%sDépendances installées.%s Suite : pnpm app:setup\n' "$G" "$Z"
    ;;

  setup)
    # installer.sh demande lui-même les droits, et garde ses options.
    exec bash "$ICI/installer.sh" "$@"
    ;;

  wings)
    exec bash "$ICI/installer-wings.sh" "$@"
    ;;

  release)
    exec bash "$RACINE/infra/release/assembler.sh" "$@"
    ;;

  start)
    exige_installation
    exige_root "$@"
    demarrer
    ;;

  stop)
    exige_installation
    exige_root "$@"
    systemctl stop "${SERVICES[@]}"
    echo "Panel arrêté. Les serveurs de jeu, eux, continuent de tourner sur les nodes."
    ;;

  restart)
    exige_installation
    exige_root "$@"
    systemctl stop "${SERVICES[@]}"
    demarrer
    ;;

  status)
    exige_installation
    exige_root "$@"
    for s in "${SERVICES[@]}"; do
      if systemctl is-active --quiet "$s"; then
        printf '  %s●%s %-20s en marche depuis %s\n' "$V" "$Z" "$s" \
          "$(systemctl show -p ActiveEnterTimestamp --value "$s")"
      else
        printf '  %s●%s %-20s %s\n' "$R" "$Z" "$s" "$(systemctl is-active "$s" || true)"
      fi
    done
    printf '  Adresse : %s\n' "$(origine)"
    if [ -f "$INSTALLE/app/RELEASE" ]; then
      printf '  Version : %s\n' "$(sed -n 's/^version=//p' "$INSTALLE/app/RELEASE")"
    fi
    ;;

  logs)
    exige_installation
    exige_root "$@"
    case ${1:-} in
      api | web) exec journalctl -u "gamedashboard-$1" -f ;;
      '') exec journalctl -u gamedashboard-api -u gamedashboard-web -f ;;
      *) echec "Usage : pnpm app:logs [api|web]" ;;
    esac
    ;;

  admin)
    exige_installation
    [ $# -eq 3 ] || echec "Usage : pnpm app:admin <email> <prénom> <nom>"
    exige_root "$@"
    script_api create-admin.mts "$@"
    ;;

  password)
    exige_installation
    [ $# -eq 1 ] || echec "Usage : pnpm app:password <email>"
    exige_root "$@"
    script_api reset-password.mts "$@"
    ;;

  help | -h | --help | --aide)
    aide
    ;;

  *)
    aide >&2
    echec "Commande inconnue : $ACTION"
    ;;
esac
