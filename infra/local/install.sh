#!/usr/bin/env bash
#
# GameDashboard — met en place la production **locale**, sur Codiax (WSL).
#
# Le but n'est pas un second serveur de développement : c'est la production,
# répétée à l'identique sur la machine. Même `NODE_ENV`, même construction,
# mêmes ports, même nginx devant, même base PostgreSQL. Ce qui se comporte
# autrement ici se comportera autrement là-bas, et c'est justement ce qu'on
# veut voir avant de livrer.
#
# Trois divergences assumées avec `infra/prod`, et trois seulement :
#
#   1. **Pas de systemd.** WSL n'en a pas. Les trois processus sont pilotés par
#      `infra/local/panel`, qui fait le même travail en plus modeste.
#   2. **Tout tourne en root.** La production crée un compte système sans
#      shell ; ici, le seul utilisateur est root et un second compte
#      n'isolerait de personne.
#   3. **TLS par mkcert**, et non par une autorité publique — il n'en existe
#      aucune qui signe un nom en `.local`. L'autorité est celle que mkcert a
#      posée sur cette machine, la même que pour les autres sites locaux.
#
# Idempotent : on peut le relancer à chaque fois. Les secrets déjà écrits sont
# conservés — régénérer la clé de chiffrement rendrait illisibles les jetons de
# node et les mots de passe de bases déjà stockés.
#
# Le serveur de développement n'est pas touché : il écoute sur 3000, la
# production locale sur 3210 et 3211.

set -euo pipefail

# /usr/sbin n'est pas dans le PATH d'un shell non interactif, et c'est là que
# vivent nginx et ss. Le poser ici évite un « command not found » qui
# ressemblerait à un paquet manquant — c'est exactement ce qui m'a fait croire
# que nginx n'était pas installé.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ROOT=/opt/gamedashboard
APP=$ROOT/app
ENVDIR=$ROOT/env
DOMAIN=gamedashboard.local
ORIGIN=https://$DOMAIN
CERTS=/etc/nginx/certs
WEB_PORT=3210
API_PORT=3211

# L'arbre de travail, d'où la production est copiée.
#
# Il vivait sur /mnt/c, et la copie servait alors surtout à fuir DrvFs. Le
# dépôt est depuis dans le système de fichiers de WSL, et la copie garde sa
# raison propre : la production se construit depuis un état figé. Construire
# dans l'arbre de travail y ferait entrer, à moitié, une modification faite
# pendant la construction.
SRC=${GD_SRC:-/root/workspace/GameDashboard}

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
say "Vérifications"
# ---------------------------------------------------------------------------
[ -d "$SRC" ] || { echo "Source introuvable : $SRC"; exit 1; }

manquant=""
for outil in node pnpm psql rsync mkcert; do
  command -v "$outil" >/dev/null 2>&1 || manquant="$manquant $outil"
done
command -v nginx >/dev/null 2>&1 || {
  echo "  nginx absent — installation"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx >/dev/null
}
[ -z "$manquant" ] || { echo "Outils manquants :$manquant"; exit 1; }

# La version de pnpm doit être celle que le dépôt épingle : deux résolutions
# différentes du même lockfile produisent deux arbres différents.
epingle=$(grep -o '"packageManager": *"pnpm@[^"]*"' "$SRC/package.json" | sed 's/.*pnpm@//;s/"//')
installe=$(pnpm -v)
[ "$epingle" = "$installe" ] || echo "  ATTENTION pnpm $installe installé, $epingle épinglé"
printf '  node %s · pnpm %s · %s\n' "$(node -v)" "$installe" "$(psql --version)"

# ---------------------------------------------------------------------------
say "Base de données"
# ---------------------------------------------------------------------------
service postgresql start >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  sudo -u postgres psql -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

install -d -m 700 "$ENVDIR"
DBPASS_FILE=$ENVDIR/.dbpass
if [ ! -f "$DBPASS_FILE" ]; then
  openssl rand -base64 33 | tr -d '\n/+=' > "$DBPASS_FILE"
  chmod 600 "$DBPASS_FILE"
fi
DBPASS=$(cat "$DBPASS_FILE")

