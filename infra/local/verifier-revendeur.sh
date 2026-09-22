#!/usr/bin/env bash
#
# Banc : ce qu'un revendeur peut faire de son parc.
#
# L'écran du parc affiche les serveurs de ses clients et propose de changer
# leur offre. La promesse porte sur **sept quantités** — mémoire, disque,
# processeur, swap, sauvegardes, bases, ports — et l'écran n'en proposait que
# deux, faute que sa liste transporte les autres.
#
# Quatre questions :
#   1. le parc du revendeur lui sert-il les sept quantités ?
#   2. peut-il les changer toutes en un seul geste ?
#   3. son enveloppe le borne-t-elle quand même ?
#   4. le parc d'un confrère lui reste-t-il invisible ?
#
# Le décor passe par les **vraies routes**, avec un daemon réel. Deux colonnes
# sont posées directement — le propriétaire du node et le rattachement du
# serveur — parce qu'aucune route ne les expose et qu'elles sont nommées une
# par une, pas devinées dans une insertion entière.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-rev » et retiré à la fin.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-rev'
TMP=$(mktemp -d /tmp/banc-rev.XXXXXX)
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")
CLIENT=$(Q "select id from users where role = 'user' order by created_at limit 1")
[ -n "$CLIENT" ] || { echo "aucun compte client — lancez creer-compte.sh"; exit 1; }

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
    curl -s -b "__Host-gd_session=$JA" -o /dev/null -X DELETE "$API/api/v1/admin/servers/$SRV"
    for i in $(seq 1 25); do
      [ -z "$(docker ps -aq --filter "name=$SRV" 2>/dev/null)" ] && break
      sleep 1
    done
    [ -z "$(docker ps -aq --filter "name=$SRV" 2>/dev/null)" ] \
      || echo "  ATTENTION le conteneur $SRV survit — retirez-le à la main"
  fi
  if [ -f "$TMP/wings.pid" ]; then
    kill -TERM -- "-$(cat "$TMP/wings.pid")" 2>/dev/null || kill -TERM "$(cat "$TMP/wings.pid")" 2>/dev/null
    sleep 2
    kill -KILL -- "-$(cat "$TMP/wings.pid")" 2>/dev/null
  fi
  [ -n "${SRV:-}" ] && Q "delete from activity_logs where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "update allocations set server_id = null where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from servers where id = '$SRV'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from allocations where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from reseller_quotas where user_id in (select id from users where email like '%$M%')" >/dev/null 2>&1
  Q "delete from activity_logs where actor_id in (select id from users where email like '%$M%')" >/dev/null 2>&1
  Q "delete from sessions where user_id in (select id from users where email like '%$M%')" >/dev/null 2>&1
  Q "delete from users where email like '%$M%'" >/dev/null 2>&1
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'br'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  rm -rf "$TMP"

  titre "État final"
  echo "  serveurs      : $(Q 'select count(*) from servers')"
  echo "  nodes         : $(Q 'select count(*) from nodes')"
  echo "  comptes essai : $(Q "select count(*) from users where email like '%$M%'")"
  echo "  enveloppes    : $(Q 'select count(*) from reseller_quotas')"
  echo "  wings         : $(pgrep -x wings >/dev/null && echo 'ENCORE LÀ' || echo arrêté)"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Un revendeur, sa machine, un serveur de client dessus"
