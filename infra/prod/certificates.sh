#!/usr/bin/env bash
#
# Agent de certificats des domaines de revendeurs.
#
# Le panel reconnaît un domaine vérifié, mais il ne peut pas lui délivrer de
# TLS : cela demande le serveur web et les droits de root, qui ne sont pas de
# son ressort. Cet agent est le pont. Il tourne **sur le serveur web**, demande
# au panel quels domaines attendent un certificat, les obtient, et rend compte
# de chaque tentative — réussie ou non.
#
# ─── Ce que cet agent protège ────────────────────────────────────────────────
#
# Le serveur web peut servir d'autres sites publics. Un nginx qui refuse de
# recharger les emporte tous. C'est le risque dominant, loin devant l'échec
# d'un certificat, et toute la structure du script en découle :
#
#   * chaque fichier est écrit **hors des chemins servis**, puis déplacé ;
#   * `nginx -t` valide la configuration entière **avant** tout rechargement ;
#   * un test négatif retire le fichier et revalide, de sorte que l'état de
#     départ soit rétabli avant qu'on abandonne ;
#   * aucun fichier existant n'est modifié — un domaine, un fichier, à nous.
#
# ─── Détection d'erreur ──────────────────────────────────────────────────────
#
# Un échec n'est utile que si l'on sait quoi en faire. Le script classe donc
# la sortie de certbot plutôt que de recopier son journal, et rend au panel une
# phrase qui dit **à qui** est le problème : au revendeur (sa zone DNS), à la
# plateforme (nginx, droits), ou à l'autorité (limitation de débit).
#
# ─── Usage ───────────────────────────────────────────────────────────────────
#
#   certificates.sh [--staging] [--dry-run] [--domain <nom>]
#
#   --staging   Autorité de test de Let's Encrypt. Les certificats obtenus ne
#               sont pas reconnus par les navigateurs, mais les limites de débit
#               y sont larges : c'est ainsi qu'on éprouve le parcours sans
#               griller le quota du vrai service.
#   --dry-run   Tout sauf l'appel à certbot et le rechargement. Dit ce qui
#               serait fait.
#   --domain    Un seul domaine, même s'il n'est pas en attente. Pour reprendre
#               un cas précis sans attendre le tour suivant.

set -uo pipefail

API=${GD_API:-http://127.0.0.1:3211}
KEY_FILE=${GD_KEY_FILE:-/opt/gamedashboard/env/.certificates-key}
WEBROOT=${GD_WEBROOT:-/var/www/html}
NGINX_DIR=${GD_NGINX_DIR:-/etc/nginx/sites-enabled}
# Préfixe réservé à cet agent. Il rend le périmètre lisible et garantit qu'on
# ne touchera jamais au fichier d'un autre site : tout ce qui ne le porte pas
# ne nous appartient pas.
PREFIX=gd-reseller-
PANEL_WEB_PORT=${GD_WEB_PORT:-3210}
CONTACT=${GD_ACME_CONTACT:-}

# Page servie sur le port 80 d'un domaine vérifié **tant qu'il n'a pas de
# certificat** (bloc de défi, `bloc_acme`), et d'un domaine déclaré **pas encore
# vérifié** (`bloc_attente`) : un client du revendeur qui ouvre son adresse trop
# tôt lit ce qui se passe et quand revenir, au lieu de la page d'erreur nue du
# `default_server` de nginx — ou d'un autre site de la machine.
#
# - Ni nom ni logo : la marque de la plateforme n'a rien à faire sur le domaine
#   d'un revendeur (marque blanche), et celle du revendeur n'est servie que par
#   le panel, en HTTPS. Le panel n'est jamais servi en clair.
# - Aucune couleur écrite : `color-scheme` et les couleurs système (`Canvas`,
#   `CanvasText`) suivent le thème clair ou sombre du visiteur.
# - Une seule ligne, sans apostrophe droite ni `$` : nginx la reçoit entre
#   apostrophes (`return 503 '…'`) et y remplacerait ses variables.
PAGE_ATTENTE='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Mise en service en cours</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:Canvas;color:CanvasText"><main style="max-width:32rem;padding:1.5rem;text-align:center"><h1 style="font-size:1.25rem">Mise en service en cours</h1><p>Ce domaine vient d&rsquo;être relié au panel. Son certificat de sécurité est en cours d&rsquo;émission : l&rsquo;accès sécurisé ouvrira d&rsquo;ici quelques minutes.</p><p>Réessayez un peu plus tard.</p></main></body></html>'

STAGING=""
DRY_RUN=""
ONLY_DOMAIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --staging)  STAGING="--staging" ;;
    --dry-run)  DRY_RUN=1 ;;
    --domain)   shift; ONLY_DOMAIN="${1:-}" ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