# Le SQL passe par l'entrée standard, jamais en argument : un argument de
# commande est lisible dans `ps` par tout utilisateur le temps de l'exécution.
sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='gamedashboard'" | grep -q 1 \
  || printf "create role gamedashboard login password '%s'" "$DBPASS" | sudo -u postgres psql -q
printf "alter role gamedashboard password '%s'" "$DBPASS" | sudo -u postgres psql -q

sudo -u postgres psql -tAc "select 1 from pg_database where datname='gamedashboard'" | grep -q 1 \
  || sudo -u postgres createdb -O gamedashboard gamedashboard
echo "  rôle et base en place"

# ---------------------------------------------------------------------------
say "Environnement"
# ---------------------------------------------------------------------------
if [ ! -f "$ENVDIR/api.env" ]; then
  cat > "$ENVDIR/api.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgres://gamedashboard:$DBPASS@127.0.0.1:5432/gamedashboard
APP_SECRET_KEY=$(openssl rand -base64 48)
PORT=$API_PORT
HOST=127.0.0.1
PANEL_ORIGIN=$ORIGIN
CURSEFORGE_API_KEY=
EOF
else
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://gamedashboard:$DBPASS@127.0.0.1:5432/gamedashboard#" "$ENVDIR/api.env"
  # L'origine se réaffirme à chaque passage : elle sert de référence au
  # contrôle d'origine des WebSockets, à CORS et à l'identifiant de partie
  # vérifiante des clés d'accès. La laisser sur un ancien nom donnerait une
  # console muette et des clés d'accès refusées, sans message qui l'explique.
  sed -i "s#^PANEL_ORIGIN=.*#PANEL_ORIGIN=$ORIGIN#" "$ENVDIR/api.env"
fi

