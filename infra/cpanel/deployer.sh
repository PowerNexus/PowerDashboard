#!/usr/bin/env bash
#
# Met à jour GameDashboard sur un hébergement cPanel, à partir de la
# construction publiée par .github/workflows/deploiement.yml.
#
# Première fois (voir docs/hebergement-cpanel.md) :
#
#   curl -fsSL https://github.com/PowerNexus/PowerDashboard/releases/download/continu/deployer.sh | bash
#
# Ensuite, par cron, toutes les cinq minutes :
#
#   bash $HOME/gamedashboard/actuelle/infra/cpanel/deployer.sh >> $HOME/gamedashboard/journal/deployer.log 2>&1
#
# Rien n'est construit ici. L'interface l'est par le runner, une fois, pour
# tous : un hébergement mutualisé n'a ni la mémoire ni le temps que demande
# `next build`. Ce script télécharge l'archive, en vérifie l'empreinte,
# installe les dépendances aux versions du lockfile, joue les migrations,
# puis bascule le lien `actuelle` et redémarre les deux applications
# Passenger. Tant que la bascule n'a pas eu lieu, la version en service n'est
# pas touchée : un échec en cours de route la laisse tourner.
#
# Sans nouveauté, il sort sans rien écrire : une ligne par passage de cron
# noierait le journal.
#
# Tout le corps est dans une fonction : bash lit un script au fil de
# l'exécution, et celui-ci peut être remplacé par la version qu'il installe.
set -euo pipefail