# ─── Panel ───────────────────────────────────────────────────────────────────

if [ ! -r "$KEY_FILE" ]; then
  log "ERREUR La clé applicative est introuvable ($KEY_FILE)."
  log "       Émettez-la depuis /admin/api avec la seule portée « domains.certificates »,"
  log "       puis déposez-la dans ce fichier, lisible par root seul."
  exit 3
fi
KEY=$(tr -d '[:space:]' < "$KEY_FILE")

panel() { # méthode chemin [corps] [--code]
  local methode=$1 chemin=$2 corps=${3:-} code=${4:-}
  # Avec --code, le corps est suivi d'une ligne portant le statut HTTP : un
  # refus du panel est un JSON comme un autre, et sans le statut il se lit
  # comme une réponse valide.
  local w=(); [ "$code" = "--code" ] && w=(-w $'
%{http_code}')
  if [ -n "$corps" ]; then
    curl -sS --max-time 20 -X "$methode" "$API$chemin" "${w[@]}" \
      -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$corps"
  else
    curl -sS --max-time 20 -X "$methode" "$API$chemin" "${w[@]}" -H "Authorization: Bearer $KEY"
  fi
}

# `jq` n'est pas supposé présent sur une machine d'hébergement : python3 l'est,
# et il vient avec le système. Une dépendance de moins à installer pour un
# agent qui doit pouvoir tourner partout.
extraire() { python3 -c "$1" 2>/dev/null; }

rendre_compte() { # domaine issue expiration echec
  local domaine=$1 issue=$2 expiration=$3 echec=$4
  local corps
  corps=$(python3 -c '
import json, sys
print(json.dumps({
    "issuedAt": sys.argv[1] or None,
    "expiresAt": sys.argv[2] or None,
    "failure": sys.argv[3] or None,
}))' "$issue" "$expiration" "$echec")

  if [ -n "$DRY_RUN" ]; then
    log "  [essai] compte rendu : $corps"
    return 0
  fi

  panel POST "/api/v1/application/domains/$domaine/certificate" "$corps" >/dev/null \
    || log "  ATTENTION Le compte rendu n'a pas pu être remis au panel."
}

# ─── nginx ───────────────────────────────────────────────────────────────────

# Écrit le bloc d'un domaine, valide, recharge. Rend 0 si tout tient.
#
# Le fichier est d'abord écrit ailleurs : un fichier incomplet dans
# `sites-enabled` serait pris au prochain rechargement, déclenché par n'importe
# quel autre outil de la machine.
#
# Avec `--exclusif`, un nom que nginx déclare en conflit (« conflicting server
# name ») fait retirer le bloc : `nginx -t` n'y voit qu'un avertissement, mais
# l'un des deux sites cesserait d'être servi.
poser_bloc() { # domaine fichier_contenu [--exclusif]
  local domaine=$1 contenu=$2 exclusif=${3:-}
  local cible="$NGINX_DIR/$PREFIX$domaine.conf"
  local tampon
  tampon=$(mktemp)
  printf '%s\n' "$contenu" > "$tampon"

  if [ -n "$DRY_RUN" ]; then
    log "  [essai] poserait $cible"
    rm -f "$tampon"
    return 0
  fi

  install -m 644 "$tampon" "$cible"
  rm -f "$tampon"

  if ! nginx -t >/dev/null 2>&1; then
    # L'état de départ est rétabli **avant** d'abandonner : laisser une
    # configuration invalide ferait échouer le prochain rechargement de la
    # machine, déclenché par un tout autre site.
    rm -f "$cible"
    if nginx -t >/dev/null 2>&1; then
      log "  ERREUR nginx refuse ce bloc ; il a été retiré, la configuration est saine."
    else
      log "  ALERTE nginx refuse la configuration MÊME SANS notre bloc — intervention requise."
    fi
    return 1
  fi

  if [ "$exclusif" = "--exclusif" ] \
    && nginx -t 2>&1 | grep -qF "conflicting server name \"$domaine\""; then
    rm -f "$cible"
    log "  REFUS Un autre site de cette machine sert déjà ce nom ; le bloc a été retiré."
    return 1
  fi

  systemctl reload nginx || { log "  ERREUR Le rechargement de nginx a échoué."; return 1; }
  return 0
}

retirer_bloc() {
  local cible="$NGINX_DIR/$PREFIX$1.conf"
  [ -e "$cible" ] || return 0
  rm -f "$cible"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
}

bloc_acme() { # domaine — juste de quoi répondre au défi HTTP-01
  cat <<EOF
# Posé par GameDashboard (agent de certificats). Ne pas modifier à la main :
# ce fichier est réécrit à chaque délivrance.
#
# Étape 1 : répondre au défi ACME. Tant qu'il n'y a pas de certificat, ce
# domaine ne peut pas être servi en HTTPS — et le proposer quand même ferait
# tomber les clients du revendeur sur un avertissement.
#
# Le reste reçoit une page d'attente (503, Retry-After), et non la page
# d'erreur nue de nginx ni le panel en clair. Voir PAGE_ATTENTE.
server {
    listen 80;
    listen [::]:80;
    server_name $domaine;
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }

    location / {
        default_type "text/html; charset=utf-8";
        add_header Retry-After 900 always;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'" always;
        return 503 '$PAGE_ATTENTE';
    }
}
EOF
}

bloc_attente() { # domaine — déclaré, pas encore vérifié
  cat <<EOF
# Posé par GameDashboard (agent de certificats). Ne pas modifier à la main :
# ce fichier est retiré dès que le domaine est supprimé ou abandonné, et
# remplacé par le bloc de défi dès qu'il est vérifié.
#
# Domaine déclaré par un revendeur, **pas encore vérifié** : rien ne prouve
# qu'il est à lui. Port 80 seul, sans certificat ni panel : la même page
# d'attente que le bloc de défi, et le défi ACME, inoffensif et prêt pour la
# suite. Nom exact, jamais de serveur par défaut ni de joker.
server {
    listen 80;
    listen [::]:80;
    server_name $domaine;
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }

    location / {
        default_type "text/html; charset=utf-8";
        add_header Retry-After 900 always;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'" always;
        return 503 '$PAGE_ATTENTE';
    }
}
EOF
}

