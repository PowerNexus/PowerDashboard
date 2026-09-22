#!/usr/bin/env bash
#
# Banc : les bases de données, jusqu'à une connexion qui s'ouvre vraiment.
#
# L'écran « Bases de données » d'un serveur promet : « créez une base, voici
# l'adresse, l'identifiant et le mot de passe ». Cette promesse n'a de valeur
# que si l'on peut **s'y connecter**. Une ligne en base du panel ne prouve
# rien : elle décrit ce que le panel croit avoir fait sur un serveur MySQL
# qu'il ne relit jamais.
#
# Cinq questions :
#   1. le panel sait-il éprouver un hôte avant de l'enregistrer ?
#   2. la création rend-elle des identifiants ?
#   3. **ces identifiants ouvrent-ils réellement une connexion ?**
#   4. le quota refuse-t-il la base de trop ?
#   5. la suppression retire-t-elle la base du serveur MySQL, et pas seulement
#      la ligne du panel ?
#
# Ce banc n'a pas besoin de Wings : le provisionnement de bases ne passe pas
# par le daemon. Le serveur d'essai est donc inscrit directement, ce qui évite
# d'en installer un pour rien — sa création est déjà prouvée ailleurs.
#
# RÈGLE DE SÛRETÉ — un conteneur MySQL **dédié**, retiré à la fin : celui de
# votre environnement de développement n'est ni lu ni touché. Tout le reste
# est marqué « banc-bdd ».

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
PORT_MYSQL=43306
CONTENEUR=banc-bdd-mysql
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-bdd'
TMP=$(mktemp -d /tmp/banc-bdd.XXXXXX)
RACINE=$(openssl rand -hex 12)
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")
CLIENT=$(Q "select id from users where role = 'user' order by created_at limit 1")
[ -n "$CLIENT" ] || { echo "aucun compte client — lancez creer-compte.sh"; exit 1; }

session() {
  local j="$M-$(date +%s)-$RANDOM"
  Q "insert into sessions (user_id, token_hash, expires_at, auth_method)
     values ('$1', '$(printf '%s' "$j" | sha256sum | cut -d' ' -f1)', now() + interval '60 minutes', 'password')" >/dev/null
  printf '%s' "$j"
}
JA=$(session "$ADMIN"); JC=$(session "$CLIENT")
adm() { curl -s -b "__Host-gd_session=$JA" -H 'content-type: application/json' "$@"; }
cli() { curl -s -b "__Host-gd_session=$JC" -H 'content-type: application/json' "$@"; }
sql() { mysql --protocol=TCP -h 127.0.0.1 -P "$PORT_MYSQL" -u root -p"$RACINE" -N -B -e "$1" 2>/dev/null; }

