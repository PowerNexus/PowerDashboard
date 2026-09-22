#!/usr/bin/env bash
#
# Banc : remplacer le jeton d'un node sans le perdre.
#
# Le jeton sert **dans les deux sens** : le daemon s'en sert pour appeler le
# panel, et le panel pour appeler le daemon. Les deux doivent donc changer
# ensemble. Une erreur d'ordre ici ne casse pas une page : elle rend la
# machine définitivement injoignable, et il n'y a plus de chemin pour la
# corriger à distance.
#
# Le service décrit sa parade en commentaire : « on pousse, puis on vérifie
# avec le nouveau jeton, et l'on n'enregistre que ce que le node a confirmé
# savoir ». Trois questions pour l'éprouver :
#
#   1. après rotation, le panel parle-t-il encore au daemon ?
#   2. l'ancien jeton cesse-t-il de valoir ?
#   3. **quand le daemon ne répond pas, le panel s'abstient-il d'écrire ?**
#
# La troisième est celle qui compte. Les deux premières décrivent le beau
# temps ; la troisième dit ce qui se passe le jour où la machine est tombée,
# et c'est ce jour-là qu'on perd un node.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-rot » et retiré à la fin.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-rot'
TMP=$(mktemp -d /tmp/banc-rot.XXXXXX)
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")
J="$M-$(date +%s)-$RANDOM"
Q "insert into sessions (user_id, token_hash, expires_at, auth_method)
   values ('$ADMIN', '$(printf '%s' "$J" | sha256sum | cut -d' ' -f1)', now() + interval '60 minutes', 'password')" >/dev/null
adm() { curl -s -b "__Host-gd_session=$J" -H 'content-type: application/json' "$@"; }
# Sans l'en-tête JSON, pour les appels **sans corps** : Fastify refuse un
# `content-type: application/json` suivi de rien, et l'interface ne le pose
# que lorsqu'il y a un corps. Trois de mes bancs ont trébuché là-dessus.
admv() { curl -s -b "__Host-gd_session=$J" "$@"; }

arreter_daemon() {
  [ -f "$TMP/wings.pid" ] || return 0
  kill -TERM -- "-$(cat "$TMP/wings.pid")" 2>/dev/null || kill -TERM "$(cat "$TMP/wings.pid")" 2>/dev/null
  sleep 2
  kill -KILL -- "-$(cat "$TMP/wings.pid")" 2>/dev/null
  rm -f "$TMP/wings.pid"
}

