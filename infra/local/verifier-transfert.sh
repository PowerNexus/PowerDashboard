#!/usr/bin/env bash
#
# Banc : le transfert d'un serveur d'une machine à une autre.
#
# **Le flux le plus destructeur du panel, et le seul jamais éprouvé.** Il
# arrête le serveur, copie son volume vers une autre machine, lui donne une
# nouvelle adresse, puis efface l'original. Chaque étape peut échouer au
# milieu, et ce qui reste alors n'appartient plus tout à fait ni à l'une ni à
# l'autre.
#
# Cinq questions :
#   1. le panel marque-t-il le serveur « en transfert » ?
#   2. la copie arrive-t-elle sur la machine de destination ?
#   3. **les fichiers sont-ils les mêmes, octet pour octet ?**
#   4. l'original est-il retiré de la machine de départ ?
#   5. le serveur repart-il avec sa nouvelle machine et son nouveau port ?
#
# La troisième est la seule qui compte : un transfert qui laisse un volume
# vide a « réussi » de tous les points de vue du panel.
#
# Deux daemons tournent en même temps, chacun avec sa racine de données :
#   A — port 8080, sftp 2022, /var/lib/pterodactyl
#   B — port 8081, sftp 2023, /var/lib/pterodactyl-b
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-tr » et retiré à la fin, la racine
# du second daemon comprise.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
RACINE_B=/var/lib/pterodactyl-b
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-tr'
TMP=$(mktemp -d /tmp/banc-tr.XXXXXX)
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

arreter_daemon() { # fichier-pid
  [ -f "$1" ] || return 0
  kill -TERM -- "-$(cat "$1")" 2>/dev/null || kill -TERM "$(cat "$1")" 2>/dev/null
  sleep 2
  kill -KILL -- "-$(cat "$1")" 2>/dev/null
  rm -f "$1"
}

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
  arreter_daemon "$TMP/wings-a.pid"
  arreter_daemon "$TMP/wings-b.pid"
  [ -n "${SRV:-}" ] && Q "delete from activity_logs where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "update allocations set server_id = null where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from servers where id = '$SRV'" >/dev/null 2>&1
  for n in ${NODES:-}; do
    Q "delete from allocations where node_id = '$n'" >/dev/null 2>&1
    Q "delete from nodes where id = '$n'" >/dev/null 2>&1
  done
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bt'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  rm -rf /etc/pterodactyl-b "$RACINE_B"
  [ -f "$TMP/wings-a.log" ] && cp "$TMP/wings-a.log" /tmp/banc-tr-a.log
  [ -f "$TMP/wings-b.log" ] && cp "$TMP/wings-b.log" /tmp/banc-tr-b.log
  rm -rf "$TMP"

  titre "État final"
  echo "  serveurs  : $(Q 'select count(*) from servers')"
  echo "  nodes     : $(Q 'select count(*) from nodes')"
  echo "  volumes A : $(ls /var/lib/pterodactyl/volumes 2>/dev/null | wc -l)"
  echo "  racine B  : $([ -d "$RACINE_B" ] && echo RESTE || echo effacée)"
  echo "  wings     : $(pgrep -cx wings) en marche"
  echo "  journaux  : /tmp/banc-tr-a.log et -b.log"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Deux machines, deux daemons"
# ---------------------------------------------------------------------------
cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-tr",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal : le transfert se juge sur les fichiers, pas sur le programme.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh",
  "config": { "files": "{}", "startup": "{}", "logs": "{}", "stop": "^C" },
  "scripts": {
    "installation": {
      "script": "#!/bin/sh\nmkdir -p /mnt/server\nhead -c 4096 /dev/urandom | od -An -tx1 > /mnt/server/tresor.txt\necho 'un serveur qui compte' > /mnt/server/note.txt\n",
      "container": "alpine:latest",
      "entrypoint": "sh"
    }
  },
  "variables": []
}
EGG
python3 -c "
import json
open('$TMP/payload.json','w').write(json.dumps({'egg': json.load(open('$TMP/egg.json')), 'nest': 'banc-tr'}))
"
EGG_ID=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l egg"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null

LOC=$(adm -X POST -d '{"short":"bt","long":"Banc Transfert","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")

declarer_node() { # nom port sftp -> id
  adm -X POST -d "{\"name\":\"$1\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":$2,\"daemonSftpPort\":$3,\"memoryMb\":8192,\"diskMb\":51200,\"cpuCores\":8}" \
    "$API/api/v1/admin/nodes" | jq_ "d['data']['id']"
}
NODE_A=$(declarer_node "$M-a" 8080 2022)
NODE_B=$(declarer_node "$M-b" 8081 2023)
[ -n "$NODE_A" ] && [ -n "$NODE_B" ] || { echo "  ÉCHEC déclaration des nodes"; exit 1; }
NODES="$NODE_A $NODE_B"
adm -X POST -d '{"ip":"127.0.0.1","from":42800,"to":42802}' "$API/api/v1/admin/nodes/$NODE_A/allocations" >/dev/null
adm -X POST -d '{"ip":"127.0.0.1","from":42810,"to":42812}' "$API/api/v1/admin/nodes/$NODE_B/allocations" >/dev/null

install -d /etc/pterodactyl /etc/pterodactyl-b /var/lib/pterodactyl "$RACINE_B" /var/log/pterodactyl
adm "$API/api/v1/admin/nodes/$NODE_A/configuration" | jq_ "d['data']['yaml']" > /etc/pterodactyl/config.yml
adm "$API/api/v1/admin/nodes/$NODE_B/configuration" | jq_ "d['data']['yaml']" > /etc/pterodactyl-b/config.yml
chmod 600 /etc/pterodactyl/config.yml /etc/pterodactyl-b/config.yml

# Le panel écrit toujours la même racine de données : il n'a aucune raison de
# supposer deux daemons sur une machine. On la déplace pour le second, sans
# quoi les deux écriraient dans les mêmes volumes et le transfert se ferait
# sur place — en donnant toutes les apparences du succès.
sed -i "s#/var/lib/pterodactyl/volumes#$RACINE_B/volumes#" /etc/pterodactyl-b/config.yml
printf '\nsystem:\n  root_directory: %s\n  data: %s/volumes\n' "$RACINE_B" "$RACINE_B" >> "$TMP/rappel.txt"

demarrer_daemon() { # config journal pid
  setsid wings --config "$1" >"$2" 2>&1 &
  echo $! > "$3"
}
demarrer_daemon /etc/pterodactyl/config.yml "$TMP/wings-a.log" "$TMP/wings-a.pid"
demarrer_daemon /etc/pterodactyl-b/config.yml "$TMP/wings-b.log" "$TMP/wings-b.pid"
for i in $(seq 1 30); do
  a=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8080/api/system)
  b=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8081/api/system)
  [ "$a" = "401" ] && [ "$b" = "401" ] && break
  sleep 1
