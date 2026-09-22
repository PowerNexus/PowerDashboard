#!/usr/bin/env bash
#
# Banc : les sauvegardes, de la demande jusqu'à la restauration.
#
# C'est le flux qui fait le plus d'allers-retours entre le panel et le daemon,
# et le seul dont l'échec se découvre **au pire moment** : quand quelqu'un a
# besoin de sa sauvegarde. Cinq questions, dans l'ordre où elles comptent :
#
#   1. le daemon fabrique-t-il l'archive, et le panel enregistre-t-il ce qu'il
#      en rapporte — taille, empreinte, succès ?
#   2. l'archive existe-t-elle vraiment sur le disque ?
#   3. le lien de téléchargement signé par le panel rend-il ce fichier ?
#   4. le quota refuse-t-il la sauvegarde de trop ?
#   5. **la restauration rend-elle réellement les fichiers ?**
#
# La cinquième est la seule qui compte vraiment. Les quatre autres peuvent
# réussir sur une archive vide.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-sauv » et retiré à la fin : serveur
# (volume et archives compris), node, egg, localisation.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-sauv'
TMP=$(mktemp -d /tmp/banc-sauv.XXXXXX)
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")

session() {
  local j="$M-$(date +%s)-$RANDOM"
  Q "insert into sessions (user_id, token_hash, expires_at, auth_method)
     values ('$1', '$(printf '%s' "$j" | sha256sum | cut -d' ' -f1)', now() + interval '60 minutes', 'password')" >/dev/null
  printf '%s' "$j"
}
JA=$(session "$ADMIN")
adm() { curl -s -b "__Host-gd_session=$JA" -H 'content-type: application/json' "$@"; }

nettoyer() {
  titre "Nettoyage"
  if [ -n "${SRV:-}" ]; then
    rep=$(curl -s -b "__Host-gd_session=$JA" -o /dev/null -w '%{http_code}' \
      -X DELETE "$API/api/v1/admin/servers/$SRV")
    echo "  suppression du serveur : $rep"
    for i in $(seq 1 30); do
      [ -z "$(docker ps -aq --filter "name=$SRV" 2>/dev/null)" ] && break
      sleep 1
    done
  fi
  if [ -f "$TMP/wings.pid" ]; then
    kill -TERM -- "-$(cat "$TMP/wings.pid")" 2>/dev/null || kill -TERM "$(cat "$TMP/wings.pid")" 2>/dev/null
    sleep 2
    kill -KILL -- "-$(cat "$TMP/wings.pid")" 2>/dev/null
  fi
  # Les archives que le daemon n'aurait pas retirées : elles portent
  # l'identifiant de la sauvegarde, pas celui du serveur.
  for b in ${ARCHIVES:-}; do rm -f "/var/lib/pterodactyl/backups/$b.tar.gz"; done
  [ -n "${SRV:-}" ] && Q "delete from backups where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from activity_logs where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "update allocations set server_id = null where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from servers where id = '$SRV'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from allocations where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bv'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  # Le journal du daemon survit au répertoire temporaire : sans lui, un échec
  # ne laisse rien à lire, et c'est précisément quand on en a besoin.
  [ -f "$TMP/wings.log" ] && cp "$TMP/wings.log" /tmp/banc-sauv-wings.log
  rm -rf "$TMP"
  echo "  journal du daemon : /tmp/banc-sauv-wings.log"

  titre "État final"
  echo "  serveurs     : $(Q 'select count(*) from servers')"
  echo "  sauvegardes  : $(Q 'select count(*) from backups')"
  echo "  nodes        : $(Q 'select count(*) from nodes')"
  echo "  archives     : $(ls /var/lib/pterodactyl/backups/ 2>/dev/null | wc -l) sur le disque"
  echo "  wings        : $(pgrep -x wings >/dev/null && echo 'ENCORE LÀ' || echo arrêté)"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Le décor : un serveur installé, avec du contenu"
# ---------------------------------------------------------------------------
CLIENT=$(Q "select id from users where role = 'user' order by created_at limit 1")
[ -n "$CLIENT" ] || { echo "  ÉCHEC aucun compte client — lancez creer-compte.sh"; exit 1; }
JC=$(session "$CLIENT")
cli() { curl -s -b "__Host-gd_session=$JC" -H 'content-type: application/json' "$@"; }

cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-sauv",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal, pour éprouver les sauvegardes.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh -c 'while :; do sleep 5; done'",
  "config": { "files": "{}", "startup": "{\"done\": \"pret\"}", "logs": "{}", "stop": "^C" },
  "scripts": {
    "installation": {
      "script": "#!/bin/sh\nmkdir -p /mnt/server\necho 'contenu precieux' > /mnt/server/precieux.txt\n",
      "container": "alpine:latest",
      "entrypoint": "sh"
    }
  },
  "variables": []
}
EGG
python3 -c "
import json
open('$TMP/payload.json','w').write(json.dumps({'egg': json.load(open('$TMP/egg.json')), 'nest': 'banc-sauv'}))
"
EGG_ID=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l'egg — le panel répond-il ?"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null