bloc_servi() { # domaine — le domaine est servi en HTTPS
  cat <<EOF
# Posé par GameDashboard (agent de certificats). Ne pas modifier à la main :
# ce fichier est réécrit à chaque délivrance.
server {
    listen 80;
    listen [::]:80;
    server_name $domaine;
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $domaine;
    server_tokens off;

    ssl_certificate     /etc/letsencrypt/live/$domaine/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domaine/privkey.pem;

    # L'interface seule. L'API n'est pas exposée sur le domaine d'un
    # revendeur : ses clients n'ont rien à y appeler directement, et l'ouvrir
    # multiplierait la surface par le nombre de revendeurs.
    #
    # Le lien de connexion de la facturation atterrit ici pour les clients
    # d'un revendeur : son jeton, dans le chemin, vaut une session pendant
    # deux minutes et n'a rien à faire dans le journal d'accès.
    location ~ ^/sso/ {
        access_log off;
        proxy_pass http://127.0.0.1:$PANEL_WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:$PANEL_WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Seul websocket est relayé comme mise à niveau, par les map de
        # panel.conf (même nginx, portée http) : relayer n'importe quel
        # Upgrade ouvrirait la contrebande h2c, comme sur le domaine du panel.
        proxy_set_header Upgrade \$gd_upgrade;
        proxy_set_header Connection \$gd_connection;
    }
}
EOF
}

