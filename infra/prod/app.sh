#!/usr/bin/env bash
#
# La ligne de commande de GameDashboard.
#
# Elle se lance de trois façons, qui font la même chose :
#
#   curl -fsSL https://github.com/PowerNexus/PowerDashboard/releases/latest/download/gamedashboard.sh \
#     | sudo bash -s -- install          sans rien avoir téléchargé d'autre
#   gamedashboard <commande>             une fois installée (/usr/local/bin)
#   pnpm app:<commande>                  depuis un clone ou une archive extraite
#
# Les commandes :
#
#   pnpm app:install          depuis un dossier : vérifie Node.js, installe les dépendances
#                             par curl : télécharge la dernière version et l'installe
#   pnpm app:setup            installation guidée ; relancée, reconfigure et redémarre
#   pnpm app:update           sauvegarde, puis passe à la dernière version publiée
#   pnpm app:backup           sauvegarde la base et la clé maître dans un seul fichier
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
# Pourquoi un préfixe côté pnpm : pnpm fait passer ses propres commandes
# avant les scripts du projet. `pnpm setup` règle le dossier global de pnpm et
# modifie le .bashrc sans jamais lancer notre installation ; `pnpm restart`
# enchaîne des scripts plutôt que d'en lancer un. Sous `app:`, aucun nom ne
# peut être capté ainsi.
#
# Ce fichier se suffit à lui-même : lu depuis curl, il n'a ni dépôt ni
# dossier autour de lui, et télécharge ce qui lui manque depuis GitHub
# Releases, empreinte vérifiée.
set -euo pipefail
# Les dossiers système sont ajoutés **après** le PATH de l'utilisateur, pas
# avant : devant, ils masquaient un Node installé par nvm ou fnm, et
# app:install jugeait la version du système au lieu de celle qu'il utilise.
export PATH=$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

