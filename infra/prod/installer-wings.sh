#!/usr/bin/env bash
#
# GameDashboard — préparation d'une machine de jeu (un « node ») : Docker,
# Wings, certificat HTTPS.
#
#   sudo bash installer-wings.sh
#
# Le script se suffit à lui-même : il peut être copié seul sur la machine
# (`scp infra/prod/installer-wings.sh root@node1.mondomaine.fr:`), sans le
# dépôt. Il convient aussi à la machine du panel, si les jeux tournent sur la
# même.
#
# Wings est le **binaire amont, non modifié**, téléchargé depuis ses
# publications officielles (voir docs/adr/0001-wings-conserve.md). Le script
# ne fait que l'installer : c'est le panel qui lui donne sa configuration,
# par la commande que l'écran Administration › Nodes › « Configurer le
# daemon » affiche. Le pas à pas complet est dans docs/installation.md.
#
# Sans question :
#
#   sudo bash installer-wings.sh --oui --fqdn node1.mondomaine.fr --courriel moi@mondomaine.fr
#
# Rejouable : relancé, il met Wings à jour vers la dernière version publiée.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive

FQDN=${GD_FQDN:-}
EMAIL=${GD_EMAIL:-}
OUI=0
WEBROOT=/var/www/html

if [ -t 1 ]; then
  G=$'\033[1m' V=$'\033[32m' J=$'\033[33m' R=$'\033[31m' B=$'\033[36m' Z=$'\033[0m'
else
  G='' V='' J='' R='' B='' Z=''
fi
ETAPE=0
ETAPES=5
etape() { ETAPE=$((ETAPE + 1)); printf '\n%s[%s/%s] %s%s\n' "$G$B" "$ETAPE" "$ETAPES" "$1" "$Z"; }
ok()    { printf '  %s✔%s %s\n' "$V" "$Z" "$1"; }
info()  { printf '  • %s\n' "$1"; }
alerte(){ printf '  %s!%s %s\n' "$J" "$Z" "$1"; }
echec() {
  printf '\n%s✘ %s%s\n' "$R$G" "$1" "$Z" >&2
  shift
  for ligne in "$@"; do printf '  %s\n' "$ligne" >&2; done
  printf '\n  Aide : docs/installation.md, section « En cas de problème ».\n' >&2
  exit 1
}
interrompu() {
  echec "Étape interrompue (ligne $1 de installer-wings.sh)." \
    "La commande qui a échoué a affiché son message juste au-dessus." \
    "Le script peut être relancé tel quel une fois la cause corrigée."
}
trap 'interrompu $LINENO' ERR

usage() {
  cat <<EOF
Prépare une machine de jeu pour GameDashboard : Docker, Wings, certificat.

  sudo bash installer-wings.sh [options]

Options (facultatives : ce qui manque est demandé) :
  --fqdn F        nom de domaine de cette machine, ex. node1.mondomaine.fr
  --courriel E    adresse pour les avis d'expiration Let's Encrypt
  --oui           ne pose aucune question : toutes les valeurs sont fournies
  -h, --aide      cette aide
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --fqdn) FQDN=${2:-}; shift 2 ;;
    --courriel) EMAIL=${2:-}; shift 2 ;;
    --oui) OUI=1; shift ;;
    -h | --aide | --help) usage; exit 0 ;;
    *) usage >&2; echec "Option inconnue : $1" ;;
  esac
done

demander() {
  local var=$1 question=$2 reponse
  if [ -n "${!var}" ]; then return; fi
  if [ "$OUI" = 1 ] || [ ! -t 0 ]; then
    echec "Valeur manquante : $question" "La fournir en option (voir --aide)."
  fi
  while [ -z "${!var}" ]; do
    read -r -p "  $question : " reponse
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

printf '%s\n' "${G}GameDashboard — préparation d'une machine de jeu (Wings)${Z}"

# ---------------------------------------------------------------------------
etape "Vérifications et questions"
# ---------------------------------------------------------------------------
[ "$(id -u)" = 0 ] || echec "Ce script doit être lancé en root." "Relancer avec : sudo bash installer-wings.sh"
[ -d /run/systemd/system ] || echec "systemd n'est pas actif sur cette machine." "Wings tourne en service systemd."

# shellcheck disable=SC1091
. /etc/os-release
case " ${ID_LIKE:-} ${ID:-} " in
  *" debian "* | *" ubuntu "*) ok "Système : $PRETTY_NAME" ;;
  *) echec "Système non pris en charge : ${PRETTY_NAME:-inconnu}." "Il faut une Debian ou une Ubuntu." ;;