# ─── Classement des échecs ───────────────────────────────────────────────────
#
# Traduit la sortie de certbot en une phrase qui dit à qui est le problème.
# Recopier le journal brut ne servirait personne : l'administrateur n'a pas à
# lire un journal ACME pour comprendre qu'un revendeur n'a pas posé son A.
classer_echec() { # sortie
  local sortie=$1
  case "$sortie" in
    *"too many certificates"*|*"too many failed authorizations"*|*"rateLimited"*|*"rate limit"*)
      echo "Limite de l'autorité de certification atteinte pour ce domaine. Aucune nouvelle demande n'aboutira avant plusieurs heures ; la prochaine tentative se fera d'elle-même." ;;
    *"DNS problem"*|*"NXDOMAIN"*|*"no valid A records"*|*"could not be resolved"*)
      echo "Le domaine ne résout pas vers cette machine. Le revendeur doit pointer un enregistrement A (ou AAAA) sur l'adresse de la plateforme avant que le certificat puisse être délivré." ;;
    *"Invalid response"*|*"404"*|*"Timeout during connect"*|*"connection refused"*|*"Connection refused"*)
      echo "Le défi HTTP n'a pas abouti : le domaine résout, mais la requête n'est pas arrivée jusqu'ici. Vérifiez qu'aucun proxy ni pare-feu du revendeur ne s'interpose sur le port 80." ;;
    *"CAA"*)
      echo "La zone du domaine interdit à Let's Encrypt d'émettre (enregistrement CAA). Le revendeur doit l'autoriser." ;;
    *"unauthorized"*|*"Unauthorized"*)
      echo "L'autorité a refusé la preuve de possession. Le domaine pointe peut-être encore ailleurs, ou une ancienne réponse est servie en cache." ;;
    *"urn:ietf:params:acme:error:serverInternal"*|*"Internal Server Error"*)
      echo "L'autorité de certification a rencontré une erreur de son côté. La prochaine tentative se fera d'elle-même." ;;
    "")
      echo "certbot n'a rien dit et n'a pas produit de certificat. Consultez /var/log/letsencrypt sur la machine." ;;
    *)
      # Dernier recours : la ligne la plus parlante du journal, plutôt qu'un
      # message vague. Mieux vaut un extrait brut qu'un « échec inconnu ».
      local extrait
      extrait=$(printf '%s' "$sortie" | grep -iE "error|failed|problem" | tail -1 | cut -c1-300)
      echo "Échec non reconnu de certbot : ${extrait:-aucun détail}" ;;
  esac
}

# ─── Traitement d'un domaine ─────────────────────────────────────────────────

traiter() {
  local domaine=$1
  log "Domaine $domaine"

  # Un certificat déjà valide et pas près d'expirer : rien à faire. Le
  # renouvellement est le métier de `certbot.timer`, déjà en place sur cette
  # machine — le refaire ici créerait deux horloges pour une seule échéance.
  if [ -d "/etc/letsencrypt/live/$domaine" ] && [ -z "$ONLY_DOMAIN" ]; then
    local fin
    fin=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$domaine/cert.pem" 2>/dev/null | cut -d= -f2)
    if [ -n "$fin" ] && openssl x509 -checkend $((30 * 86400)) -noout -in "/etc/letsencrypt/live/$domaine/cert.pem" >/dev/null 2>&1; then
      log "  certificat déjà en place, valable au-delà de 30 jours"
      rendre_compte "$domaine" "$(date -Is)" "$(date -Is -d "$fin" 2>/dev/null || echo '')" ""
      return 0
    fi
  fi

  # Étape 1 : de quoi répondre au défi.
  if ! poser_bloc "$domaine" "$(bloc_acme "$domaine")"; then
    rendre_compte "$domaine" "" "" "La configuration du serveur web a été refusée pour ce domaine. C'est un problème de la plateforme, pas du revendeur."
    return 1
  fi

  if [ -n "$DRY_RUN" ]; then
    log "  [essai] appellerait certbot pour $domaine"
    return 0
  fi

  # Étape 2 : la demande.
  local contact=(--register-unsafely-without-email)
  [ -n "$CONTACT" ] && contact=(--email "$CONTACT" --no-eff-email)

  local sortie code
  sortie=$(certbot certonly --webroot -w "$WEBROOT" -d "$domaine" \
    --non-interactive --agree-tos --keep-until-expiring \
    "${contact[@]}" $STAGING 2>&1)
  code=$?

  if [ $code -ne 0 ] || [ ! -d "/etc/letsencrypt/live/$domaine" ]; then
    local motif
    motif=$(classer_echec "$sortie")
    log "  ÉCHEC $motif"
    # Le bloc de défi reste en place : il ne sert rien en HTTPS, ne casse rien,
    # et évite de refaire un aller-retour nginx à la tentative suivante.
    rendre_compte "$domaine" "" "" "$motif"
    return 1
  fi

  # Étape 3 : servir le domaine.
  if ! poser_bloc "$domaine" "$(bloc_servi "$domaine")"; then
    rendre_compte "$domaine" "" "" "Le certificat a été obtenu, mais le serveur web a refusé de le servir. Intervention requise sur la plateforme."
    return 1
  fi

  local fin
  fin=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$domaine/cert.pem" 2>/dev/null | cut -d= -f2)
  log "  certificat délivré, valable jusqu'au ${fin:-?}"
  rendre_compte "$domaine" "$(date -Is)" "$(date -Is -d "$fin" 2>/dev/null || echo '')" ""
  return 0
}

