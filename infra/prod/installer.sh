#!/usr/bin/env bash
#
# GameDashboard — installation guidée du panel sur un serveur neuf.
#
#   git clone https://github.com/PowerNexus/PowerDashboard.git
#   cd PowerDashboard
#   sudo bash infra/prod/installer.sh
#
# Pensé pour quelqu'un qui n'a jamais vu le projet : il pose ses questions
# (domaine, adresse de l'administrateur), vérifie ce qui peut l'être avant de
# toucher à quoi que ce soit, installe ce qui manque, obtient le certificat,
# appelle deploy.sh, puis crée le premier compte administrateur et affiche
# son mot de passe. Le pas à pas, et ce qu'il faut faire ensuite, sont dans
# docs/installation.md.
#
# Rejouable : relancé sur une machine déjà installée, il **met à jour** —
# copie la nouvelle version, reconstruit, migre — sans reposer de question et
# sans jamais régénérer un secret.
#
# Sans question, pour une installation scriptée :
#
#   sudo bash infra/prod/installer.sh --oui --domaine panel.mondomaine.fr \
#     --courriel moi@mondomaine.fr --prenom Alex --nom Martin
#
# Systèmes pris en charge : Debian 12 et 13, Ubuntu 22.04 et 24.04, en root.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive

ROOT=/opt/gamedashboard
APP=$ROOT/app
ENVDIR=$ROOT/env
WEBROOT=/var/www/html
NODE_MAJOR=24
PG_MAJOR=18
SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

DOMAIN=${GD_DOMAIN:-}
EMAIL=${GD_EMAIL:-}
PRENOM=${GD_PRENOM:-}
NOM=${GD_NOM:-}
OUI=0

# ---------------------------------------------------------------------------
# Affichage
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  G=$'\033[1m' V=$'\033[32m' J=$'\033[33m' R=$'\033[31m' B=$'\033[36m' Z=$'\033[0m'
else
  G='' V='' J='' R='' B='' Z=''
fi
ETAPE=0
ETAPES=9
etape() { ETAPE=$((ETAPE + 1)); printf '\n%s[%s/%s] %s%s\n' "$G$B" "$ETAPE" "$ETAPES" "$1" "$Z"; }
ok()    { printf '  %s✔%s %s\n' "$V" "$Z" "$1"; }
info()  { printf '  • %s\n' "$1"; }
alerte(){ printf '  %s!%s %s\n' "$J" "$Z" "$1"; }
# Une erreur dit toujours quoi faire ensuite : c'est souvent la seule ligne
# que lira quelqu'un qui découvre le projet.
echec() {
  printf '\n%s✘ %s%s\n' "$R$G" "$1" "$Z" >&2
  shift
  for ligne in "$@"; do printf '  %s\n' "$ligne" >&2; done
  printf '\n  Aide : docs/installation.md, section « En cas de problème ».\n' >&2
  exit 1
}

interrompu() {
  echec "Étape interrompue (ligne $1 de installer.sh)." \
    "La commande qui a échoué a affiché son message juste au-dessus." \
    "Le script peut être relancé tel quel une fois la cause corrigée."
}
trap 'interrompu $LINENO' ERR

usage() {
  cat <<EOF
Installation guidée du panel GameDashboard.

  sudo bash infra/prod/installer.sh [options]

Options (toutes facultatives : ce qui manque est demandé) :
  --domaine D     nom de domaine du panel, ex. panel.mondomaine.fr
  --courriel E    adresse du premier administrateur (et de Let's Encrypt)
  --prenom P      prénom du premier administrateur
  --nom N         nom du premier administrateur
  --oui           ne pose aucune question : toutes les valeurs sont fournies
  -h, --aide      cette aide

Relancé sur une machine déjà installée, il met le panel à jour.
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --domaine) DOMAIN=${2:-}; shift 2 ;;
    --courriel) EMAIL=${2:-}; shift 2 ;;
    --prenom) PRENOM=${2:-}; shift 2 ;;
    --nom) NOM=${2:-}; shift 2 ;;
    --oui) OUI=1; shift ;;
    -h | --aide | --help) usage; exit 0 ;;
    *) usage >&2; echec "Option inconnue : $1" ;;
  esac
done

