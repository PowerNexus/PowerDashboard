#!/usr/bin/env bash
#
# Banc : le SFTP, de la promesse de l'écran jusqu'au fichier sur le disque.
#
# L'écran des réglages d'un serveur affiche une adresse, un port, un
# identifiant et dit « même mot de passe que votre compte ». C'est une
# promesse que **rien n'avait jamais éprouvée** : elle traverse le panel (la
# route que le daemon appelle pour authentifier), le daemon (son serveur SFTP)
# et le disque (le volume du serveur).
#
# On passe par la **clé publique** plutôt que par le mot de passe. Deux
# raisons : c'est le mode que l'écran recommande lui-même, et un banc n'a pas
# à manipuler le mot de passe d'un compte pour prouver quoi que ce soit.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-sftp » et retiré à la fin : clé
# SSH, serveur (volume compris, par le daemon), node, egg, localisation. La
# paire de clés est jetable et vit dans un répertoire temporaire.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-sftp'
TMP=$(mktemp -d /tmp/banc-sftp.XXXXXX)
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")

session() { # utilisateur -> jeton
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
      [ -z "$(docker ps -aq --filter "name=$UUID" 2>/dev/null)" ] && break
      sleep 1
    done
    [ -z "$(docker ps -aq --filter "name=$UUID" 2>/dev/null)" ] \
      || echo "  ATTENTION le conteneur $UUID survit — retirez-le à la main"
  fi
  if [ -f "$TMP/wings.pid" ]; then
    kill -TERM -- "-$(cat "$TMP/wings.pid")" 2>/dev/null || kill -TERM "$(cat "$TMP/wings.pid")" 2>/dev/null
    sleep 2
    kill -KILL -- "-$(cat "$TMP/wings.pid")" 2>/dev/null
  fi
  [ -n "${CLE_ID:-}" ] && curl -s -b "__Host-gd_session=$JC" -o /dev/null \
    -X DELETE "$API/api/v1/auth/ssh-keys/$CLE_ID"
  [ -n "${SRV:-}" ] && Q "delete from activity_logs where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "update allocations set server_id = null where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from servers where id = '$SRV'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from allocations where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bs'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  rm -rf "$TMP"

  titre "État final"
  echo "  serveurs     : $(Q 'select count(*) from servers')"
  echo "  nodes        : $(Q 'select count(*) from nodes')"
  echo "  clés SSH     : $(Q 'select count(*) from ssh_keys')"
  echo "  eggs d'essai : $(Q "select count(*) from eggs where name = '$M'")"
  echo "  wings        : $(pgrep -x wings >/dev/null && echo 'ENCORE LÀ' || echo arrêté)"
  echo "  clés jetables: $([ -d "$TMP" ] && echo RESTE || echo effacées)"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Le décor : un serveur installé, chez un client"
# ---------------------------------------------------------------------------
CLIENT=$(Q "select id from users where role = 'user' order by created_at limit 1")
[ -n "$CLIENT" ] || { echo "  ÉCHEC aucun compte client — lancez creer-compte.sh"; exit 1; }
EMAIL=$(Q "select email from users where id = '$CLIENT'")
JC=$(session "$CLIENT")

cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-sftp",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal, pour éprouver l'accès SFTP.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh -c 'while :; do sleep 5; done'",
  "config": { "files": "{}", "startup": "{\"done\": \"pret\"}", "logs": "{}", "stop": "^C" },
  "scripts": {
    "installation": {
      "script": "#!/bin/sh\nmkdir -p /mnt/server\necho depart > /mnt/server/depart.txt\n",
      "container": "alpine:latest",
      "entrypoint": "sh"
    }
  },
  "variables": []
}
EGG
python3 -c "
import json
open('$TMP/payload.json','w').write(json.dumps({'egg': json.load(open('$TMP/egg.json')), 'nest': 'banc-sftp'}))
"
EGG_ID=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l'egg"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null

