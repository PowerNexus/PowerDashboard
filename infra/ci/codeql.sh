#!/usr/bin/env bash
# Analyse CodeQL du dépôt, dans le conteneur Linux du job (codeql.yml).
#
#   bash infra/ci/codeql.sh <dossier de sortie>
#
# Écrit un fichier SARIF par langage (`javascript.sarif`, `actions.sarif`),
# que le workflow téléverse ensuite vers GitHub depuis le runner.
#
# Pourquoi pas la « configuration par défaut » de GitHub : elle réclame un
# runner hébergé (`ubuntu-latest`), que le dépôt n'obtient plus ; ses deux
# exécutions du 22/09/2026 ont échoué en deux secondes, sans journal. Et
# `github/codeql-action/init` tournerait directement sur le runner Windows,
# alors que tout job du projet travaille dans un conteneur Linux
# (docs/runner-auto-heberge.md). Le CLI tourne donc ici, et seul le
# téléversement (un appel d'API) reste sur le runner, où est le jeton.
set -euo pipefail

sortie=${1:?"usage : codeql.sh <dossier de sortie>"}
source infra/ci/outils.env

# Le cache `gd-ci-codeql` (monté sur /codeql par `linux.sh ouvrir --codeql`)
# ne garde que l'**archive**, jamais le CLI extrait : un fichier du cache
# n'est cru qu'après vérification de son empreinte, **à chaque job**. Un CLI
# gardé tout prêt ne serait vérifié qu'au téléchargement, et ce qu'un job
# précédent y aurait changé s'exécuterait ici sans que rien ne le voie.
archive=/codeql/codeql-bundle-$CODEQL_VERSION-linux64.tar.gz
verifier() { echo "$CODEQL_SHA256  $1" | sha256sum -c --quiet - >/dev/null 2>&1; }
if ! verifier "$archive"; then
  # Nom propre au conteneur, puis renommage : deux jobs simultanés ne
  # s'écrivent pas dessus, et un téléchargement coupé ne passe jamais pour
  # l'archive.
  partiel=$(mktemp /codeql/.telechargement-XXXXXX)
  curl -fsSL --retry 3 -o "$partiel" \
    "https://github.com/github/codeql-action/releases/download/codeql-bundle-v$CODEQL_VERSION/codeql-bundle-linux64.tar.gz"
  # Épinglée comme les images : une archive remplacée sous le même nom ne
  # s'exécute pas.
  if ! verifier "$partiel"; then
    rm -f "$partiel"
    echo "::error::L'archive de CodeQL $CODEQL_VERSION ne correspond pas à CODEQL_SHA256 (infra/ci/outils.env)." >&2
    exit 1
  fi
  mv -f "$partiel" "$archive"
  # Les autres versions ne servent plus, ni ce qu'un job coupé a laissé il y
  # a plus d'une heure (le téléchargement en cours d'un autre job reste).
  find /codeql -mindepth 1 -maxdepth 1 ! -name "${archive##*/}" ! -name '.telechargement-*' -exec rm -rf {} +
  find /codeql -mindepth 1 -maxdepth 1 -name '.telechargement-*' -mmin +60 -exec rm -rf {} +
fi
# Extraite dans le conteneur du job, qui disparaît avec lui, depuis une
# archive tout juste vérifiée.
outils=$(mktemp -d)
tar -xzf "$archive" -C "$outils"
codeql=$outils/codeql/codeql
"$codeql" version --format=terse

# TypeScript et JavaScript sans compilation (`--build-mode=none`), comme la
# configuration par défaut ; `actions` relit les workflows eux-mêmes
# (injection d'expressions, permissions, actions non épinglées).
# node_modules est écarté d'office par l'extracteur.
langages=(javascript-typescript actions)
base=$(mktemp -d)
"$codeql" database create "$base" --db-cluster --overwrite \
  --language="$(IFS=,; echo "${langages[*]}")" --build-mode=none \
  --source-root=. --threads=0

mkdir -p "$sortie"
for langage in "${langages[@]}"; do
  # Le dossier de la base et la catégorie portent le nom court (javascript),
  # celui que GitHub affiche pour cette analyse.
  court=${langage%%-*}
  "$codeql" database analyze "$base/$court" --threads=0 \
    --format=sarif-latest --output="$sortie/$court.sarif" \
    --sarif-category="/language:$court"
done
rm -rf "$base" "$outils"