# Pose une question, avec une valeur par défaut éventuelle. Sans terminal, ou
# avec --oui, une valeur manquante est une erreur plutôt qu'une attente muette.
demander() {
  local var=$1 question=$2 defaut=${3:-} reponse
  if [ -n "${!var}" ]; then return; fi
  if [ "$OUI" = 1 ] || [ ! -t 0 ]; then
    [ -n "$defaut" ] && { printf -v "$var" '%s' "$defaut"; return; }
    echec "Valeur manquante : $question" "La fournir en option (voir --aide)."
  fi
  while [ -z "${!var}" ]; do
    if [ -n "$defaut" ]; then
      read -r -p "  $question [$defaut] : " reponse
      reponse=${reponse:-$defaut}
    else
      read -r -p "  $question : " reponse
    fi
    printf -v "$var" '%s' "$reponse"
  done
}

confirmer() {
  local question=$1 reponse
  [ "$OUI" = 1 ] && return 0
  [ -t 0 ] || return 0
  read -r -p "  $question [O/n] : " reponse
  case ${reponse,,} in '' | o | oui | y | yes) return 0 ;; *) return 1 ;; esac
}

printf '%s\n' "${G}GameDashboard — installation du panel${Z}"

# ---------------------------------------------------------------------------
etape "Vérifications avant de commencer"
# ---------------------------------------------------------------------------
# Rien n'est modifié avant la fin de cette étape : un refus ici ne laisse
# aucune installation à moitié faite.
[ "$(id -u)" = 0 ] || echec "Ce script doit être lancé en root." "Relancer avec : sudo bash infra/prod/installer.sh"

[ -f "$SRC/package.json" ] && grep -q '"name": "gamedashboard"' "$SRC/package.json" \
  || echec "Ce script doit être lancé depuis une copie du dépôt." \
    "git clone https://github.com/PowerNexus/PowerDashboard.git" \
    "cd PowerDashboard && sudo bash infra/prod/installer.sh"
ok "Dépôt trouvé : $SRC"

# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  debian:12 | debian:13 | ubuntu:22.04 | ubuntu:24.04) ok "Système : $PRETTY_NAME" ;;
  *)
    case " ${ID_LIKE:-} ${ID:-} " in
      *" debian "* | *" ubuntu "*)
        alerte "Système non testé : ${PRETTY_NAME:-inconnu}. Debian 12/13 ou Ubuntu 22.04/24.04 sont recommandés."
        confirmer "Continuer quand même ?" || exit 1 ;;
      *) echec "Système non pris en charge : ${PRETTY_NAME:-inconnu}." "Il faut une Debian ou une Ubuntu (apt et systemd)." ;;
    esac ;;
esac

[ -d /run/systemd/system ] || echec "systemd n'est pas actif sur cette machine." \
  "Le panel tourne sous deux services systemd. Un conteneur sans systemd (WSL, Docker) ne convient pas."

case $(uname -m) in
  x86_64 | aarch64) ok "Architecture : $(uname -m)" ;;
  *) echec "Architecture non prise en charge : $(uname -m)." "Il faut un processeur 64 bits (x86_64 ou ARM64)." ;;
esac

MEMOIRE_MO=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
ECHANGE_MO=$(awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo)
info "Mémoire : ${MEMOIRE_MO} Mo, fichier d'échange : ${ECHANGE_MO} Mo"
[ "$MEMOIRE_MO" -ge 900 ] || echec "Mémoire insuffisante (${MEMOIRE_MO} Mo)." "Il faut au moins 1 Go, 2 Go conseillés."

# Mesuré sur le plus proche dossier existant : /opt/gamedashboard n'existe
# pas encore, et le créer serait déjà modifier la machine.
MESURE=$ROOT
while [ ! -d "$MESURE" ]; do MESURE=$(dirname "$MESURE"); done
DISQUE_GO=$(df -Pk "$MESURE" | awk 'NR == 2 { print int($4 / 1048576) }')
[ "$DISQUE_GO" -ge 5 ] || echec "Espace disque insuffisant sous $ROOT : ${DISQUE_GO} Go libres." "Il en faut au moins 5 Go."
ok "Disque : ${DISQUE_GO} Go libres"