LOC=$(adm -X POST -d '{"short":"bs","long":"Banc SFTP","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
adm -X POST -d '{"ip":"127.0.0.1","from":42200,"to":42202}' \
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

SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"ownerId\":\"$CLIENT\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":1,\"databases\":0}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
UUID=$SRV
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est prêt"
COURT=$(Q "select uuid_short from servers where id = '$SRV'")
IDENT="$EMAIL.$COURT"
echo "  identifiant SFTP : $IDENT"

# ---------------------------------------------------------------------------
titre "2. Le client dépose une clé publique"
# ---------------------------------------------------------------------------
ssh-keygen -t ed25519 -N '' -C "$M" -f "$TMP/cle" >/dev/null 2>&1
PUB=$(cat "$TMP/cle.pub")
CLE_ID=$(curl -s -b "__Host-gd_session=$JC" -H 'content-type: application/json' \
  -X POST -d "$(python3 -c "
import json
print(json.dumps({'name': 'banc-sftp', 'publicKey': open('$TMP/cle.pub').read().strip()}))
")" "$API/api/v1/auth/ssh-keys" | jq_ "d['data']['id']")
verdict "oui" "$([ -n "$CLE_ID" ] && echo oui || echo non)" "la clé est enregistrée sur le compte"

# ---------------------------------------------------------------------------
titre "3. La route que le daemon appelle pour authentifier"
# ---------------------------------------------------------------------------
# On se met à la place du daemon : son jeton, sa question. C'est la moitié du
# chemin dont le panel répond seul.
JETON=$(python3 -c "
import re
texte = open('/etc/pterodactyl/config.yml').read()
tid = re.search(r'token_id:\s*(\S+)', texte).group(1).strip('\"\\'')
tok = re.search(r'^token:\s*(\S+)', texte, re.M).group(1).strip('\"\\'')
print(f'{tid}.{tok}')
")
demander() { # identifiant cle -> code
  curl -s -o "$TMP/auth.json" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $JETON" -H 'content-type: application/json' \
    -d "$(python3 -c "
import json,sys
print(json.dumps({'type':'public_key','username':sys.argv[1],'password':sys.argv[2],'ip':'127.0.0.1'}))
" "$1" "$2")" "$API/api/remote/sftp/auth"
}

# 201 et non 200 : Nest répond « created » à un POST, même quand rien n'est
# créé. Le daemon s'en accommode — la session SFTP du point 4 le prouve — donc
# on accepte les deux plutôt que d'exiger un code que le contrat n'impose pas.
code=$(demander "$IDENT" "$PUB")
case "$code" in
  200|201) printf '  OK    %-46s %s\n' "la bonne clé est acceptée" "$code" ;;
  *)       printf '  ÉCHEC %-45s attendu 200 ou 201, obtenu %s\n' "la bonne clé est acceptée" "$code" ;;
esac
verdict "$SRV" "$(jq_ "d['server']" < "$TMP/auth.json")" "elle ouvre le bon serveur"
perms=$(jq_ "len(d['permissions'])" < "$TMP/auth.json")
if [ "${perms:-0}" -gt 0 ]; then
  printf '  OK    %-46s %s\n' "des permissions sont remises au daemon" "$perms"
else
  printf '  ÉCHEC %-45s aucune\n' "des permissions sont remises au daemon"
fi

ssh-keygen -t ed25519 -N '' -C inconnue -f "$TMP/autre" >/dev/null 2>&1
code=$(demander "$IDENT" "$(cat "$TMP/autre.pub")")
if [ "$code" = "200" ]; then printf '  ÉCHEC %-45s une clé inconnue est acceptée\n' "une clé inconnue est refusée"
else printf '  OK    %-46s %s\n' "une clé inconnue est refusée" "$code"; fi

code=$(demander "$EMAIL.zzzzzzzz" "$PUB")
if [ "$code" = "200" ]; then printf '  ÉCHEC %-45s un serveur inconnu est accepte\n' "un serveur inconnu est refusé"
else printf '  OK    %-46s %s\n' "un serveur inconnu est refusé" "$code"; fi

# ---------------------------------------------------------------------------
titre "4. Une vraie session SFTP, jusqu'au disque"
# ---------------------------------------------------------------------------
echo "un fichier depose par SFTP" > "$TMP/envoi.txt"
sftp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
     -o LogLevel=ERROR -o BatchMode=yes -i "$TMP/cle" -P 2022 \
     "$IDENT@127.0.0.1" > "$TMP/sftp.log" 2>&1 <<SFTP
put $TMP/envoi.txt depose.txt
ls
bye
SFTP
sortie=$?
verdict "0" "$sortie" "la session SFTP aboutit"
[ "$sortie" = "0" ] || sed 's/^/    /' "$TMP/sftp.log" | head -4

# Le verdict qui compte : le fichier est-il réellement dans le volume ?
depose=/var/lib/pterodactyl/volumes/$UUID/depose.txt
verdict "oui" "$([ -f "$depose" ] && echo oui || echo non)" "le fichier est arrivé dans le volume"
[ -f "$depose" ] && echo "    contenu : $(cat "$depose")"

# Et l'inverse : ce que le daemon a posé à l'installation se lit-il ?
grep -q 'depart.txt' "$TMP/sftp.log" \
  && printf '  OK    %-46s oui\n' "le contenu du serveur est listé" \
  || printf '  ÉCHEC %-45s depart.txt absent du listing\n' "le contenu du serveur est listé"