esac

case $(uname -m) in
  x86_64) ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
  *) echec "Architecture non prise en charge : $(uname -m)." "Wings est publié pour x86_64 et ARM64." ;;
esac
ok "Architecture : $(uname -m)"

# Docker ne tourne pas dans un conteneur OpenVZ ou LXC non privilégié : le
# dire ici évite une heure de recherche après une installation « réussie ».
VIRT=$(systemd-detect-virt 2>/dev/null || true)
case $VIRT in
  openvz | lxc)
    alerte "Virtualisation « $VIRT » : Docker, donc Wings, y fonctionne mal ou pas du tout."
    confirmer "Continuer quand même ?" || exit 1 ;;
  none | '') ;;
  *) ok "Virtualisation : $VIRT" ;;
esac

info "Cette machine a besoin de son propre nom de domaine, ex. node1.mondomaine.fr."
info "Le navigateur des joueurs s'y connecte directement (console, fichiers) : il lui faut un certificat."
while :; do
  demander FQDN "Nom de domaine de cette machine"
  FQDN=${FQDN,,}
  [[ $FQDN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] && break
  alerte "« $FQDN » n'est pas un nom de domaine."
  [ "$OUI" = 1 ] && exit 1
  FQDN=''
done
CERT=/etc/letsencrypt/live/$FQDN/fullchain.pem
[ -f "$CERT" ] || demander EMAIL "Adresse pour les avis d'expiration Let's Encrypt"

RESOLUES=$(getent ahosts "$FQDN" | awk '{ print $1 }' | sort -u | tr '\n' ' ' || true)
if [ -z "$RESOLUES" ]; then
  alerte "$FQDN ne résout vers aucune adresse : créez l'enregistrement A chez votre registraire."
  [ -f "$CERT" ] || confirmer "Continuer malgré tout ?" || exit 1
else
  ok "$FQDN → $RESOLUES"
fi

# ---------------------------------------------------------------------------
etape "Docker"
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "Docker déjà en service : $(docker --version)"
else
  info "Installation de Docker (script officiel get.docker.com)…"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  curl -fsSL https://get.docker.com | CHANNEL=stable sh >/dev/null
  systemctl enable --now docker >/dev/null 2>&1
  ok "Docker installé : $(docker --version)"
fi

# ---------------------------------------------------------------------------
etape "Wings"
# ---------------------------------------------------------------------------
# Dernière version publiée, telle quelle. Le binaire est remplacé à chaque
# passage ; sa configuration (/etc/pterodactyl/config.yml) n'est jamais
# touchée.
AVANT=$( (wings version 2>/dev/null || true) | head -n 1)
install -d -m 755 /etc/pterodactyl /var/lib/pterodactyl /var/log/pterodactyl
curl -fsSL -o /usr/local/bin/wings.nouveau \
  "https://github.com/pterodactyl/wings/releases/latest/download/wings_linux_$ARCH"
chmod 755 /usr/local/bin/wings.nouveau
mv -f /usr/local/bin/wings.nouveau /usr/local/bin/wings
ok "Wings : $( (wings version 2>/dev/null || echo 'version illisible') | head -n 1)${AVANT:+ (avant : $AVANT)}"

# L'unité est celle que documente le projet amont, à l'identique.
cat > /etc/systemd/system/wings.service <<'EOF'
[Unit]
Description=Pterodactyl Wings Daemon
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
User=root
WorkingDirectory=/etc/pterodactyl
LimitNOFILE=4096
PIDFile=/var/run/wings/daemon.pid
ExecStart=/usr/local/bin/wings
Restart=on-failure
StartLimitInterval=180
StartLimitBurst=30
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
ok "Service wings.service installé"
# Mise à jour d'un daemon en service : il tourne encore sur l'ancien binaire
# tant qu'on ne le relance pas. Les serveurs de jeu, eux, sont des conteneurs
# Docker et ne s'arrêtent pas.
if systemctl is-active --quiet wings; then
  systemctl restart wings
  ok "Wings relancé sur la nouvelle version"
fi

# ---------------------------------------------------------------------------
etape "Certificat HTTPS de $FQDN"
# ---------------------------------------------------------------------------
# Le panel écrit dans la configuration de Wings le chemin que certbot utilise :
# /etc/letsencrypt/live/<domaine>/. Un certificat rangé ailleurs ne serait
# pas trouvé.
if [ -f "$CERT" ]; then
  ok "Certificat déjà présent"
else
  command -v certbot >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq certbot >/dev/null; }
  # Wings relit son certificat au démarrage seulement : il faut le relancer
  # à chaque renouvellement.
  HOOK='systemctl restart wings'
  trap - ERR
  if systemctl is-active --quiet nginx; then
    # Le panel est sur cette machine : nginx tient le port 80. Son site par
    # défaut sert $WEBROOT pour tout nom qu'il ne connaît pas, ce qui suffit
    # au défi de Let's Encrypt.
    install -d "$WEBROOT"
    certbot certonly --webroot -w "$WEBROOT" -d "$FQDN" --email "$EMAIL" \
      --agree-tos --no-eff-email --non-interactive --deploy-hook "$HOOK"
  else
    certbot certonly --standalone -d "$FQDN" --email "$EMAIL" \
      --agree-tos --no-eff-email --non-interactive --deploy-hook "$HOOK"
  fi || echec "Let's Encrypt n'a pas pu vérifier $FQDN." \
    "Causes habituelles : l'enregistrement DNS ne pointe pas vers cette machine," \
    "ou le port 80 est fermé (pare-feu de l'hébergeur, de la box, ou ufw)." \
    "Corriger, puis relancer le script."
  trap 'interrompu $LINENO' ERR
  ok "Certificat obtenu, renouvellement automatique en place"
