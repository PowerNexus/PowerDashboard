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

# L'archive (près de 700 Mo) n'est téléchargée qu'une fois par version, dans
# le volume de cache `gd-ci-codeql` monté sur /codeql (infra/ci/linux.sh).
# Extraite à côté puis renommée : un job coupé en pleine extraction ne laisse
# jamais un CLI incomplet que le suivant prendrait pour bon.
racine=/codeql/$CODEQL_VERSION
if [ ! -x "$racine/codeql/codeql" ]; then
  rm -rf /codeql/.telechargement
  mkdir -p /codeql/.telechargement
  curl -fsSL --retry 3 -o /codeql/.telechargement/bundle.tar.gz \
    "https://github.com/github/codeql-action/releases/download/codeql-bundle-v$CODEQL_VERSION/codeql-bundle-linux64.tar.gz"
  # Épinglée comme les images : une archive remplacée sous le même nom ne
  # s'exécute pas.
  echo "$CODEQL_SHA256  /codeql/.telechargement/bundle.tar.gz" | sha256sum -c --quiet -
  tar -xzf /codeql/.telechargement/bundle.tar.gz -C /codeql/.telechargement
  rm -rf "$racine"
  mkdir -p "$racine"
  mv /codeql/.telechargement/codeql "$racine/codeql"
  rm -rf /codeql/.telechargement
  # Les versions précédentes ne servent plus : elles pèseraient 2 Go chacune.
  find /codeql -mindepth 1 -maxdepth 1 ! -name "$CODEQL_VERSION" -exec rm -rf {} +
fi
codeql=$racine/codeql/codeql
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
rm -rf "$base"