LOC=$(adm -X POST -d '{"short":"bv","long":"Banc Sauvegardes","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
adm -X POST -d '{"ip":"127.0.0.1","from":42300,"to":42302}' \
  "$API/api/v1/admin/nodes/$NODE/allocations" >/dev/null

adm "$API/api/v1/admin/nodes/$NODE/configuration" | jq_ "d['data']['yaml']" > "$TMP/config.yml"
install -d /etc/pterodactyl /var/lib/pterodactyl /var/log/pterodactyl
cp "$TMP/config.yml" /etc/pterodactyl/config.yml
chmod 600 /etc/pterodactyl/config.yml
setsid wings --config /etc/pterodactyl/config.yml >"$TMP/wings.log" 2>&1 &
echo $! > "$TMP/wings.pid"
for i in $(seq 1 25); do
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:8080/api/system && break
  sleep 1
done

# Une seule sauvegarde autorisée : c'est ainsi qu'on éprouve le quota.
SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"ownerId\":\"$CLIENT\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":1,\"databases\":0}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est prêt"
VOLUME=/var/lib/pterodactyl/volumes/$SRV
verdict "oui" "$([ -f "$VOLUME/precieux.txt" ] && echo oui || echo non)" "il a du contenu à sauvegarder"

# ---------------------------------------------------------------------------
titre "2. Le daemon fabrique l'archive, le panel en rend compte"
# ---------------------------------------------------------------------------
BK=$(cli -X POST -d '{"name":"essai"}' "$API/api/v1/client/servers/$SRV/backups" | jq_ "d['data']['id']")
[ -n "$BK" ] || { echo "  ÉCHEC la création est refusée"; exit 1; }
ARCHIVES="$BK"
for i in $(seq 1 60); do
  fini=$(Q "select coalesce(is_successful::text, 'en cours') from backups where id = '$BK'")
  [ "$fini" != "en cours" ] && break
  sleep 2
done
# `true` et non `t` : la requête convertit en texte, et un booléen converti
# s'écrit en toutes lettres. Le `t` est l'affichage par défaut de psql.
verdict "true" "$fini" "le panel la marque réussie"
taille=$(Q "select coalesce(bytes, 0) from backups where id = '$BK'")
if [ "${taille:-0}" -gt 0 ]; then
  printf '  OK    %-46s %s octets\n' "la taille rapportée est réelle" "$taille"
else
  printf '  ÉCHEC %-45s zéro\n' "la taille rapportée est réelle"
fi
verdict "oui" "$([ -n "$(Q "select checksum from backups where id = '$BK'")" ] && echo oui || echo non)" "une empreinte est enregistrée"

ARCHIVE=/var/lib/pterodactyl/backups/$BK.tar.gz
verdict "oui" "$([ -f "$ARCHIVE" ] && echo oui || echo non)" "l archive existe sur le disque"

# ---------------------------------------------------------------------------
titre "3. Le lien signé par le panel rend ce fichier"
# ---------------------------------------------------------------------------
LIEN=$(cli "$API/api/v1/client/servers/$SRV/backups/$BK/download" | jq_ "d['data']['url']")
if [ -z "$LIEN" ]; then
  LIEN=$(cli "$API/api/v1/client/servers/$SRV/backups/$BK/download" | jq_ "d['url']")
fi
verdict "oui" "$([ -n "$LIEN" ] && echo oui || echo non)" "un lien est rendu"
if [ -n "$LIEN" ]; then
  code=$(curl -s -L -o "$TMP/recu.tar.gz" -w '%{http_code}' --max-time 30 "$LIEN")
  verdict "200" "$code" "le téléchargement aboutit"
  # Le verdict qui compte : l'archive contient-elle le fichier du serveur ?
  if tar -tzf "$TMP/recu.tar.gz" 2>/dev/null | grep -q 'precieux.txt'; then
    printf '  OK    %-46s oui\n' "elle contient le fichier du serveur"
  else
    printf '  ÉCHEC %-45s precieux.txt absent de l archive\n' "elle contient le fichier du serveur"
  fi
fi

# ---------------------------------------------------------------------------
titre "4. Le quota refuse la sauvegarde de trop"
# ---------------------------------------------------------------------------
code=$(cli -o /dev/null -w '%{http_code}' -X POST -d '{"name":"la trop"}' \
  "$API/api/v1/client/servers/$SRV/backups")
verdict "409" "$code" "une seconde sauvegarde est refusée"
verdict "1" "$(Q "select count(*) from backups where server_id = '$SRV'")" "et rien n est inscrit"

# ---------------------------------------------------------------------------
titre "5. La restauration rend réellement les fichiers"
# ---------------------------------------------------------------------------
# Le seul verdict qui compte pour de vrai. On détruit, puis on demande à
# récupérer — comme le ferait quelqu'un qui a perdu son monde.
rm -f "$VOLUME/precieux.txt"
verdict "non" "$([ -f "$VOLUME/precieux.txt" ] && echo oui || echo non)" "le fichier est bien détruit"

code=$(cli -o /dev/null -w '%{http_code}' -X POST -d '{"truncate":false}' \
  "$API/api/v1/client/servers/$SRV/backups/$BK/restore")
verdict "201" "$code" "la restauration est acceptée"
for i in $(seq 1 60); do
  [ -f "$VOLUME/precieux.txt" ] && break
  sleep 2
done
verdict "oui" "$([ -f "$VOLUME/precieux.txt" ] && echo oui || echo non)" "le fichier est revenu"
[ -f "$VOLUME/precieux.txt" ] && echo "    contenu : $(cat "$VOLUME/precieux.txt")"
verdict "" "$(Q "select coalesce(state::text,'') from servers where id = '$SRV'")" "l état de gestion est libéré"

# ---------------------------------------------------------------------------
titre "6. La suppression retire l'archive du disque"
# ---------------------------------------------------------------------------
code=$(curl -s -b "__Host-gd_session=$JC" -o /dev/null -w '%{http_code}' \
  -X DELETE "$API/api/v1/client/servers/$SRV/backups/$BK")
verdict "200" "$code" "la suppression est acceptée"
for i in $(seq 1 20); do
  [ -f "$ARCHIVE" ] || break
  sleep 1
done
verdict "non" "$([ -f "$ARCHIVE" ] && echo oui || echo non)" "l archive a disparu du disque"
verdict "0" "$(Q "select count(*) from backups where server_id = '$SRV'")" "et la ligne aussi"