# ─── Domaine déclaré, pas encore vérifié ─────────────────────────────────────

# Rend 0 si un site qui n'est pas à nous sert déjà ce nom (exact, `*.suffixe`,
# `.suffixe`, `préfixe.*` ou expression régulière `~…`), d'après `CONFIG_NGINX` (sortie de `nginx -T`).
# Le nom n'est pas prouvé : sans cette garde, un revendeur qui déclarerait le
# domaine d'un autre site de la machine en capterait le port 80.
nom_servi_ailleurs() { # domaine
  printf '%s' "$CONFIG_NGINX" | python3 -c '
import re, sys
domaine, prefixe = sys.argv[1], sys.argv[2]
fichier = ""
for ligne in sys.stdin.read().splitlines():
    entete = re.match(r"# configuration file (.+):$", ligne)
    if entete:
        fichier = entete.group(1)
        continue
    if fichier.rsplit("/", 1)[-1].startswith(prefixe):
        continue
    directive = re.match(r"\s*server_name\s+([^;#]*)", ligne)
    if not directive:
        continue
    for nom in directive.group(1).split():
        nom = nom.strip("\"\x27")
        if nom.startswith("~"):
            # Expression régulière (PCRE, groupes nommés `(?<nom>` compris).
            # Illisible pour Python : le nom est réputé servi ailleurs plutôt
            # que de risquer de le capter.
            try:
                motif = re.sub(r"\(\?<(?![=!])", "(?P<", nom[1:])
                if re.search(motif, domaine, re.IGNORECASE):
                    raise SystemExit(0)
            except re.error:
                raise SystemExit(0)
            continue
        nom = nom.lower()
        if (nom == domaine
                or (nom.startswith("*.") and domaine.endswith(nom[1:]))
                or (nom.startswith(".") and (domaine == nom[1:] or domaine.endswith(nom)))
                or (nom.endswith(".*") and domaine.startswith(nom[:-1]))):
            raise SystemExit(0)
raise SystemExit(1)
' "$1" "$PREFIX"
}

attendre() { # domaine — pose la page d'attente, sans rien demander à l'autorité
  local domaine=$1
  local cible="$NGINX_DIR/$PREFIX$domaine.conf"
  local contenu
  contenu=$(bloc_attente "$domaine")

  if nom_servi_ailleurs "$domaine"; then
    log "Domaine $domaine (non vérifié) : un autre site de la machine sert ce nom, aucune page d'attente."
    if [ -e "$cible" ] && [ -z "$DRY_RUN" ]; then retirer_bloc "$domaine"; fi
    return 0
  fi

  # Déjà en place à l'identique : aucun rechargement de nginx à chaque tour.
  if [ -e "$cible" ] && [ "$(cat "$cible")" = "$contenu" ]; then
    return 0
  fi

  log "Domaine $domaine (non vérifié) : page d'attente"
  poser_bloc "$domaine" "$contenu" --exclusif
}

# ─── Tour ────────────────────────────────────────────────────────────────────

log "Agent de certificats — début${STAGING:+ (autorité de test)}${DRY_RUN:+ (essai)}"

if [ -n "$ONLY_DOMAIN" ]; then
  domaines=$ONLY_DOMAIN
