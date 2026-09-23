#!/usr/bin/env bash
#
# Pilotage du panel installé, derrière les commandes du package.json :
#
#   pnpm start    démarre les deux services, attend qu'ils répondent
#   pnpm stop     les arrête
#   pnpm restart  (pnpm enchaîne stop puis start)
#   pnpm status   état des services et adresse du panel
#   pnpm logs     journaux en direct (pnpm logs api | web pour un seul)
#
# Le panel tourne sous systemd, quel que soit le dossier d'où l'on tape la
# commande : ce script ne fait que parler à systemd. Sans les droits de root,
# il se relance lui-même par sudo — taper `pnpm start` suffit.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SERVICES=(gamedashboard-api gamedashboard-web)
ENVDIR=/opt/gamedashboard/env
ACTION=${1:-status}
shift || true

if [ -t 1 ]; then G=$'\033[1m' V=$'\033[32m' R=$'\033[31m' Z=$'\033[0m'; else G='' V='' R='' Z=''; fi

if [ ! -f /etc/systemd/system/gamedashboard-api.service ]; then
  printf '%sLe panel n'"'"'est pas encore installé sur cette machine.%s\n' "$R" "$Z" >&2
  echo "Lancer d'abord : pnpm configurer   (voir docs/installation.md)" >&2
  exit 1
fi

if [ "$(id -u)" != 0 ]; then
  exec sudo bash "$0" "$ACTION" "$@"
fi

origine() { sed -n 's/^PANEL_ORIGIN=//p' "$ENVDIR/api.env" 2>/dev/null | head -n 1; }

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
  printf '  %s✘%s %s ne répond toujours pas après 60 s — journalctl -u gamedashboard-%s -n 50\n' "$R" "$Z" "$nom" "$nom"
  return 1
}

case $ACTION in
  start)
    systemctl enable --now "${SERVICES[@]}" >/dev/null 2>&1
    echo "Démarrage…"
    ok=0
    attend 3211 api || ok=1
    attend 3210 web || ok=1
    [ "$ok" = 0 ] && printf '\n%sLe panel est en ligne : %s%s\n' "$G" "$(origine)" "$Z"
    exit "$ok"
    ;;
  stop)
    systemctl stop "${SERVICES[@]}"
    echo "Panel arrêté. Les serveurs de jeu, eux, continuent de tourner sur les nodes."
    ;;
  status)
    for s in "${SERVICES[@]}"; do
      if systemctl is-active --quiet "$s"; then
        printf '  %s●%s %-20s en marche depuis %s\n' "$V" "$Z" "$s" \
          "$(systemctl show -p ActiveEnterTimestamp --value "$s")"
      else
        printf '  %s●%s %-20s %s\n' "$R" "$Z" "$s" "$(systemctl is-active "$s" || true)"
      fi
    done
    printf '  Adresse : %s\n' "$(origine)"
    [ -f /opt/gamedashboard/app/RELEASE ] \
      && printf '  Version : %s\n' "$(sed -n 's/^version=//p' /opt/gamedashboard/app/RELEASE)"
    ;;
  logs)
    case ${1:-} in
      api | web) exec journalctl -u "gamedashboard-$1" -f ;;
      '') exec journalctl -u gamedashboard-api -u gamedashboard-web -f ;;
      *) echo "Usage : pnpm logs [api|web]" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Usage : panel.sh start|stop|status|logs [api|web]" >&2
    exit 1
    ;;
esac