# ---------------------------------------------------------------------------
etape "Vos réponses"
# ---------------------------------------------------------------------------
MISE_A_JOUR=0
if [ -f "$ENVDIR/api.env" ]; then
  MISE_A_JOUR=1
  DOMAIN=$(sed -n 's#^PANEL_ORIGIN=https://##p' "$ENVDIR/api.env" | head -n 1)
  ok "Installation existante trouvée pour $DOMAIN : ce passage est une mise à jour."
  info "Les secrets, la base et les comptes sont conservés."
  confirmer "Mettre à jour le panel ?" || exit 0
else
  info "Le panel sera servi en HTTPS sur un nom de domaine qui pointe vers cette machine."
  info "Exemple : panel.mondomaine.fr (un sous-domaine convient très bien)."
  while :; do
    demander DOMAIN "Nom de domaine du panel"
    DOMAIN=${DOMAIN,,}
    DOMAIN=${DOMAIN#https://}
    DOMAIN=${DOMAIN#http://}
    DOMAIN=${DOMAIN%%/*}
    if [[ ! $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
      alerte "« $DOMAIN » n'est pas un nom de domaine (une adresse IP ne convient pas : pas de certificat possible)."
    elif [ "$DOMAIN" = panel.example.fr ]; then
      alerte "panel.example.fr est le nom d'exemple : il faut votre propre domaine."
    else
      break
    fi
    [ "$OUI" = 1 ] && exit 1
    DOMAIN=''
  done

  echo
  info "Le premier compte administrateur. Son mot de passe sera tiré au sort et affiché à la fin."
  while :; do
    demander EMAIL "Adresse électronique"
    [[ $EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] && break
    alerte "« $EMAIL » n'est pas une adresse valide."
    [ "$OUI" = 1 ] && exit 1
    EMAIL=''
  done
  demander PRENOM "Prénom"
  demander NOM "Nom"

  echo
  printf '  %sRécapitulatif%s\n' "$G" "$Z"
  printf '    Adresse du panel   https://%s\n' "$DOMAIN"
  printf '    Administrateur     %s %s <%s>\n' "$PRENOM" "$NOM" "$EMAIL"
  printf "    Certificat         Let's Encrypt, avis d'expiration à %s\n" "$EMAIL"
  confirmer "Tout est correct ?" || { echo "  Rien n'a été modifié. Relancez le script pour recommencer."; exit 0; }
fi

# ---------------------------------------------------------------------------
etape "Le domaine pointe-t-il ici ?"
# ---------------------------------------------------------------------------
# Let's Encrypt vérifie le domaine en venant le chercher sur cette machine. Un
# enregistrement DNS absent ou faux est la cause d'échec la plus fréquente :
# mieux vaut le dire maintenant qu'après dix minutes d'installation.
RESOLUES=$(getent ahosts "$DOMAIN" | awk '{ print $1 }' | sort -u | tr '\n' ' ' || true)
LOCALES=" $(hostname -I 2>/dev/null || true) "
if [ -z "$RESOLUES" ]; then
  alerte "$DOMAIN ne résout vers aucune adresse."
  info "Créez chez votre registraire un enregistrement A (et AAAA en IPv6) vers l'adresse publique de cette machine,"
  info "attendez quelques minutes, puis relancez le script."
  [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] || confirmer "Continuer malgré tout ?" || exit 1
else
  TROUVEE=0
  for ip in $RESOLUES; do
    if [[ $LOCALES == *" $ip "* ]]; then TROUVEE=1; fi
  done
  if [ "$TROUVEE" = 1 ]; then
    ok "$DOMAIN → $RESOLUES(adresse de cette machine)"
  else
    # Derrière une redirection de ports (box, NAT d'un hébergeur), l'adresse
    # publique n'est portée par aucune interface : ce n'est pas forcément faux.
    alerte "$DOMAIN → $RESOLUES: aucune de ces adresses n'est portée par cette machine ($(hostname -I 2>/dev/null))."
    info "C'est normal derrière une box ou le NAT d'un hébergeur ; sinon, corrigez l'enregistrement DNS."
    confirmer "Continuer ?" || exit 1
  fi
fi

# ---------------------------------------------------------------------------
etape "Paquets du système"
# ---------------------------------------------------------------------------
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync openssl sudo nginx certbot >/dev/null
ok "nginx, certbot, rsync, openssl"

# Construire l'interface demande de la mémoire : Next dépasse volontiers
# 1,5 Go pendant le build. Sans fichier d'échange sur une petite machine, le
# noyau tue la construction sans autre message qu'un « Killed ».
if [ "$MEMOIRE_MO" -lt 3500 ] && [ "$ECHANGE_MO" -lt 1024 ] && [ ! -f /swapfile ]; then
  alerte "Moins de 4 Go de mémoire et pas de fichier d'échange : la construction risque d'échouer."
  if confirmer "Créer un fichier d'échange de 2 Go (/swapfile) ?"; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Fichier d'échange de 2 Go actif, et conservé au redémarrage"
  fi
fi

# Pare-feu : seulement s'il est déjà actif, et seulement en ouvrant. Activer
# ufw d'office pourrait couper la session SSH en cours.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ok "Pare-feu ufw : ports 80 et 443 ouverts"
fi

# ---------------------------------------------------------------------------
etape "Node.js $NODE_MAJOR et PostgreSQL"
# ---------------------------------------------------------------------------
MAJEUR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$MAJEUR" -lt "$NODE_MAJOR" ]; then
  info "Installation de Node.js $NODE_MAJOR (dépôt NodeSource)…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
# corepack installe la version de pnpm épinglée par le dépôt. Il n'est plus
# livré avec Node à partir de la 25 : on l'ajoute s'il manque.
command -v corepack >/dev/null 2>&1 || npm install -g --silent corepack
corepack enable
ok "Node.js $(node -v), corepack $(corepack --version)"

# Un PostgreSQL déjà présent est réutilisé : deploy.sh n'y crée qu'un rôle et
# une base à lui. Sinon, la dernière version stable, depuis le dépôt officiel
# du projet PostgreSQL — celui de la distribution a souvent deux versions de
# retard.
if command -v psql >/dev/null 2>&1 && sudo -u postgres psql -tAc 'select 1' >/dev/null 2>&1; then
  ok "PostgreSQL déjà en service : $(sudo -u postgres psql -tAc 'show server_version' | cut -d' ' -f1)"
else
  info "Installation de PostgreSQL $PG_MAJOR (dépôt apt.postgresql.org)…"
  apt-get install -y -qq postgresql-common >/dev/null
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  apt-get install -y -qq "postgresql-$PG_MAJOR" >/dev/null
  systemctl enable --now postgresql >/dev/null 2>&1
  for _ in $(seq 1 20); do sudo -u postgres psql -tAc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
  ok "PostgreSQL $PG_MAJOR en service"
fi

# ---------------------------------------------------------------------------
etape "Copie du panel dans $APP"
# ---------------------------------------------------------------------------
# Le dépôt cloné reste un espace de travail ; ce qui tourne vit sous /opt. Les
# fichiers d'environnement et les dépendances ne sont jamais recopiés.
install -d "$APP"
if [ "$SRC" != "$APP" ]; then
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude .turbo --exclude .git \
    --exclude .env --exclude .env.local \
    "$SRC/" "$APP/"
fi
ok "Version copiée depuis $SRC"

# ---------------------------------------------------------------------------
etape "Certificat HTTPS"
# ---------------------------------------------------------------------------
# Le vhost du panel exige un certificat pour démarrer, et Let's Encrypt exige
# un site en HTTP pour en délivrer un. Un vhost provisoire, limité au défi
# ACME, rompt ce cercle ; il est retiré aussitôt après.
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
if [ -f "$CERT" ]; then
  ok "Certificat déjà présent, renouvelé automatiquement par certbot"
else
  [ -n "$EMAIL" ] || demander EMAIL "Adresse pour les avis d'expiration Let's Encrypt"
  install -d "$WEBROOT"
  PROVISOIRE=/etc/nginx/sites-enabled/gamedashboard-acme.conf
  cat > "$PROVISOIRE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 404; }
}
EOF
  systemctl enable --now nginx >/dev/null 2>&1
  nginx -t 2>/dev/null || { rm -f "$PROVISOIRE"; echec "nginx refuse sa configuration." "Détail : nginx -t"; }
  systemctl reload nginx

  trap - ERR
  # Le rechargement de nginx à chaque renouvellement : sans lui, nginx sert
  # l'ancien certificat jusqu'à son prochain redémarrage, donc jusqu'à
  # l'expiration.
  if certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
    --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
    --deploy-hook 'systemctl reload nginx'; then
    rm -f "$PROVISOIRE"
    systemctl reload nginx
    ok "Certificat obtenu pour $DOMAIN, renouvellement automatique en place"
  else
    rm -f "$PROVISOIRE"
    systemctl reload nginx || true
    echec "Let's Encrypt n'a pas pu vérifier $DOMAIN." \
      "Causes habituelles, dans l'ordre :" \
      "  1. l'enregistrement DNS ne pointe pas (encore) vers cette machine ;" \
      "  2. le port 80 est fermé par le pare-feu de l'hébergeur ou de la box ;" \
      "  3. trop d'essais ratés : Let's Encrypt bloque alors une heure." \
      "Rien d'autre n'a été modifié : corriger, puis relancer le script."
  fi
  trap 'interrompu $LINENO' ERR
fi

# ---------------------------------------------------------------------------
etape "Construction et démarrage (plusieurs minutes)"
# ---------------------------------------------------------------------------
# Tout le reste — utilisateur système, base, secrets, construction,
# migrations, services, vhost, contrôle des pages — est le travail de
# deploy.sh, le même qu'à chaque livraison.
trap - ERR
if ! GD_DOMAIN=$DOMAIN bash "$APP/infra/prod/deploy.sh"; then
  echec "Le déploiement a échoué." \
    "Le message juste au-dessus dit à quelle étape." \
    "Journaux des services : journalctl -u gamedashboard-api -n 50  et  journalctl -u gamedashboard-web -n 50" \
    "Une fois la cause corrigée, relancer ce script : il reprend là où il faut."
fi
trap 'interrompu $LINENO' ERR

# ---------------------------------------------------------------------------
etape "Premier administrateur"
# ---------------------------------------------------------------------------
MOT_DE_PASSE=''
if [ "$MISE_A_JOUR" = 1 ]; then
  ok "Mise à jour : aucun compte créé"
else
  # Seule l'adresse de la base est transmise, comme dans deploy.sh : la clé
  # de chiffrement n'a rien à faire dans ce processus.
  SORTIE=$(cd "$APP/apps/api" && \
    DATABASE_URL="$(grep '^DATABASE_URL=' "$ENVDIR/api.env" | cut -d= -f2-)" \
    ./node_modules/.bin/tsx scripts/create-admin.mts "$EMAIL" "$PRENOM" "$NOM") \
    || echec "La création du compte a échoué." "$SORTIE"
  MOT_DE_PASSE=$(printf '%s\n' "$SORTIE" | sed -n 's/^Mot de passe provisoire : //p')
  if [ -n "$MOT_DE_PASSE" ]; then
    ok "Compte créé : $EMAIL"
  else
    ok "$SORTIE"
  fi
fi

# ---------------------------------------------------------------------------
# Fin
# ---------------------------------------------------------------------------
printf '\n%s%s══════════════════════════════════════════════════════════════%s\n' "$G" "$V" "$Z"
printf '%s  Le panel est en ligne : https://%s%s\n' "$G" "$DOMAIN" "$Z"
printf '%s%s══════════════════════════════════════════════════════════════%s\n\n' "$G" "$V" "$Z"
if [ -n "$MOT_DE_PASSE" ]; then
  printf '  Identifiant          %s\n' "$EMAIL"
  printf '  Mot de passe         %s%s%s\n' "$G" "$MOT_DE_PASSE" "$Z"
  printf "  %sIl n'est affiché qu'une fois.%s Notez-le, puis changez-le à la première connexion.\n\n" "$J" "$Z"
fi
cat <<EOF
  À faire maintenant (détails dans docs/installation.md) :
    1. Se connecter, changer le mot de passe, activer la double authentification
       (Compte › Sécurité).
    2. Configurer l'envoi de courriels (Administration › Paramètres).
    3. Installer Wings sur la machine qui fera tourner les jeux :
         sudo bash infra/prod/installer-wings.sh
       puis la déclarer dans Administration › Nodes.

  ${G}Sauvegardez dès maintenant $ENVDIR${Z} hors de cette machine :
  sa clé APP_SECRET_KEY déchiffre les secrets de la base. Sans elle, une
  sauvegarde de la base ne sert à rien.

  Mettre à jour plus tard :  git pull && sudo bash infra/prod/installer.sh
  Journaux :                 journalctl -u gamedashboard-api -f
EOF