else
  brut=$(panel GET "/api/v1/application/domains/certificates" "" --code)
  if [ -z "$brut" ]; then
    log "ERREUR Le panel n'a pas répondu."
    exit 4
  fi
  statut=${brut##*$'
'}
  reponse=${brut%$'
'*}

  # Un refus se distingue d'une file vide, et c'est vital : plus bas, les blocs
  # nginx absents de la file sont retirés. Une clé expirée lue comme « zéro
  # domaine » ferait tomber le domaine de chaque revendeur, tous les quarts
  # d'heure, sous la ligne rassurante « Aucun domaine en attente ».
  if [ "$statut" != "200" ]; then
    log "ERREUR Le panel a répondu $statut — la file n'a pas pu être lue."
    log "  La clé de l'agent est peut-être expirée ou révoquée : $KEY_FILE"
    exit 4
  fi

  # Pas de `extraire` ici : son 2>/dev/null rendrait une charge illisible
  # indiscernable d'une file vide, c'est-à-dire exactement le défaut ci-dessus.
  domaines=$(printf '%s' "$reponse" | python3 -c '
import json, sys
lignes = json.load(sys.stdin)["data"]
if not isinstance(lignes, list):
    raise SystemExit(1)
for ligne in lignes:
    # `verified` absent : panel plus ancien, qui ne rend que des domaines vérifiés.
    if ligne.get("pending") and ligne.get("verified", True) is True:
        print(ligne["domain"])
') || {
    log "ERREUR Le panel a répondu autre chose qu'une file de domaines."
    exit 4
  }

  # Les domaines déclarés pas encore vérifiés : page d'attente seulement.
  en_attente=$(printf '%s' "$reponse" | python3 -c '
import json, sys
for ligne in json.load(sys.stdin)["data"]:
    if ligne.get("verified", True) is False and not ligne.get("pending"):
        print(ligne["domain"])
') || {
    log "ERREUR Le panel a répondu autre chose qu'une file de domaines."
    exit 4
  }

  if [ -z "$domaines" ]; then
    # Les domaines retirés du panel gardent sinon leur bloc nginx pour
    # toujours : un nom qui ne nous appartient plus continuerait d'être servi.
    log "Aucun domaine en attente."
  fi
fi

# Les blocs orphelins sont retirés : un domaine qu'un revendeur a supprimé ne
# doit plus être servi par cette machine.
if [ -z "$ONLY_DOMAIN" ] && [ -n "${reponse:-}" ]; then
  connus=$(printf '%s' "$reponse" | python3 -c '
import json, sys
for ligne in json.load(sys.stdin)["data"]:
    print(ligne["domain"])
') || {
    log "ERREUR La liste des domaines est illisible — aucun bloc n'est retiré."
    exit 4
  }
  for fichier in "$NGINX_DIR/$PREFIX"*.conf; do
    [ -e "$fichier" ] || continue
    nom=$(basename "$fichier" .conf)
    nom=${nom#"$PREFIX"}
    if ! printf '%s\n' "$connus" | grep -qx "$nom"; then
      log "Bloc orphelin retiré : $nom"
      [ -z "$DRY_RUN" ] && retirer_bloc "$nom"
    fi
  done
fi

echecs=0
for domaine in $domaines; do
  traiter "$domaine" || echecs=$((echecs + 1))
done

# Après les domaines vérifiés. Le cycle de vie tient dans le nom du fichier,
# le même pour les trois blocs : vérifié, le domaine sort de cette liste et
# reçoit le bloc de défi ; supprimé ou abandonné (le panel ne le rend plus),
# son bloc est retiré avec les orphelins, plus haut.
if [ -n "${en_attente:-}" ]; then
  if CONFIG_NGINX=$(nginx -T 2>/dev/null); then
    for domaine in $en_attente; do
      # Le panel a déjà filtré ; ce nom devient un nom de fichier et un
      # server_name, il est donc recontrôlé ici.
      if ! [[ $domaine =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
        log "Domaine ignoré, nom invalide : $domaine"
        continue
      fi
      attendre "$domaine" || echecs=$((echecs + 1))
    done
  else
    # Sans la configuration entière, rien ne dit qu'un autre site ne sert pas
    # déjà ces noms : on s'abstient.
    log "ATTENTION nginx -T a échoué : aucune page d'attente posée à ce tour."
  fi
fi

log "Agent de certificats — fin ($echecs échec(s))"
# Le code de sortie ne signale que les pannes de l'agent, pas les refus de
# l'autorité : un domaine mal pointé n'est pas un incident d'exploitation, et
# faire hurler systemd chaque quart d'heure pour cela ferait ignorer l'alarme.
exit 0