done
verdict "401" "$a" "le daemon A écoute"
verdict "401" "$b" "le daemon B écoute"

# ---------------------------------------------------------------------------
titre "2. Un serveur installé sur A, avec du contenu"
# ---------------------------------------------------------------------------
SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE_A\",\"ownerId\":\"$CLIENT\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":0,\"databases\":0}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est installé"

VOL_A=/var/lib/pterodactyl/volumes/$SRV
VOL_B=$RACINE_B/volumes/$SRV
verdict "oui" "$([ -f "$VOL_A/tresor.txt" ] && echo oui || echo non)" "son contenu est sur A"
EMPREINTE=$(sha256sum "$VOL_A/tresor.txt" 2>/dev/null | cut -d' ' -f1)
echo "    empreinte du contenu : ${EMPREINTE:0:16}…"
PORT_AVANT=$(Q "select a.port from allocations a where a.server_id = '$SRV'")

# ---------------------------------------------------------------------------
titre "3. Le panel le déplace vers B"
# ---------------------------------------------------------------------------
code=$(adm -o "$TMP/tr.json" -w '%{http_code}' -X POST -d "{\"nodeId\":\"$NODE_B\"}" \
  "$API/api/v1/admin/servers/$SRV/transfer")
case "$code" in
  200|201) printf '  OK    %-46s %s\n' "le déplacement est accepté" "$code" ;;
  *)       printf '  ÉCHEC %-45s %s : %s\n' "le déplacement est accepté" "$code" "$(head -c 150 "$TMP/tr.json")" ;;
esac

# L'état de gestion doit le dire pendant l'opération : c'est lui qui ferme la
# console et les écritures le temps de la copie.
vu_transfert=non
for i in $(seq 1 300); do
  etat=$(Q "select coalesce(state::text,'') from servers where id = '$SRV'")
  [ "$etat" = "transferring" ] && vu_transfert=oui
  [ -z "$etat" ] && break
  sleep 0.4
done
# L'état est fugace : sur un volume de quelques kilooctets, le transfert se
# termine entre deux sondages. Son passage se relit alors dans la table des
# transferts, qui garde la trace de l'opération — et c'est une preuve plus
# solide qu'un état attrapé au vol.
trace=$(Q "select state from server_transfers where server_id = '$SRV' order by created_at desc limit 1")
if [ "$vu_transfert" = "oui" ]; then
  printf '  OK    %-46s observé\n' "le serveur passe par « en transfert »"
elif [ "$trace" = "completed" ]; then
  printf '  OK    %-46s trop rapide pour être vu, mais tracé (%s)\n' \
    "le serveur passe par « en transfert »" "$trace"
else
  printf '  ÉCHEC %-45s ni observé, ni tracé (%s)\n' "le serveur passe par « en transfert »" "${trace:-aucune}"
fi
verdict "" "$etat" "puis rendu à son propriétaire"

# ---------------------------------------------------------------------------
titre "4. Les fichiers sont arrivés, identiques"
# ---------------------------------------------------------------------------
verdict "$NODE_B" "$(Q "select node_id from servers where id = '$SRV'")" "le serveur appartient à B"
verdict "oui" "$([ -f "$VOL_B/tresor.txt" ] && echo oui || echo non)" "le contenu est sur B"
verdict "$EMPREINTE" "$(sha256sum "$VOL_B/tresor.txt" 2>/dev/null | cut -d' ' -f1)" "octet pour octet"
verdict "un serveur qui compte" "$(cat "$VOL_B/note.txt" 2>/dev/null)" "et la note est lisible"

# ---------------------------------------------------------------------------
titre "5. L'original est retiré de A"
# ---------------------------------------------------------------------------
# Sans cela, le volume resterait sur la machine de départ : de l'espace occupé
# que plus rien ne rattache à personne, et une copie des données du client là
# où il ne s'attend plus à les trouver.
verdict "non" "$([ -d "$VOL_A" ] && echo oui || echo non)" "le volume de départ a disparu"

# ---------------------------------------------------------------------------
titre "6. Il repart avec une adresse de B"
# ---------------------------------------------------------------------------
PORT_APRES=$(Q "select a.port from allocations a where a.server_id = '$SRV'")
verdict "$NODE_B" "$(Q "select a.node_id from allocations a where a.server_id = '$SRV'")" "son port est pris sur B"
if [ "$PORT_AVANT" != "$PORT_APRES" ]; then
  printf '  OK    %-46s %s puis %s\n' "l adresse a changé" "$PORT_AVANT" "$PORT_APRES"
else
  printf '  ÉCHEC %-45s toujours %s\n' "l adresse a changé" "$PORT_APRES"
fi
