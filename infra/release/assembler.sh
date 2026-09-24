#!/usr/bin/env bash
#
# Assemble l'archive d'une version publiée : le code du dépôt **et**
# l'interface déjà construite.
#
#   bash infra/release/assembler.sh v1.2.0 [dossier-de-sortie]
#
# Lancé par .github/workflows/release.yml sur chaque étiquette `v*`, et
# utilisable tel quel en local pour reproduire une archive.
#
# Pourquoi livrer l'interface construite : la construction de Next est
# l'étape la plus lourde d'une installation — plus d'un gigaoctet et demi
# de mémoire, plusieurs minutes. Faite une fois ici, elle épargne à chaque
# serveur le fichier d'échange et l'attente. deploy.sh reconnaît l'archive à
# son fichier RELEASE et saute alors la construction.
#
# Ce qui n'est **pas** dans l'archive : node_modules. Certaines dépendances
# ont une partie native (argon2) compilée pour le système qui les installe ;
# `pnpm install --frozen-lockfile` les pose sur le serveur, aux versions
# exactes du lockfile.
#
# L'archive part de `git archive`, pas du dossier de travail : un fichier
# non suivi (un .env oublié, un build local) ne peut pas s'y glisser.
set -euo pipefail

VERSION=${1:?Usage : assembler.sh <version, ex. v1.2.0> [dossier de sortie]}
SORTIE=${2:-dist}
RACINE=$(git rev-parse --show-toplevel)
NOM=gamedashboard-$VERSION
cd "$RACINE"

[[ $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || { echo "Version invalide : $VERSION (attendu : v1.2.3 ou v1.2.3-rc.1)" >&2; exit 1; }

# L'interface doit avoir été construite depuis ce commit-ci, en production.
# Une construction de développement, ou restée d'une autre branche,
# partirait sinon sur les serveurs.
BUILD_ID=apps/web/.next/BUILD_ID
[ -f "$BUILD_ID" ] || { echo "Interface non construite : lancer d'abord pnpm build" >&2; exit 1; }
[ -f apps/web/.next/prerender-manifest.json ] \
  || { echo "apps/web/.next n'est pas une construction de production (next build)" >&2; exit 1; }
# next-env.d.ts est réécrit par `next build` lui-même : l'exclure, sans quoi
# toute construction rendrait l'arbre « modifié ».
PROPRE=(-- . ':!apps/web/next-env.d.ts')
if [ -n "$(git status --porcelain --untracked-files=no "${PROPRE[@]}")" ]; then
  echo "Des fichiers suivis sont modifiés : l'archive ne correspondrait à aucun commit." >&2
  git status --short --untracked-files=no "${PROPRE[@]}" >&2
  exit 1
fi

TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT
mkdir -p "$TRAVAIL/$NOM" "$SORTIE"

git archive --format=tar HEAD | tar -x -C "$TRAVAIL/$NOM"

# Le cache de Next ne sert qu'à accélérer une reconstruction : il pèse
# souvent plus lourd que la construction elle-même. `.next/dev` est celui du
# serveur de développement : absent d'une copie neuve, mais un assemblage
# local depuis un poste de travail l'emportait (près de 300 Mo).
tar -C apps/web --exclude=.next/cache --exclude=.next/dev -cf - .next \
  | tar -x -C "$TRAVAIL/$NOM/apps/web"

# La carte d'identité de l'archive. deploy.sh s'y fie pour sauter la
# construction ; un humain, pour savoir ce qui tourne.
cat > "$TRAVAIL/$NOM/RELEASE" <<EOF
version=$VERSION
commit=$(git rev-parse HEAD)
date=$(git show -s --format=%cI HEAD)
node=$(node -v)
build_id=$(cat "$BUILD_ID")
EOF

# Archive reproductible : dates, propriétaires et ordre fixés, pour que deux
# assemblages du même commit donnent la même empreinte.
DATE=$(git show -s --format=%ct HEAD)
tar --sort=name --mtime="@$DATE" --owner=0 --group=0 --numeric-owner \
  -C "$TRAVAIL" -cf - "$NOM" | gzip -n -9 > "$SORTIE/$NOM.tar.gz"

( cd "$SORTIE" && sha256sum "$NOM.tar.gz" > "$NOM.tar.gz.sha256" )

# Le script d'une machine de jeu se copie seul, sans le reste : il est
# publié à côté de l'archive pour être téléchargé directement.
install -m 755 infra/prod/installer-wings.sh "$SORTIE/installer-wings.sh"
( cd "$SORTIE" && sha256sum installer-wings.sh > installer-wings.sh.sha256 )

# La ligne de commande, publiée seule sous un nom sans version : c'est elle
# que télécharge `curl …/releases/latest/download/gamedashboard.sh | bash`.
install -m 755 infra/prod/app.sh "$SORTIE/gamedashboard.sh"
( cd "$SORTIE" && sha256sum gamedashboard.sh > gamedashboard.sh.sha256 )

echo "Archive : $SORTIE/$NOM.tar.gz ($(du -h "$SORTIE/$NOM.tar.gz" | cut -f1))"
cat "$SORTIE/$NOM.tar.gz.sha256"