# L'interface n'a ni DATABASE_URL ni APP_SECRET_KEY : elle lit tout par l'API,
# avec le cookie de l'utilisateur.
cat > "$ENVDIR/web.env" <<EOF
NODE_ENV=production
PORT=$WEB_PORT
HOSTNAME_BIND=127.0.0.1
API_URL=http://127.0.0.1:$API_PORT
PANEL_ORIGIN=$ORIGIN
EOF
chmod 600 "$ENVDIR"/*.env
echo "  api.env et web.env prêts"

# ---------------------------------------------------------------------------
say "Copie de la source"
# ---------------------------------------------------------------------------
install -d "$APP"
# `--delete` pour que la copie soit un miroir : un fichier supprimé dans
# l'arbre de travail doit disparaître ici, sinon un ancien module continuerait
# d'être construit. Les artefacts restent locaux et ne sont pas écrasés à chaque fois.
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude dist --exclude .turbo --exclude .git \
  "$SRC/" "$APP/"
echo "  $(find "$APP" -type f | wc -l) fichiers"

# ---------------------------------------------------------------------------
say "Dépendances et construction"
# ---------------------------------------------------------------------------
cd "$APP"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@gamedashboard/web

# ---------------------------------------------------------------------------
say "Migrations"
# ---------------------------------------------------------------------------
# Seule la variable dont la migration a besoin est passée : exporter tout
# api.env donnerait la clé de chiffrement à l'arbre de processus de pnpm.
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENVDIR/api.env" | cut -d= -f2-)" \
  pnpm --filter @gamedashboard/db db:migrate

# ---------------------------------------------------------------------------
say "Certificat"
# ---------------------------------------------------------------------------
# Aucune autorité publique ne signe un nom en `.local` : le certificat vient de
# mkcert, dont l'autorité est déjà installée sur cette machine.
#
# Le joker est inclus exprès : les domaines de revendeurs se testent ainsi sans
# émettre un second certificat à chaque essai.
install -d -m 755 "$CERTS"
if [ ! -f "$CERTS/$DOMAIN.pem" ]; then
  ( cd "$CERTS" && mkcert -cert-file "$DOMAIN.pem" -key-file "$DOMAIN-key.pem" \
      "$DOMAIN" "*.$DOMAIN" localhost 127.0.0.1 ::1 >/dev/null 2>&1 )
  chmod 644 "$CERTS/$DOMAIN.pem"
  chmod 640 "$CERTS/$DOMAIN-key.pem"
  echo "  certificat émis"
else
  echo "  certificat déjà en place"
fi
printf '  expire le %s\n' "$(openssl x509 -in "$CERTS/$DOMAIN.pem" -noout -enddate | cut -d= -f2)"

# ---------------------------------------------------------------------------
say "Résolution du nom"
# ---------------------------------------------------------------------------
# Côté Linux seulement. WSL recopie le fichier `hosts` de Windows dans le sien
# à chaque démarrage : la ligne posée ici disparaîtra au prochain, et celle de
# Windows prendra le relais — une fois ajoutée, elle sert les deux côtés. Sans
# elle, rien ne résout `.local`, ni ici ni dans le navigateur.
if ! getent hosts "$DOMAIN" >/dev/null; then
  printf '127.0.0.1\t%s\n' "$DOMAIN" >> /etc/hosts
  echo "  ajouté au /etc/hosts de Codiax"
else
  echo "  déjà résolu : $(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)"
fi

# ---------------------------------------------------------------------------
say "nginx"
# ---------------------------------------------------------------------------
install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m 644 "$APP/infra/local/$DOMAIN.conf" /etc/nginx/sites-available/
ln -sfn "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
# Le site par défaut d'Ubuntu écoute aussi sur 80 et répondrait à la place du
# nôtre pour tout nom inconnu. Il est retiré du lien, pas supprimé.
rm -f /etc/nginx/sites-enabled/default
# L'ancien vhost en clair, s'il traîne : deux blocs revendiquant le port 80
# pour le même nom, c'est le premier lu qui gagne — donc une redirection qui
# fonctionne ou non selon l'ordre alphabétique.
rm -f /etc/nginx/sites-enabled/gamedashboard.localhost.conf
nginx -t
echo "  vhost $DOMAIN posé"

# ---------------------------------------------------------------------------
say "Démarrage"
# ---------------------------------------------------------------------------
install -m 755 "$APP/infra/local/panel" /usr/local/bin/panel
panel restart

# ---------------------------------------------------------------------------
say "Premier administrateur"
# ---------------------------------------------------------------------------
# Une base fraîche n'a aucun compte, et rien dans le panel ne promeut le
# premier inscrit : sans cette étape, la production locale s'installe
# parfaitement et personne ne peut y entrer.
#
# Le compte passe par la **vraie route d'inscription** : c'est le code de
# l'application qui hache le mot de passe. L'écrire ici demanderait de
# reproduire son algorithme, et cette copie divergerait au premier changement.
# Seule la promotion en administrateur se fait en SQL, parce qu'aucune route ne
# l'offre — par construction.
COMPTES=$(sudo -u postgres psql -d gamedashboard -tAc 'select count(*) from users')
if [ "$COMPTES" = "0" ]; then
  ADMIN_EMAIL=${GD_ADMIN_EMAIL:-admin@gamedashboard.localhost}
  # Aléatoire pur, sans préfixe lisible.
  #
  # Le premier essai valait « Local-… » — refusé par la politique du panel,
  # qui interdit qu'un mot de passe contienne le nom du compte. Elle avait
  # raison : ce contrôle existe précisément pour les mots de passe fabriqués
  # à partir de ce qu'on connaît déjà de la personne.
  ADMIN_PASS=$(openssl rand -base64 24 | tr -d '/+=\n')

  # Les inscriptions sont **fermées par défaut**, et c'est le bon réglage : un
  # panel qui s'installe avec sa page d'inscription ouverte au monde est un
  # panel dont le premier compte n'est pas forcément le vôtre. On ouvre donc le
  # temps d'un appel, et on referme aussitôt — y compris si l'inscription
  # échoue, sinon une panne laisserait la porte ouverte derrière elle.
  ouvrir() {
    sudo -u postgres psql -d gamedashboard -q -c \
      "insert into settings (key, value) values ('security.registrationOpen', '$1'::jsonb)
       on conflict (key) do update set value = '$1'::jsonb, updated_at = now()"
  }
  ouvrir true
  trap 'ouvrir false' EXIT

  code=$(curl -s -o /tmp/gd-admin.json -w '%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"nameFirst\":\"Admin\",\"nameLast\":\"Local\",\"password\":\"$ADMIN_PASS\"}" \
    "http://127.0.0.1:$API_PORT/api/v1/auth/register")

  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    sudo -u postgres psql -d gamedashboard -q \
      -c "update users set role = 'admin', email_verified_at = now() where lower(email) = lower('$ADMIN_EMAIL')"
    echo "  compte créé et promu administrateur"
    echo
    printf '    identifiant : %s\n' "$ADMIN_EMAIL"
    printf '    mot de passe : %s\n' "$ADMIN_PASS"
    echo
    echo "    (affiché une seule fois — il n'est stocké nulle part en clair)"
  else
    echo "  ÉCHEC inscription refusée ($code) : $(head -c 200 /tmp/gd-admin.json)"
  fi
  rm -f /tmp/gd-admin.json
  ouvrir false
  trap - EXIT
  echo "  inscriptions refermées"
else
  echo "  $COMPTES compte(s) déjà en base — rien à créer"
fi

# ---------------------------------------------------------------------------
say "Contrôle de bon fonctionnement"
# ---------------------------------------------------------------------------
# Une construction qui réussit ne prouve pas qu'une page s'affiche : la
# frontière d'erreur de Next rend son écran « Une erreur est survenue » avec
# un **200**. On exige donc, pour chaque page, ce qu'elle doit montrer.
#
# Et on interroge par **le domaine**, pas par 127.0.0.1 : c'est aussi nginx et
# la résolution du nom qu'on vérifie ici.
ECHECS=0
# `--cacert` plutôt que `-k` : on veut savoir si le certificat est **valide**
# pour l'autorité mkcert, pas seulement qu'un TLS quelconque répond. `-k`
# accepterait un certificat expiré, ou émis pour un autre nom, sans rien dire.
CA=$(mkcert -CAROOT)/rootCA.pem
page() {
  local chemin=$1 attendu=$2 marqueur=$3 corps code
  corps=$(mktemp)
  code=$(curl -s --cacert "$CA" -o "$corps" -w '%{http_code}' --max-time 30 "$ORIGIN$chemin") || code=000
  if [ "$code" != "$attendu" ]; then
    printf '  %-28s %s  ATTENDU %s\n' "$chemin" "$code" "$attendu"; ECHECS=$((ECHECS + 1))
  # Texte rendu, pas le catalogue de traductions embarqué en JSON dans
  # chaque page : voir le même contrôle dans infra/prod/deploy.sh.
  elif grep -q ">Une erreur est survenue<" "$corps"; then
    printf '  %-28s %s  FRONTIERE D ERREUR\n' "$chemin" "$code"; ECHECS=$((ECHECS + 1))
  elif [ -n "$marqueur" ] && ! grep -q "$marqueur" "$corps"; then
    printf '  %-28s %s  CONTENU ABSENT (%s)\n' "$chemin" "$code" "$marqueur"; ECHECS=$((ECHECS + 1))
  else
    printf '  %-28s %s\n' "$chemin" "$code"
  fi
  rm -f "$corps"
}

# La redirection depuis le clair d'abord : c'est elle qui rend le nom canonique
# unique. Sans elle, une session ouverte sur un second nom donnerait une
# console muette, sans message qui l'explique.
clair=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$DOMAIN/login") || clair=000
if [ "$clair" = "301" ]; then
  printf '  %-28s %s\n' "http -> https" "$clair"
else
  printf '  %-28s %s  ATTENDU 301\n' "http -> https" "$clair"
  ECHECS=$((ECHECS + 1))
fi

page /api/v1/status 200 ''
page /login         200 'name="email"'
page /status        200 'Statut de la plateforme'
page /              307 ''

echo
if [ "$ECHECS" -eq 0 ]; then
  printf '\033[32m  Production locale en place : %s\033[0m\n' "$ORIGIN"
else
  printf '\033[31m  %s contrôle(s) en échec — voir panel logs api\033[0m\n' "$ECHECS"
  exit 1
fi