nettoyer() {
  titre "Nettoyage"
  [ -n "${HOTE:-}" ] && adm -o /dev/null -X DELETE "$API/api/v1/admin/database-hosts/$HOTE"
  # Le filet : un hôte laissé derrière porte un mot de passe root chiffré et
  # se retrouverait proposé au prochain serveur créé. C'est arrivé deux fois.
  Q "delete from database_hosts where name = '$M'" >/dev/null 2>&1
  if [ -n "${SRV:-}" ]; then
    curl -s -b "__Host-gd_session=$JA" -o /dev/null -X DELETE "$API/api/v1/admin/servers/$SRV"
    for i in $(seq 1 20); do
      [ -z "$(docker ps -aq --filter "name=$SRV" 2>/dev/null)" ] && break
      sleep 1
    done
  fi
  if [ -f "$TMP/wings.pid" ]; then
    kill -TERM -- "-$(cat "$TMP/wings.pid")" 2>/dev/null || kill -TERM "$(cat "$TMP/wings.pid")" 2>/dev/null
    sleep 2
    kill -KILL -- "-$(cat "$TMP/wings.pid")" 2>/dev/null
  fi
  rm -f /etc/pterodactyl/config.yml
  [ -n "${SRV:-}" ] && Q "delete from databases where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from activity_logs where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "update allocations set server_id = null where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from servers where id = '$SRV'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from allocations where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bd'" >/dev/null 2>&1
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  docker rm -f "$CONTENEUR" >/dev/null 2>&1 && echo "  conteneur MySQL du banc retiré"
  rm -rf "$TMP"

  titre "État final"
  echo "  serveurs        : $(Q 'select count(*) from servers')"
  echo "  bases inscrites : $(Q 'select count(*) from databases')"
  echo "  hôtes de bases  : $(Q 'select count(*) from database_hosts')"
  echo "  nodes           : $(Q 'select count(*) from nodes')"
  echo "  conteneur banc  : $(docker ps -aq --filter "name=$CONTENEUR" | wc -l)"
  echo "  vos conteneurs  : $(docker ps --format '{{.Names}}' | grep -c . ) en marche (intouchés)"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Un serveur MySQL dédié au banc"
# ---------------------------------------------------------------------------
docker rm -f "$CONTENEUR" >/dev/null 2>&1
docker run -d --name "$CONTENEUR" \
  -e MYSQL_ROOT_PASSWORD="$RACINE" \
  -p "127.0.0.1:$PORT_MYSQL:3306" mysql:8.4 >/dev/null 2>&1
for i in $(seq 1 60); do
  sql 'select 1' >/dev/null 2>&1 && break
  sleep 2
done
verdict "1" "$(sql 'select 1')" "il accepte les connexions"

# ---------------------------------------------------------------------------
titre "2. Le panel éprouve l'hôte avant de l'enregistrer"
# ---------------------------------------------------------------------------
corps="{\"name\":\"$M\",\"host\":\"127.0.0.1\",\"port\":$PORT_MYSQL,\"username\":\"root\",\"password\":\"$RACINE\"}"
# La sonde rend la version de l'hôte et s'il peut créer des bases : deux
# faits, pas un booléen — c'est plus utile à l'écran qu'un « ça marche ».
essai=$(adm -X POST -d "$corps" "$API/api/v1/admin/database-hosts/test")
version=$(printf '%s' "$essai" | jq_ "d['data']['version']")
verdict "oui" "$([ -n "$version" ] && echo oui || echo non)" "l essai rend la version de l hôte"
[ -n "$version" ] && echo "    version : $version"
verdict "true" "$(printf '%s' "$essai" | jq_ "str(d['data']['canCreate']).lower()")" "et confirme qu il peut créer des bases"

# Un mot de passe faux doit échouer : sans cela, l'essai ne prouverait rien.
code=$(adm -o /dev/null -w '%{http_code}' -X POST \
  -d "{\"name\":\"$M\",\"host\":\"127.0.0.1\",\"port\":$PORT_MYSQL,\"username\":\"root\",\"password\":\"faux\"}" \
  "$API/api/v1/admin/database-hosts/test")
case "$code" in
  200|201) printf '  ÉCHEC %-45s un mauvais mot de passe passe (%s)\n' "un mauvais mot de passe est refusé" "$code" ;;
  *)       printf '  OK    %-46s %s\n' "un mauvais mot de passe est refusé" "$code" ;;
esac

HOTE=$(adm -X POST -d "$corps" "$API/api/v1/admin/database-hosts" | jq_ "d['data']['id']")
verdict "oui" "$([ -n "$HOTE" ] && echo oui || echo non)" "l hôte est enregistré"

# ---------------------------------------------------------------------------
titre "3. Un serveur, et une base créée par son client"
# ---------------------------------------------------------------------------
# Le décor passe par les **vraies routes**, comme dans les autres bancs.
#
# J'avais d'abord inscrit le serveur directement en base, au motif que les
# bases de données ne passent pas par le daemon. Mauvais calcul : recopier la
# forme de six tables à la main, c'est se tromper de colonne et passer son
# temps à déboguer l'échafaudage plutôt que le produit. Le détour par le
# daemon coûte une minute et ne ment pas.
LOC=$(adm -X POST -d '{"short":"bd","long":"Banc Bases","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
# Un egg minimal, importé ici. Les autres bancs nettoient les leurs, et
# supposer qu'il en traîne un rendrait ce banc dépendant de l'ordre des
# passages — il a échoué exactement ainsi au premier essai.
cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-bdd",
  "author": "banc@gamedashboard.local",
  "description": "Egg jamais installé : il ne sert qu'à rattacher un serveur d'essai.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh",
  "config": { "files": "{}", "startup": "{}", "logs": "{}", "stop": "^C" },
  "scripts": { "installation": { "script": "echo", "container": "alpine:latest", "entrypoint": "sh" } },
  "variables": []
}
EGG
python3 -c "
import json
open('$TMP/payload.json','w').write(json.dumps({'egg': json.load(open('$TMP/egg.json')), 'nest': 'banc-bdd'}))
"
EGG=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG" ] || { echo "  ÉCHEC import de l egg"; exit 1; }
# Un egg importé arrive **désactivé** : le catalogue ne sert que ceux qu'un
# administrateur a relus. L'oublier fait échouer la création sans rien dire
# du pourquoi.
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG/enabled" >/dev/null
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
adm -X POST -d '{"ip":"127.0.0.1","from":42500,"to":42502}' \
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