DEPOT=${GD_DEPOT:-PowerNexus/PowerDashboard}
# Réglable pour les essais seulement : un serveur local qui imite GitHub.
SITE=${GD_SITE:-https://github.com}
INSTALLE=/opt/gamedashboard
VERSIONS=$INSTALLE/releases
SAUVEGARDES=${GD_SAUVEGARDES:-$INSTALLE/backups}
COMMANDE=/usr/local/bin/gamedashboard
SERVICES=(gamedashboard-api gamedashboard-web)
NODE_MIN=24

ACTION=${1:-help}
shift || true

if [ -t 1 ]; then G=$'\033[1m' V=$'\033[32m' J=$'\033[33m' R=$'\033[31m' Z=$'\033[0m'; else G='' V='' J='' R='' Z=''; fi
echec() { printf '%s✘ %s%s\n' "$R" "$1" "$Z" >&2; shift; for l in "$@"; do printf '  %s\n' "$l" >&2; done; exit 1; }
ok() { printf '  %s✔%s %s\n' "$V" "$Z" "$1"; }
info() { printf '  • %s\n' "$1"; }

# ---------------------------------------------------------------------------
# D'où l'on parle
# ---------------------------------------------------------------------------
# FICHIER : ce script sur le disque, s'il y est (lu par curl | bash, il n'y
# est pas). RACINE : un dossier du panel, pour les commandes qui en ont
# besoin — celui qui entoure ce script (clone, archive), sinon le panel
# installé. LOCAL=1 quand on est dans un clone ou une archive.
est_panel() { [ -f "$1/package.json" ] && grep -q '"name": "gamedashboard"' "$1/package.json"; }
FICHIER=''
SOURCE=${BASH_SOURCE[0]:-}
if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  FICHIER=$(cd "$(dirname "$SOURCE")" && pwd)/$(basename "$SOURCE")
fi
RACINE='' LOCAL=0
if [ -n "$FICHIER" ]; then
  CANDIDAT=$(cd "$(dirname "$FICHIER")/../.." && pwd)
  if est_panel "$CANDIDAT"; then RACINE=$CANDIDAT LOCAL=1; fi
fi
if [ -z "$RACINE" ] && est_panel "$INSTALLE/app"; then RACINE=$INSTALLE/app; fi

# Les messages citent la commande telle qu'on l'a tapée.
if [ -n "${npm_lifecycle_event:-}" ]; then P='pnpm app:'; else P='gamedashboard '; fi

aide() {
  cat <<EOF
${G}GameDashboard — commandes${Z}

  Installer
    ${P}install            installe (par curl : télécharge la dernière version, puis l'installation guidée)
    ${P}setup              installation guidée ; relancée, reconfigure et redémarre
    ${P}update             sauvegarde, puis passe à la dernière version publiée
    ${P}wings              prépare cette machine à faire tourner des jeux (Wings)

  Au quotidien
    ${P}start              démarre le panel
    ${P}stop               l'arrête (les serveurs de jeu continuent)
    ${P}restart            le redémarre
    ${P}status             état, adresse et version
    ${P}logs [api|web]     journaux en direct (Ctrl+C pour sortir)
    ${P}backup             sauvegarde la base et la clé maître (dans $SAUVEGARDES)

  Comptes
    ${P}admin <email> <prénom> <nom>   crée un administrateur
    ${P}password <email>               tire un nouveau mot de passe

  Mainteneurs
    ${P}release <vX.Y.Z>   assemble une archive publiable, après pnpm build

  Guide complet : https://github.com/$DEPOT/blob/main/docs/installation.md
EOF
}

exige_installation() {
  [ -f /etc/systemd/system/gamedashboard-api.service ] \
    || echec "Le panel n'est pas encore installé sur cette machine." "Lancer d'abord : ${P}install   (voir docs/installation.md)"
}
# Ce qui touche au système se relance par sudo. Lu depuis curl, le script n'a
# pas de fichier à relancer : il faut alors mettre sudo devant bash.
exige_root() {
  [ "$(id -u)" = 0 ] && return 0
  [ -n "$FICHIER" ] || echec "Il faut les droits de root." "Mettre sudo devant bash : curl … | sudo bash -s -- $ACTION"
  command -v sudo >/dev/null 2>&1 || echec "Il faut les droits de root, et sudo est absent." "Se connecter en root, puis relancer."
  exec sudo --preserve-env=npm_lifecycle_event,GD_DEPOT,GD_SITE,GD_VERSION,GD_SAUVEGARDES,GD_GARDER \
    bash "$FICHIER" "$ACTION" "$@"
}

# Lu par `curl | bash`, l'entrée standard est le tuyau qui apporte ce script :
# un programme qui poserait une question y lirait la suite du script en guise
# de réponse. Les étapes interactives lisent donc le terminal, s'il y en a un,
# et sinon rien — l'installation échoue alors proprement sur la première
# valeur manquante, que l'on fournit en option (--oui --domaine …).
lance() {
  if [ -t 0 ]; then
    exec bash "$@"
  elif (: </dev/tty) 2>/dev/null; then
    exec bash "$@" </dev/tty
  else
    exec bash "$@" </dev/null
  fi
}

origine() { sed -n 's/^PANEL_ORIGIN=//p' "$INSTALLE/env/api.env" 2>/dev/null | head -n 1; }
# Vide pour une installation faite depuis git, qui n'a pas de fichier RELEASE.
version_installee() {
  if [ -f "$INSTALLE/app/RELEASE" ]; then sed -n 's/^version=//p' "$INSTALLE/app/RELEASE" | head -n 1; fi
}

# ---------------------------------------------------------------------------
# Versions publiées
# ---------------------------------------------------------------------------
# La dernière version se lit dans la redirection de /releases/latest, sans
# passer par l'API de GitHub : pas de limite de débit, pas de JSON à lire
# sans outil pour le lire.
derniere_version() {
  local url v
  url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$SITE/$DEPOT/releases/latest") \
    || echec "GitHub ne répond pas." "Vérifier la connexion de la machine, puis relancer."
  v=${url##*/tag/}
  [[ $v =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
    || echec "Aucune version publiée sur https://github.com/$DEPOT/releases." \
      "Installer depuis un clone : git clone, puis pnpm app:install && pnpm app:setup."
  printf '%s' "$v"
}

# Télécharge un fichier publié et son empreinte, puis vérifie l'une par
# l'autre. Un fichier dont l'empreinte ne correspond pas n'est jamais utilisé.
telecharger() {
  local version=$1 nom=$2 dossier=$3 base
  base="$SITE/$DEPOT/releases/download/$version"
  curl -fsSL -o "$dossier/$nom" "$base/$nom" \
    || echec "Téléchargement impossible : $base/$nom"
  curl -fsSL -o "$dossier/$nom.sha256" "$base/$nom.sha256" \
    || echec "Empreinte introuvable : $base/$nom.sha256"
  (cd "$dossier" && sha256sum -c --quiet "$nom.sha256") \
    || echec "L'empreinte de $nom ne correspond pas : fichier abîmé ou altéré, il n'est pas utilisé." "Relancer ; si cela persiste, ne pas insister et le signaler."
}

# Pose une version dans /opt/gamedashboard/releases/<version> et rend son
# chemin. Les deux plus récentes sont gardées, les autres effacées.
poser_version() {
  local version=$1 temp nom="gamedashboard-$1"
  install -d -m 755 "$VERSIONS"
  if [ ! -f "$VERSIONS/$nom/RELEASE" ]; then
    temp=$(mktemp -d)
    info "Téléchargement de $version…" >&2
    telecharger "$version" "$nom.tar.gz" "$temp"
    rm -rf "${VERSIONS:?}/$nom"
    tar -xzf "$temp/$nom.tar.gz" -C "$VERSIONS"
    rm -rf "$temp"
    ok "$version téléchargée, empreinte vérifiée" >&2
  fi
  # shellcheck disable=SC2012
  ls -1dt "$VERSIONS"/gamedashboard-v* 2>/dev/null | tail -n +3 | while read -r ancienne; do
    [ "$ancienne" = "$VERSIONS/$nom" ] || rm -rf "$ancienne"
  done
  printf '%s' "$VERSIONS/$nom"
}

# La commande `gamedashboard`, pour la suite. Copiée depuis la version
# installée : elle suit les mises à jour.
poser_commande() {
  local depuis=$1
  install -m 755 "$depuis/infra/prod/app.sh" "$COMMANDE"
}

# ---------------------------------------------------------------------------
# Pilotage
# ---------------------------------------------------------------------------
# `systemctl start` rend la main dès que le processus est lancé, pas quand il
# répond : on attend l'écoute effective, comme deploy.sh.
attend() {
  local port=$1 nom=$2 _
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
      ok "$nom répond"
      return 0
    fi
    sleep 1
  done
  printf '  %s✘%s %s ne répond toujours pas après 60 s — %slogs %s\n' "$R" "$Z" "$nom" "$P" "$nom"
  return 1
}

demarrer() {
  systemctl enable --now "${SERVICES[@]}" >/dev/null 2>&1
  echo "Démarrage…"
  local etat=0
  attend 3211 api || etat=1
  attend 3210 web || etat=1
  if [ "$etat" = 0 ]; then printf '\n%sLe panel est en ligne : %s%s\n' "$G" "$(origine)" "$Z"; fi
  return "$etat"
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

# ---------------------------------------------------------------------------
# Sauvegarde
# ---------------------------------------------------------------------------
# Un seul fichier, qui contient les deux moitiés indispensables : la base, et
# la clé qui déchiffre ses secrets. L'une sans l'autre ne restaure rien —
# c'est l'erreur qu'un fichier unique empêche de faire.
sauvegarder() {
  local garder=${GD_GARDER:-7} horodatage temp fichier
  [[ $garder =~ ^[0-9]+$ ]] && [ "$garder" -ge 1 ] || echec "GD_GARDER doit être un nombre, au moins 1."
  install -d -m 700 "$SAUVEGARDES"
  horodatage=$(date +%Y%m%d-%H%M%S)
  temp=$(mktemp -d)
  info "Base de données…"
  # La redirection est faite par root, à dessein : postgres lit la base, root
  # écrit le fichier, dans un dossier que postgres ne peut pas lire.
  # shellcheck disable=SC2024
  sudo -u postgres pg_dump -Fc gamedashboard > "$temp/base.dump" \
    || { rm -rf "$temp"; echec "pg_dump a échoué : la base est-elle en service ?" "systemctl status postgresql"; }
  cp -a "$INSTALLE/env" "$temp/env"
  if [ -f "$INSTALLE/app/RELEASE" ]; then cp "$INSTALLE/app/RELEASE" "$temp/RELEASE"; fi
  cat > "$temp/LISEZMOI.txt" <<EOF
Sauvegarde GameDashboard du $(date '+%d/%m/%Y à %H:%M').

  base.dump   la base (pg_dump, format personnalisé)
  env/        api.env, web.env, .dbpass — dont APP_SECRET_KEY
  RELEASE     la version qui tournait (absent pour une installation depuis git)

Restaurer sur une machine où le panel est installé, avec le même domaine :

  gamedashboard stop
  mkdir -p /tmp/restauration && tar -xf CE-FICHIER.tar -C /tmp/restauration
  cp -a /tmp/restauration/env/. /opt/gamedashboard/env/
  sudo -u postgres pg_restore --clean --if-exists -d gamedashboard < /tmp/restauration/base.dump
  gamedashboard setup
  rm -rf /tmp/restauration

(Le dump passe par l'entrée standard : le dossier extrait n'est lisible que
par root, et c'est voulu.)

Ce fichier contient la clé maître : le ranger comme un mot de passe.
EOF
  fichier="$SAUVEGARDES/gamedashboard-$horodatage.tar"
  (umask 077 && tar -cf "$fichier" -C "$temp" .)
  rm -rf "$temp"
  chmod 600 "$fichier"
  ok "Sauvegarde : $fichier ($(du -h "$fichier" | cut -f1))"

  # shellcheck disable=SC2012
  ls -1t "$SAUVEGARDES"/gamedashboard-*.tar 2>/dev/null | tail -n +"$((garder + 1))" | while read -r vieille; do
    rm -f "$vieille"
    info "Ancienne sauvegarde retirée : $(basename "$vieille")"
  done
  printf '  %s!%s Elle reste sur cette machine : copiez-la ailleurs (scp), elle contient la clé maître.\n' "$J" "$Z"
}

# ---------------------------------------------------------------------------
case $ACTION in
  install)
    if [ "$LOCAL" = 1 ]; then
      # Dans un clone ou une archive : les dépendances de ce dossier.
      command -v node >/dev/null 2>&1 \
        || echec "Node.js est absent." "Voir docs/installation.md, étape 4.2."
      MAJEUR=$(node -p 'process.versions.node.split(".")[0]')
      [ "$MAJEUR" -ge "$NODE_MIN" ] \
        || echec "Node.js $(node -v) est trop ancien : il faut la version $NODE_MIN ou plus." "Voir docs/installation.md, étape 4.2."
      ok "Node.js $(node -v), pnpm $(pnpm -v)"
      cd "$RACINE"
      pnpm install --frozen-lockfile
      printf '\n%sDépendances installées.%s Suite : pnpm app:setup\n' "$G" "$Z"
    else
      # Par curl ou par la commande installée : tout, depuis GitHub Releases.
      exige_root "$@"
      if [ -f "$INSTALLE/env/api.env" ]; then
        echec "Le panel est déjà installé sur cette machine ($(origine))." "Pour passer à la dernière version : gamedashboard update"
      fi
      command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null; }
      VERSION=${GD_VERSION:-$(derniere_version)}
      DOSSIER=$(poser_version "$VERSION")
      poser_commande "$DOSSIER"
      ok "Commande installée : gamedashboard (gamedashboard help)"
      # La suite est l'installation guidée, depuis la version téléchargée.
      lance "$DOSSIER/infra/prod/installer.sh" "$@"
    fi
    ;;

  setup)
    [ -n "$RACINE" ] || echec "Aucun panel ici ni sur cette machine." "Commencer par : ${P}install"
    lance "$RACINE/infra/prod/installer.sh" "$@"
    ;;

  update)
    exige_installation
    exige_root "$@"
    FORCER=0 SAUVER=1 VERSION=${GD_VERSION:-}
    while [ $# -gt 0 ]; do
      case $1 in
        --version) VERSION=${2:-}; shift 2 ;;
        --forcer) FORCER=1; shift ;;
        --sans-sauvegarde) SAUVER=0; shift ;;
        *) echec "Option inconnue : $1" "Options : --version vX.Y.Z, --forcer, --sans-sauvegarde" ;;
      esac
    done
    ACTUELLE=$(version_installee)
    VERSION=${VERSION:-$(derniere_version)}
    info "Installée : ${ACTUELLE:-inconnue (installation depuis git)} · publiée : $VERSION"
    if [ "$ACTUELLE" = "$VERSION" ] && [ "$FORCER" = 0 ]; then
      ok "Déjà à jour."
      exit 0
    fi
    # Une mise à jour applique des migrations : sans sauvegarde prise juste
    # avant, pas de retour en arrière possible.
    if [ "$SAUVER" = 1 ]; then sauvegarder; fi
    DOSSIER=$(poser_version "$VERSION")
    # installer.sh reconnaît l'installation existante : aucune question, les
    # secrets et les comptes sont conservés.
    bash "$DOSSIER/infra/prod/installer.sh" --oui </dev/null
    poser_commande "$DOSSIER"
    ok "Mise à jour terminée : $VERSION"
    ;;

  backup)
    exige_installation
    exige_root "$@"
    [ $# -eq 0 ] || echec "Usage : ${P}backup   (dossier : GD_SAUVEGARDES, nombre gardé : GD_GARDER, 7 par défaut)"
    sauvegarder
    ;;

  wings)
    if [ -n "$RACINE" ]; then lance "$RACINE/infra/prod/installer-wings.sh" "$@"; fi
    # Machine de jeu sans panel : le script publié, empreinte vérifiée.
    exige_root "$@"
    TEMP=$(mktemp -d)
    telecharger "${GD_VERSION:-$(derniere_version)}" installer-wings.sh "$TEMP"
    lance "$TEMP/installer-wings.sh" "$@"
    ;;

  release)
    [ "$LOCAL" = 1 ] || echec "app:release s'utilise depuis un clone du dépôt."
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
    VERSION=$(version_installee)
    printf '  Version : %s\n' "${VERSION:-installée depuis git}"
    ;;

  logs)
    exige_installation
    exige_root "$@"
    case ${1:-} in
      api | web) exec journalctl -u "gamedashboard-$1" -f ;;
      '') exec journalctl -u gamedashboard-api -u gamedashboard-web -f ;;
      *) echec "Usage : ${P}logs [api|web]" ;;
    esac
    ;;

  admin)
    exige_installation
    [ $# -eq 3 ] || echec "Usage : ${P}admin <email> <prénom> <nom>"
    exige_root "$@"
    script_api create-admin.mts "$@"
    ;;

  password)
    exige_installation
    [ $# -eq 1 ] || echec "Usage : ${P}password <email>"
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