nettoyer() {
  titre "Nettoyage"
  arreter_daemon
  [ -n "${NODE:-}" ] && Q "delete from allocations where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from activity_logs where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bo'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  rm -rf "$TMP"

  titre "État final"
  echo "  nodes  : $(Q 'select count(*) from nodes')"
  echo "  wings  : $(pgrep -cx wings) en marche"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Une machine et son daemon"
# ---------------------------------------------------------------------------
LOC=$(adm -X POST -d '{"short":"bo","long":"Banc Rotation","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }

adm "$API/api/v1/admin/nodes/$NODE/configuration" | jq_ "d['data']['yaml']" > "$TMP/config.yml"
install -d /etc/pterodactyl /var/lib/pterodactyl /var/log/pterodactyl
cp "$TMP/config.yml" /etc/pterodactyl/config.yml
chmod 600 /etc/pterodactyl/config.yml
setsid wings --config /etc/pterodactyl/config.yml >"$TMP/wings.log" 2>&1 &
echo $! > "$TMP/wings.pid"
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8080/api/system)" = "401" ] && break
  sleep 1
done

# Le jeton **seul**, sans son identifiant.
#
# Les deux sens n'emploient pas la même forme : le daemon s'annonce au panel
# par `identifiant.jeton` sur `/api/remote`, tandis que le panel s'annonce au
# daemon par le jeton nu. Les confondre donne un 403 qui ressemble à s'y
# méprendre à un jeton refusé — c'est ce qu'a fait ce banc au premier essai.
jeton_du_fichier() {
  python3 -c "
import re
t = open('/etc/pterodactyl/config.yml').read()
print(re.search(r'(?<![_a-z])token:\s*(\S+)', t).group(1).strip('\"\\''))
"
}
AVANT=$(jeton_du_fichier)
verdict "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AVANT" http://127.0.0.1:8080/api/system)" \
  "le daemon répond au jeton d origine"
ID_AVANT=$(Q "select daemon_token_id from nodes where id = '$NODE'")

# ---------------------------------------------------------------------------
titre "2. Le panel remplace le jeton"
# ---------------------------------------------------------------------------
rep=$(admv -X POST "$API/api/v1/admin/nodes/$NODE/token/rotate")
applique=$(printf '%s' "$rep" | jq_ "d['data']['applied']")
if [ -z "$applique" ]; then
  # Une réponse qu'on ne sait pas lire n'est pas un « non » : on la montre,
  # sinon le banc accuse le produit de ce qu'il n'a pas compris.
  echo "  ÉCHEC la rotation est appliquée — réponse illisible : $(printf '%s' "$rep" | head -c 200)"
else
  verdict "True" "$applique" "la rotation est appliquée"
fi
ID_APRES=$(Q "select daemon_token_id from nodes where id = '$NODE'")
if [ "$ID_AVANT" != "$ID_APRES" ] && [ -n "$ID_APRES" ]; then
  printf '  OK    %-46s %s puis %s\n' "l identifiant du jeton a changé" "$ID_AVANT" "$ID_APRES"
else
  printf '  ÉCHEC %-45s toujours %s\n' "l identifiant du jeton a changé" "$ID_APRES"
fi

# Le daemon a réécrit son fichier : c'est lui qui fait foi de son côté.
APRES=$(jeton_du_fichier)
if [ "$AVANT" != "$APRES" ]; then
  printf '  OK    %-46s oui\n' "le daemon a réécrit sa configuration"
else
  printf '  ÉCHEC %-45s le fichier porte encore l ancien\n' "le daemon a réécrit sa configuration"
fi

# ---------------------------------------------------------------------------
titre "3. Les deux côtés sont d'accord"
# ---------------------------------------------------------------------------
verdict "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $APRES" http://127.0.0.1:8080/api/system)" \
  "le nouveau jeton ouvre"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AVANT" http://127.0.0.1:8080/api/system)
if [ "$code" = "200" ]; then
  printf '  ÉCHEC %-45s l ancien jeton ouvre encore\n' "l ancien jeton ne vaut plus"
else
  printf '  OK    %-46s %s\n' "l ancien jeton ne vaut plus" "$code"
fi

# Et le panel s'en sert vraiment : sa configuration se relit avec le nouveau.
verdict "200" "$(adm -o /dev/null -w '%{http_code}' "$API/api/v1/admin/nodes/$NODE/configuration")" \
  "le panel parle encore à ce node"

# ---------------------------------------------------------------------------
titre "4. Machine tombée : le panel s'abstient"
# ---------------------------------------------------------------------------
# **Le cas qui compte.** Écrire un jeton que le daemon n'a jamais reçu le rend
# injoignable des deux côtés, sans chemin de retour. Le service affirme ne
# rien enregistrer tant que le node n'a pas confirmé : on coupe le daemon et
# on regarde.
arreter_daemon
sleep 1
ID_COUPE=$(Q "select daemon_token_id from nodes where id = '$NODE'")
rep=$(admv -X POST "$API/api/v1/admin/nodes/$NODE/token/rotate")
verdict "False" "$(printf '%s' "$rep" | jq_ "d['data']['applied']")" "la rotation est refusée"
verdict "$ID_COUPE" "$(Q "select daemon_token_id from nodes where id = '$NODE'")" "le jeton en base n a pas bougé"
raison=$(printf '%s' "$rep" | jq_ "d['data'].get('failure') or ''")
[ -n "$raison" ] && echo "    le panel explique : $(printf '%s' "$raison" | head -c 110)"

# ---------------------------------------------------------------------------
titre "5. Le node redémarre et le panel le retrouve"
# ---------------------------------------------------------------------------
# La preuve que le refus n'a rien cassé : on relance le daemon avec le fichier
# qu'il avait, et tout doit reprendre.
setsid wings --config /etc/pterodactyl/config.yml >>"$TMP/wings.log" 2>&1 &
echo $! > "$TMP/wings.pid"
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8080/api/system)" = "401" ] && break
  sleep 1
done
verdict "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $APRES" http://127.0.0.1:8080/api/system)" \
  "le node répond de nouveau, avec le jeton d avant la panne"