# Une seule base autorisée : c'est ainsi qu'on éprouve le quota.
SRV=$(adm -X POST -d "{\"eggId\":\"$EGG\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"ownerId\":\"$CLIENT\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":0,\"databases\":1}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est prêt"

rep=$(cli -X POST -d '{"name":"essai"}' "$API/api/v1/client/servers/$SRV/databases")
BDD=$(printf '%s' "$rep" | jq_ "d['data']['id']")
NOM=$(printf '%s' "$rep" | jq_ "d['data']['name']")
UTIL=$(printf '%s' "$rep" | jq_ "d['data']['username']")
MDP=$(printf '%s' "$rep" | jq_ "d['data'].get('password','')")
verdict "oui" "$([ -n "$BDD" ] && echo oui || echo non)" "la base est créée"
if [ -z "$BDD" ]; then
  # Ce que le panel a répondu, plutôt qu'un « non » sans explication : un
  # refus muet ici oblige à tout rejouer pour savoir pourquoi.
  echo "    le panel a répondu : $(printf '%s' "$rep" | head -c 250)"
  exit 1
fi
echo "    base $NOM · identifiant $UTIL"

# Le mot de passe se lit par sa route dédiée s'il n'accompagne pas la création.
[ -n "$MDP" ] || MDP=$(cli "$API/api/v1/client/servers/$SRV/databases/$BDD/password" | jq_ "d['data']['password']")
verdict "oui" "$([ -n "$MDP" ] && echo oui || echo non)" "un mot de passe est remis au client"

# ---------------------------------------------------------------------------
titre "4. Ces identifiants ouvrent vraiment une connexion"
# ---------------------------------------------------------------------------
# Le seul verdict qui compte. Tout le reste peut réussir sur une base que
# personne ne peut ouvrir.
# `connect-timeout` : sans identifiants, le client attendrait une invite qui
# ne viendra jamais — c'est ainsi qu'un banc en échec se met à durer huit
# minutes au lieu d'échouer franchement.
ouvre() {
  mysql --protocol=TCP --connect-timeout=5 -h 127.0.0.1 -P "$PORT_MYSQL" \
    -u "$UTIL" -p"$MDP" -N -B -e "$1" 2>"$TMP/mysql.err"
}
verdict "1" "$(ouvre 'select 1')" "le client se connecte avec ce qu on lui a donné"
verdict "$NOM" "$(ouvre "select schema_name from information_schema.schemata where schema_name = '$NOM'")" "et il voit sa base"
ouvre "create table \`$NOM\`.marque (id int)" >/dev/null
verdict "marque" "$(ouvre "select table_name from information_schema.tables where table_schema = '$NOM'")" "il peut y écrire"
[ -s "$TMP/mysql.err" ] && sed 's/^/    /' "$TMP/mysql.err" | head -3

# Et ce qu'il ne doit pas pouvoir faire : voir les bases des autres clients.
#
# `performance_schema` reste visible de tout le monde chez MySQL — ce n'est
# pas une fuite, c'est un catalogue interne sans données de client. On ne
# compte donc que ce qui pourrait appartenir à quelqu'un.
autres=$(ouvre "select group_concat(schema_name) from information_schema.schemata
                where schema_name not in ('$NOM','information_schema','performance_schema','sys')")
if [ -z "$autres" ] || [ "$autres" = "NULL" ]; then
  printf '  OK    %-46s aucune\n' "il ne voit la base d aucun autre client"
else
  printf '  ÉCHEC %-45s il voit : %s\n' "il ne voit la base d aucun autre client" "$autres"
fi

# ---------------------------------------------------------------------------
titre "5. Le quota refuse la base de trop"
# ---------------------------------------------------------------------------
code=$(cli -o /dev/null -w '%{http_code}' -X POST -d '{"name":"la trop"}' \
  "$API/api/v1/client/servers/$SRV/databases")
verdict "409" "$code" "une seconde base est refusée"
verdict "1" "$(Q "select count(*) from databases where server_id = '$SRV'")" "et rien n est inscrit"

# ---------------------------------------------------------------------------
titre "6. La suppression retire la base du serveur MySQL"
# ---------------------------------------------------------------------------
# Une ligne effacée dans le panel qui laisserait la base derrière elle
# occuperait le disque de l'hôte sans que rien ne la rattache plus à personne.
# Sans l'en-tête JSON : une suppression n'a pas de corps, et Fastify refuse
# un `content-type: application/json` sans rien derrière. L'interface ne pose
# cet en-tête que lorsqu'il y a un corps — le banc doit faire pareil.
code=$(curl -s -b "__Host-gd_session=$JC" -o /dev/null -w '%{http_code}' \
  -X DELETE "$API/api/v1/client/servers/$SRV/databases/$BDD")
verdict "200" "$code" "la suppression est acceptée"
verdict "" "$(sql "select schema_name from information_schema.schemata where schema_name = '$NOM'")" "la base a disparu de l hôte"
verdict "" "$(sql "select user from mysql.user where user = '$UTIL'")" "et son utilisateur aussi"