fi

# ---------------------------------------------------------------------------
etape "Pare-feu"
# ---------------------------------------------------------------------------
# Comme pour le panel : on n'ouvre que si ufw est déjà actif, on ne l'active
# jamais d'office.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 8080/tcp >/dev/null
  ufw allow 2022/tcp >/dev/null
  ok "ufw : ports 80 (certificat), 8080 (Wings) et 2022 (SFTP) ouverts"
  alerte "Les ports des serveurs de jeu (ex. 25565) restent à ouvrir : ufw allow 25565"
else
  info "Aucun pare-feu ufw actif. Si votre hébergeur a un pare-feu, ouvrez-y :"
  info "8080/tcp (Wings), 2022/tcp (SFTP) et les ports de vos jeux (ex. 25565)."
fi

# ---------------------------------------------------------------------------
printf '\n%s%s══════════════════════════════════════════════════════════════%s\n' "$G" "$V" "$Z"
printf '%s  La machine est prête. Reste à la relier au panel.%s\n' "$G" "$Z"
printf '%s%s══════════════════════════════════════════════════════════════%s\n\n' "$G" "$V" "$Z"
cat <<EOF
  1. Dans le panel : Administration › Nodes › « Déclarer un node »,
     avec le nom de domaine ${G}$FQDN${Z}, schéma https, port 8080, SFTP 2022.
  2. Dans le menu du node : « Configurer le daemon ». Copier la commande
     « wings configure … » affichée, et la coller ici, en root.
  3. Démarrer Wings :
       systemctl enable --now wings
     Le node passe « En ligne » dans le panel en moins d'une minute.
  4. Toujours dans le menu du node : « Ajouter des ports » (ex. 25565 à 25575),
     sans quoi aucun serveur ne peut y être créé.

  En cas de souci :  journalctl -u wings -n 50
EOF
