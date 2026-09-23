#!/usr/bin/env bash
# Scan ZAP « baseline » du panel compilé (PLAN §5.4 et §12.2).
#
#   DATABASE_URL=… APP_SECRET_KEY=… bash infra/ci/zap-baseline.sh [dossier-du-rapport]
#
# Le scan est **passif** : ZAP parcourt les pages et lit les réponses (en-têtes,
# CSP, cookies, formulaires) sans rien attaquer. C'est ce qui permet de le
# lancer sur la machine du runner sans risque pour ce qui l'entoure.
#
# Prérequis : `pnpm build` déjà fait, une base migrée, Docker.
#
# Sortie : 0 si aucune alerte hors des exceptions de zap-regles.tsv, non nul
# sinon. Le rapport HTML est copié dans le dossier donné (zap-rapport par
# défaut).
set -euo pipefail

RACINE=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RAPPORT=${1:-$RACINE/zap-rapport}
API_PORT=${ZAP_API_PORT:-3401}
WEB_PORT=${ZAP_WEB_PORT:-3400}
CIBLE="http://127.0.0.1:$WEB_PORT"
# Épinglée par empreinte, comme les actions des workflows : une image qui
# change sous le même nom changerait le verdict sans que le dépôt bouge.
# Quand ZAP se déclare trop ancien (alerte 10116), c'est cette empreinte qu'on
# remplace : `docker pull ghcr.io/zaproxy/zaproxy:stable`, puis RepoDigests.
IMAGE=ghcr.io/zaproxy/zaproxy@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef # 2.17.0

: "${DATABASE_URL:?DATABASE_URL manquante}"
: "${APP_SECRET_KEY:?APP_SECRET_KEY manquante}"

# ZAP tourne dans son conteneur sous un autre utilisateur que le runner. Il
# écrit donc dans un dossier temporaire **hors** de l'espace de travail, ouvert
# à tous : des fichiers qui ne sont pas au runner, laissés dans _work, font
# échouer le checkout suivant (voir docs/runner-auto-heberge.md).
TRAVAIL=$(mktemp -d)
chmod 777 "$TRAVAIL"
cp "$RACINE/infra/ci/zap-regles.tsv" "$TRAVAIL/regles.tsv"

PIDS=()
arreter() {
  # Chaque service a son propre groupe (setsid) : pnpm lance node, et tuer
  # pnpm seul laisserait node tenir le port.
  for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  # Le dossier est au runner : il peut en retirer les fichiers de ZAP.
  rm -rf "$TRAVAIL" 2>/dev/null || true
}
trap arreter EXIT

cd "$RACINE"
PORT=$API_PORT HOST=127.0.0.1 PANEL_ORIGIN=$CIBLE NODE_ENV=production \
  setsid pnpm --filter @gamedashboard/api start >"$TRAVAIL/api.log" 2>&1 &
PIDS+=($!)
API_URL="http://127.0.0.1:$API_PORT" PORT=$WEB_PORT NODE_ENV=production \
  setsid pnpm --filter @gamedashboard/web start --port "$WEB_PORT" >"$TRAVAIL/web.log" 2>&1 &
PIDS+=($!)

pret=0
for _ in $(seq 60); do
  if curl -fsS -o /dev/null "$CIBLE/login" && curl -sS -o /dev/null "http://127.0.0.1:$API_PORT/"; then
    pret=1
    break
  fi
  sleep 2
done
if [ "$pret" = 0 ]; then
  echo "Le panel n'a pas démarré en deux minutes." >&2
  tail -n 40 "$TRAVAIL/api.log" "$TRAVAIL/web.log" >&2
  exit 1
fi

# `--network host` : ZAP joint le panel sur 127.0.0.1, comme un navigateur de
# la machine. Sans -I, un avertissement non accepté rend un code non nul.
#
# `-z -silent` : sans lui, ZAP télécharge au démarrage les dernières règles
# « bêta » (-addonupdate), et le verdict changeait d'un jour à l'autre sans que
# le dépôt bouge — deux alertes apparues en CI, absentes du même scan en local.
# Les règles sont donc celles de l'image épinglée, ni plus ni moins ; on en
# gagne en changeant l'empreinte, pas au hasard d'une exécution.
code=0
docker run --rm --network host -v "$TRAVAIL:/zap/wrk:rw" "$IMAGE" \
  zap-baseline.py -t "$CIBLE" -c regles.tsv -r rapport.html -J rapport.json -z -silent || code=$?

mkdir -p "$RAPPORT"
cp "$TRAVAIL"/rapport.html "$TRAVAIL"/rapport.json "$RAPPORT"/ 2>/dev/null || true

case $code in
  0) echo "ZAP : aucune alerte hors des exceptions de infra/ci/zap-regles.tsv." ;;
  1 | 2) echo "ZAP : alerte à corriger ou à accepter dans infra/ci/zap-regles.tsv (rapport : $RAPPORT)." >&2 ;;
  *) echo "ZAP n'a pas pu mener le scan (code $code)." >&2 ;;
esac
exit "$code"
