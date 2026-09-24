#!/usr/bin/env bash
#
# Pousse la construction du commit courant sur la branche `deploiement`,
# celle que suit un hébergement cPanel (docs/hebergement-cpanel.md).
#
#   pnpm build && bash infra/cpanel/publier-construction.sh [distant] [branche]
#
# Lancé par .github/workflows/deploiement.yml après chaque CI verte sur
# main ; utilisable tel quel depuis un poste, pour publier sans attendre.
#
# La branche porte exactement l'archive d'une version publiée
# (infra/release/assembler.sh : le code suivi et l'interface construite),
# en **un seul commit sans parent**, remplacé à chaque publication. Elle
# ne garde donc jamais qu'une construction : empilées, les interfaces
# compilées feraient grossir le dépôt de dizaines de mégaoctets à chaque
# publication.
set -euo pipefail

DISTANT=${1:-origin}
BRANCHE=${2:-deploiement}
RACINE=$(git rev-parse --show-toplevel)
cd "$RACINE"
COMMIT=$(git rev-parse HEAD)

TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT

# L'assembleur refuse un arbre modifié et une interface qui ne serait pas une
# construction de production : les mêmes garde-fous qu'une version publiée.
bash infra/release/assembler.sh "v0.0.0-continu.${COMMIT::12}" "$TRAVAIL/dist" >/dev/null
mkdir "$TRAVAIL/arbre"
tar -xzf "$TRAVAIL"/dist/gamedashboard-v0.0.0-continu.*.tar.gz -C "$TRAVAIL/arbre" --strip-components=1

# Sans les workflows : l'hébergement n'en a pas l'usage, et le jeton d'un
# workflow n'a pas le droit de pousser un commit qui en contient.
rm -rf "$TRAVAIL/arbre/.github"

# Le commit se fabrique à côté du dossier de travail, dans un index à part :
# rien de l'arbre courant n'est touché. `-f` parce que `.next` est ignoré
# par le .gitignore du dépôt — c'est justement lui qu'on livre.
export GIT_DIR="$RACINE/.git" GIT_INDEX_FILE="$TRAVAIL/index"
git --work-tree="$TRAVAIL/arbre" -C "$TRAVAIL/arbre" add -A -f .
ARBRE=$(git write-tree)
CONSTRUCTION=$(git commit-tree "$ARBRE" -m "Construction de $COMMIT

Remplacée à chaque publication : voir infra/cpanel/publier-construction.sh.")
unset GIT_INDEX_FILE

git push --force "$DISTANT" "$CONSTRUCTION:refs/heads/$BRANCHE"
echo "Publié sur $BRANCHE : $CONSTRUCTION (depuis $COMMIT)"