# ---------------------------------------------------------------------------
REV=$(Q "insert into users (email, name_first, name_last, role, email_verified_at)
         values ('rev.$M@exemple.invalid', 'Banc', 'Revendeur', 'reseller', now()) returning id")
AUTRE=$(Q "insert into users (email, name_first, name_last, role, email_verified_at)
           values ('autre.$M@exemple.invalid', 'Banc', 'Confrere', 'reseller', now()) returning id")
JR=$(session "$REV"); JX=$(session "$AUTRE")
rev() { curl -s -b "__Host-gd_session=$JR" -H 'content-type: application/json' "$@"; }

cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-rev",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal, pour éprouver l'espace revendeur.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh",
  "config": { "files": "{}", "startup": "{}", "logs": "{}", "stop": "^C" },
  "scripts": {
    "installation": {
      "script": "#!/bin/sh\nmkdir -p /mnt/server\necho pret > /mnt/server/pret.txt\n",
      "container": "alpine:latest",
      "entrypoint": "sh"
    }
  },
  "variables": []
}
EGG
python3 -c "
import json
open('$TMP/payload.json','w').write(json.dumps({'egg': json.load(open('$TMP/egg.json')), 'nest': 'banc-rev'}))
"
EGG_ID=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l egg"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null

LOC=$(adm -X POST -d '{"short":"br","long":"Banc Revendeur","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":8192,\"diskMb\":51200,\"cpuCores\":8}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
adm -X POST -d '{"ip":"127.0.0.1","from":42700,"to":42702}' \
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

SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"ownerId\":\"$CLIENT\",\"resources\":{\"memoryMb\":1024,\"diskMb\":5120,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":1,\"databases\":1}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est installé"

# Deux colonnes posées à la main, faute de route : la machine appartient au
# revendeur, et le serveur s'y rattache. Elles sont nommées une par une.
Q "update nodes set owner_id = '$REV' where id = '$NODE'" >/dev/null
Q "update servers set reseller_id = '$REV' where id = '$SRV'" >/dev/null
Q "insert into reseller_quotas (user_id, memory_mb, disk_mb, servers_max)
   values ('$REV', 4096, 102400, 10)" >/dev/null
verdict "$REV" "$(Q "select reseller_id from servers where id = '$SRV'")" "le serveur est rattaché au revendeur"

# ---------------------------------------------------------------------------
titre "2. Son parc lui sert les sept quantités de l'offre"
# ---------------------------------------------------------------------------
# Sans elles, le dialogue de changement d'offre s'ouvrirait sur des champs
# vides : il préremplit avec ce que la liste lui donne.
manquants=$(rev "$API/api/v1/reseller/overview" | python3 -c "
import json, sys
d = json.load(sys.stdin)
cible = next((s for s in d['data']['servers'] if s['id'] == '$SRV'), None)
attendus = ['memoryMb','diskMb','cpuPct','swapMb','backupLimit','databaseLimit','allocationLimit']
print('serveur absent du parc' if cible is None else (','.join(c for c in attendus if c not in cible) or 'aucun'))
" 2>/dev/null)
verdict "aucun" "${manquants:-?}" "aucune quantité ne manque"

# ---------------------------------------------------------------------------
titre "3. Il change l'offre entière en un seul geste"
# ---------------------------------------------------------------------------
code=$(rev -o /dev/null -w '%{http_code}' -X POST \
  -d '{"memoryMb":2048,"diskMb":10240,"cpuPct":150,"swapMb":-1,"backups":3,"databases":2,"allocations":2}' \
  "$API/api/v1/reseller/servers/$SRV/limits")
verdict "201" "$code" "les sept sont acceptées ensemble"
verdict "2048|10240|150|-1|3|2|2" \
  "$(Q "select memory_mb||'|'||disk_mb||'|'||cpu_pct||'|'||swap_mb||'|'||backup_limit||'|'||database_limit||'|'||allocation_limit from servers where id = '$SRV'")" \
  "et les sept sont inscrites"

# ---------------------------------------------------------------------------
titre "4. Son enveloppe le borne quand même"
# ---------------------------------------------------------------------------
# 4 Go d'enveloppe : la machine en porte 8, mais ce n'est pas la machine qui
# décide de ce qu'il a le droit de vendre.
code=$(rev -o /dev/null -w '%{http_code}' -X POST -d '{"memoryMb":6144}' \
  "$API/api/v1/reseller/servers/$SRV/limits")
verdict "409" "$code" "au-delà de l enveloppe, refusé"
verdict "2048" "$(Q "select memory_mb from servers where id = '$SRV'")" "et rien n a changé"

# Réduire reste possible, même au plafond.
code=$(rev -o /dev/null -w '%{http_code}' -X POST -d '{"memoryMb":512}' \
  "$API/api/v1/reseller/servers/$SRV/limits")
verdict "201" "$code" "la réduction passe"

# ---------------------------------------------------------------------------
titre "5. Le parc d'un confrère lui reste invisible"
# ---------------------------------------------------------------------------
code=$(curl -s -b "__Host-gd_session=$JX" -H 'content-type: application/json' \
  -o /dev/null -w '%{http_code}' -X POST -d '{"memoryMb":1024}' \
  "$API/api/v1/reseller/servers/$SRV/limits")
verdict "404" "$code" "404, et non 403"
verdict "512" "$(Q "select memory_mb from servers where id = '$SRV'")" "le serveur n a pas bougé"
vus=$(curl -s -b "__Host-gd_session=$JX" "$API/api/v1/reseller/overview" \
  | jq_ "len(d['data']['servers'])")
verdict "0" "${vus:-?}" "et son parc est vide"