principal() {
  # Lancé par `curl … | bash`, l'entrée standard est le script lui-même :
  # aucune commande d'ici n'a à la lire.
  exec </dev/null

  local racine=${GAMEDASHBOARD_RACINE:-$HOME/gamedashboard}
  local source=${GAMEDASHBOARD_SOURCE:-https://github.com/PowerNexus/PowerDashboard/releases/download/continu}
  # Versions gardées sur le disque en plus de celle en service : de quoi
  # revenir en arrière d'un `ln -sfn`, sans remplir l'espace de l'hébergement.
  local garder=${GAMEDASHBOARD_GARDER:-2}

  # La racine se traverse sans se lister : Apache doit pouvoir atteindre les
  # racines d'application Passenger. Réglages et journaux restent au compte.
  install -d -m 711 "$racine"
  install -d -m 700 "$racine/env" "$racine/journal"
  install -d -m 755 "$racine/versions" "$racine/bin"

  # Un seul passage à la fois : une installation peut durer plus longtemps
  # que l'intervalle du cron.
  exec 9>"$racine/.deployer.verrou"
  if command -v flock >/dev/null && ! flock -n 9; then
    exit 0
  fi

  local reglage
  for reglage in api.env web.env; do
    [ -f "$racine/env/$reglage" ] || {
      dire "Réglages absents : $racine/env/$reglage (docs/hebergement-cpanel.md, étape 3)"
      exit 1
    }
  done

  preparer_node "$racine"

  local attendue
  attendue=$(curl -fsSL --retry 3 --max-time 60 "$source/gamedashboard.tar.gz.sha256" | cut -d' ' -f1)
  [[ $attendue =~ ^[0-9a-f]{64}$ ]] || {
    dire "Empreinte illisible depuis $source"
    exit 1
  }

  if [ -f "$racine/actuelle/.empreinte" ] && [ "$(cat "$racine/actuelle/.empreinte")" = "$attendue" ]; then
    exit 0
  fi

  local id=${attendue:0:12}
  local version="$racine/versions/$id"
  dire "Nouvelle construction : $id"

  if [ ! -f "$version/.installee" ]; then
    local archive="$racine/versions/.$id.tar.gz"
    curl -fsSL --retry 3 --max-time 900 -o "$archive" "$source/gamedashboard.tar.gz"
    # L'empreinte est celle publiée avec l'archive : elle ne protège pas d'un
    # dépôt compromis, mais d'un téléchargement tronqué ou mélangé à une
    # construction plus récente publiée entre les deux requêtes.
    if [ "$(sha256sum "$archive" | cut -d' ' -f1)" != "$attendue" ]; then
      rm -f "$archive"
      dire "Empreinte différente : téléchargement abandonné, nouvel essai au prochain passage"
      exit 1
    fi

    rm -rf "$version"
    install -d -m 755 "$version"
    tar -xzf "$archive" -C "$version" --strip-components=1 --no-same-owner
    rm -f "$archive"

    dire "Dépendances"
    epingler_pnpm "$version"
    (cd "$version" && CI=1 pnpm install --frozen-lockfile)
    echo "$attendue" >"$version/.empreinte"
    touch "$version/.installee"
  fi

  dire "Migrations"
  epingler_pnpm "$version"
  # Seule la variable dont la migration a besoin est passée : exporter tout
  # api.env donnerait la clé de chiffrement à l'arbre de processus de pnpm.
  local base
  base=$(lire_reglage "$racine/env/api.env" DATABASE_URL)
  [ -n "$base" ] || {
    dire "DATABASE_URL absent de $racine/env/api.env"
    exit 1
  }
  (cd "$version" && DATABASE_URL=$base pnpm --filter @gamedashboard/db db:migrate)
  # drizzle-kit finit sans retour à la ligne.
  echo

  poser_passenger "$racine"

  # Bascule atomique : `mv -T` remplace le lien d'un seul geste, jamais de
  # moment où `actuelle` n'existe pas.
  ln -sfn "versions/$id" "$racine/.actuelle.nouvelle"
  mv -Tf "$racine/.actuelle.nouvelle" "$racine/actuelle"

  # Passenger relance une application dont `tmp/restart.txt` a changé, à la
  # requête suivante ; le cron de maintien en éveil la fait venir.
  touch "$racine/passenger/api/tmp/restart.txt" "$racine/passenger/interface/tmp/restart.txt"
  dire "En service : $id ($(sed -n 's/^commit=//p' "$version/RELEASE"))"

  nettoyer "$racine" "$id" "$garder"
}

dire() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

# Node 24 et le pnpm épinglé du projet (`packageManager`).
#
# CloudLinux range chaque version de Node sous /opt/alt, hors du PATH d'une
# tâche cron. pnpm passe par corepack, livré avec Node 24 : la version vient
# de package.json, jamais de ce qui traînerait sur la machine. Le relais
# `bin/pnpm` sert aussi aux commandes que pnpm relance lui-même.
preparer_node() {
  local racine=$1
  local dossier
  for dossier in "${GAMEDASHBOARD_NODE:-}" /opt/alt/alt-nodejs24/root/usr/bin; do
    if [ -n "$dossier" ] && [ -x "$dossier/node" ]; then
      PATH="$dossier:$PATH"
      break
    fi
  done
  command -v node >/dev/null || {
    dire "Node introuvable : régler GAMEDASHBOARD_NODE"
    exit 1
  }
  local majeure
  majeure=$(node -p 'process.versions.node.split(".")[0]')
  [ "$majeure" -ge 24 ] || {
    dire "Node $majeure trouvé, 24 attendu : régler GAMEDASHBOARD_NODE"
    exit 1
  }

  if [ -z "${GAMEDASHBOARD_PNPM:-}" ]; then
    # Sans corepack (certaines éditions de Node chez CloudLinux), npx prend
    # la même version épinglée.
    cat >"$racine/bin/pnpm" <<'RELAIS'
#!/bin/sh
command -v corepack >/dev/null 2>&1 && exec corepack pnpm "$@"
exec npx --yes "pnpm@${GAMEDASHBOARD_VERSION_PNPM:?}" "$@"
RELAIS
    chmod 755 "$racine/bin/pnpm"
    PATH="$racine/bin:$PATH"
  fi
  export PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
}

# La version de pnpm que la version installée déclare (`packageManager`).
epingler_pnpm() {
  GAMEDASHBOARD_VERSION_PNPM=$(node -p 'require(process.argv[1]).packageManager.replace(/^pnpm@/, "").split("+")[0]' "$1/package.json")
  export GAMEDASHBOARD_VERSION_PNPM
}

# Lit une variable d'un fichier de réglages sans l'exécuter : `source`
# lancerait tout ce qu'une ligne du fichier contiendrait.
lire_reglage() {
  node -e 'process.loadEnvFile(process.argv[1]); process.stdout.write(process.env[process.argv[2]] ?? "")' "$1" "$2"
}

# Les racines d'application que cPanel connaît : fixes, et réduites à une
# ligne qui charge la version active (voir infra/cpanel/emplacements.cjs).
poser_passenger() {
  local racine=$1 nom
  for nom in api interface; do
    install -d -m 755 "$racine/passenger/$nom" "$racine/passenger/$nom/tmp"
    printf '%s\n%s\n' \
      "// Écrit par infra/cpanel/deployer.sh : tout le reste suit la version active." \
      "require(\"../../actuelle/infra/cpanel/$nom.cjs\");" >"$racine/passenger/$nom/app.cjs"
  done
}

# Efface les versions les plus anciennes, jamais celle en service.
nettoyer() {
  local racine=$1 actuelle=$2 garder=$3 dossier compte=0
  while IFS= read -r dossier; do
    [ "$(basename "$dossier")" = "$actuelle" ] && continue
    compte=$((compte + 1))
    [ "$compte" -le "$garder" ] && continue
    rm -rf "$dossier"
  done < <(find "$racine/versions" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}

principal "$@"
