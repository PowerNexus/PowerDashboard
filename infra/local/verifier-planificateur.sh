#!/usr/bin/env bash
#
# Banc : une tâche planifiée part-elle vraiment, sans que personne ne clique ?
#
# C'est la promesse la moins vérifiable de l'écran « Tâches » : elle ne se
# tient pas au moment où on la fait, mais à quatre heures du matin. Celui qui
# croit avoir des sauvegardes quotidiennes ne découvre le contraire que le
# jour où il en a besoin — et ce jour-là il est trop tard.
#
# Quatre questions, dont trois qu'aucun test unitaire ne peut poser :
#
#   1. le balayage tourne-t-il **dans le processus construit** ?
#   2. l'ordre arrive-t-il **jusqu'au conteneur** ?
#   3. deux séquences se gênent-elles l'une l'autre ?
#   4. un serveur en installation voit-il son échéance consommée ?
#
# La troisième est celle qui a motivé ce banc. Les planifications étaient
# exécutées en file, attentes comprises : une séquence « prévenir les joueurs,
# attendre dix minutes, redémarrer » suspendait *tout le reste de la
# plateforme* pendant dix minutes, sans que rien ne le signale.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-plan » et retiré à la fin :
# serveur et volume (par le daemon), node, egg, localisation, planifications.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-plan'
TMP=$(mktemp -d /tmp/banc-plan.XXXXXX)
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")
J="$M-$(date +%s)-$RANDOM"
Q "insert into sessions (user_id, token_hash, expires_at, auth_method)
   values ('$ADMIN', '$(printf '%s' "$J" | sha256sum | cut -d' ' -f1)', now() + interval '60 minutes', 'password')" >/dev/null
adm() { curl -s -b "__Host-gd_session=$J" -H 'content-type: application/json' "$@"; }

# Le balayage tombe toutes les trente secondes ; deux tours laissent la marge
# d'une dérive d'horloge sans faire de ce banc une attente interminable.
TOUR=35

nettoyer() {
  titre "Nettoyage"
  if [ -n "${SRV:-}" ]; then
    Q "delete from schedule_tasks where schedule_id in
         (select id from schedules where server_id = '$SRV')" >/dev/null 2>&1
    Q "delete from schedules where server_id = '$SRV'" >/dev/null 2>&1
    rep=$(curl -s -b "__Host-gd_session=$J" -o /dev/null -w '%{http_code}' \
          -X DELETE "$API/api/v1/admin/servers/$SRV")
    echo "  suppression demandée au panel : $rep"
    # Le daemon retire le conteneur **et** le volume : le tuer avant qu'il ait
    # fini laisse les deux sur la machine. On attend.
    for i in $(seq 1 30); do
      [ -z "$(docker ps -aq --filter "name=$UUID" 2>/dev/null)" ] && break
      sleep 1
    done
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
  [ -n "${NODE:-}" ] && Q "delete from activity_logs where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bp'" >/dev/null 2>&1
  Q "delete from sessions where user_id = '$ADMIN' and expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  rm -rf "$TMP"

  titre "État final"
  echo "  serveurs      : $(Q 'select count(*) from servers')"
  echo "  nodes         : $(Q 'select count(*) from nodes')"
  echo "  planifications: $(Q 'select count(*) from schedules')"
  echo "  wings         : $(pgrep -x wings >/dev/null && echo 'ENCORE LÀ' || echo arrêté)"
  if [ -n "${UUID:-}" ]; then
    echo "  conteneurs    : $(docker ps -aq --filter "name=$UUID" 2>/dev/null | wc -l) du banc"
    [ -d "/var/lib/pterodactyl/volumes/$UUID" ] && echo "  ATTENTION le volume de $UUID survit"
  fi
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Un serveur qui tourne"
# ---------------------------------------------------------------------------
cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-plan",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal : une boucle qui parle, pour éprouver le planificateur.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh -c 'trap \"exit 0\" INT TERM; while :; do echo vivant; sleep 1 & wait; done'",
  "config": {
    "files": "{}",
    "startup": "{\"done\": \"vivant\"}",
    "logs": "{}",
    "stop": "^C"
  },
  "scripts": {
    "installation": {
      "script": "#!/bin/sh\nmkdir -p /mnt/server\necho pret > /mnt/server/temoin.txt\n",
      "container": "alpine:latest",
      "entrypoint": "sh"
    }
  },
  "variables": []
}
EGG
python3 -c "
import json
egg = json.load(open('$TMP/egg.json'))
open('$TMP/payload.json','w').write(json.dumps({'egg': egg, 'nest': 'banc-plan'}))
"
EGG_ID=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l'egg"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null

LOC=$(adm -X POST -d '{"short":"bp","long":"Banc Planificateur","countryCode":"FR"}' \
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
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8080/api/system)" = "401" ] && break
  sleep 1
done

SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":1,\"databases\":0}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
UUID=$SRV
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est installé"

adm -X POST -d '{"signal":"start"}' "$API/api/v1/client/servers/$SRV/power" >/dev/null
for i in $(seq 1 45); do
  [ -n "$(docker ps -q --filter "name=$UUID" 2>/dev/null)" ] && break
  sleep 2
done
verdict "1" "$(docker ps -q --filter "name=$UUID" 2>/dev/null | wc -l)" "un conteneur tourne"

# Une planification par la vraie route, puis son échéance ramenée dans le
# passé. Le cron sert à ce que la ligne existe telle que l'écran la crée ; on
# ne va pas attendre quatre heures du matin pour éprouver le balayage.
planifier() { # nom, action, charge, décalage
  local id
  id=$(adm -X POST -d "{\"name\":\"$1\",\"cron\":{\"minute\":\"0\",\"hour\":\"4\",\"dayOfMonth\":\"*\",\"month\":\"*\",\"dayOfWeek\":\"*\"},\"onlyWhenOnline\":false,\"isActive\":true,\"tasks\":[{\"action\":\"$2\",\"payload\":\"$3\",\"timeOffset\":$4,\"continueOnFailure\":false}]}" \
       "$API/api/v1/client/servers/$SRV/schedules" | jq_ "d['data']['id']")
  printf '%s' "$id"
}
echoir() { Q "update schedules set next_run_at = now() - interval '5 seconds' where id = '$1'" >/dev/null; }

# ---------------------------------------------------------------------------
titre "2. Personne ne clique, et l'ordre arrive au conteneur"
# ---------------------------------------------------------------------------
# Rien ici n'appelle la route « exécuter maintenant » : la question est
# justement de savoir si le balayage existe dans le processus construit.
PL_KILL=$(planifier "$M-arret" power kill 0)
[ -n "$PL_KILL" ] || { echo "  ÉCHEC création de la planification"; exit 1; }
echoir "$PL_KILL"
for i in $(seq 1 "$TOUR"); do
  [ -z "$(docker ps -q --filter "name=$UUID" 2>/dev/null)" ] && break
  sleep 1
done
verdict "0" "$(docker ps -q --filter "name=$UUID" 2>/dev/null | wc -l)" "le conteneur s est arrêté tout seul"
verdict "oui" "$([ -n "$(Q "select last_run_at from schedules where id = '$PL_KILL'")" ] && echo oui || echo non)" \
  "l exécution est datée"
verdict "" "$(Q "select coalesce(last_run_failure,'') from schedules where id = '$PL_KILL'")" \
  "sans échec retenu"
# L'échéance est repoussée à la prochaine occurrence, et non laissée dans le
# passé : sinon la tâche repartirait à chaque balayage.
verdict "f" "$(Q "select next_run_at <= now() from schedules where id = '$PL_KILL'")" \
  "la prochaine échéance est dans le futur"
# Affichée en UTC, et pas dans l'heure de la machine : c'est ainsi que
# l'expression est interprétée, et l'écran l'annonce (« Les heures sont en
# UTC, comme sur le node »). Sans cette précision ici, un « 0 4 * * * » qui
# ressort à 06:00 heure locale ressemble à une dérive.
echo "    prochaine : $(Q "select to_char(next_run_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from schedules where id = '$PL_KILL'") UTC"

# ---------------------------------------------------------------------------
titre "3. Une séquence longue n'immobilise pas les autres"
# ---------------------------------------------------------------------------
# **Le cas qui a motivé ce banc.** Deux planifications échues au même moment :
# l'une attend dix minutes avant sa première étape, l'autre part tout de
# suite. En file, la seconde ne partait qu'au bout des dix minutes — et avec
# elle les sauvegardes nocturnes de tous les autres clients.
adm -X POST -d '{"signal":"start"}' "$API/api/v1/client/servers/$SRV/power" >/dev/null
for i in $(seq 1 45); do
  [ -n "$(docker ps -q --filter "name=$UUID" 2>/dev/null)" ] && break
  sleep 2
done

PL_LENTE=$(planifier "$M-lente" command "rien" 600)
PL_VITE=$(planifier "$M-vite" power kill 0)
echoir "$PL_LENTE"
echoir "$PL_VITE"
debut=$(date +%s)
for i in $(seq 1 "$TOUR"); do
  [ -z "$(docker ps -q --filter "name=$UUID" 2>/dev/null)" ] && break
  sleep 1
done
ecoule=$(( $(date +%s) - debut ))
verdict "0" "$(docker ps -q --filter "name=$UUID" 2>/dev/null | wc -l)" "la rapide est passée devant"
echo "    elle a mis ${ecoule}s, alors que l autre attend encore 600s"
verdict "" "$(Q "select coalesce(last_run_at::text,'') from schedules where id = '$PL_LENTE'")" \
  "la lente attend toujours sa première étape"
# Et sa réservation couvre l'attente : une seconde instance du panel ne doit
# pas voir la ligne échue pendant qu'elle dort.
verdict "t" "$(Q "select next_run_at > now() + interval '9 minutes' from schedules where id = '$PL_LENTE'")" \
  "sa réservation couvre l attente"

# ---------------------------------------------------------------------------
titre "4. Un serveur occupé fait reporter, pas sauter"
# ---------------------------------------------------------------------------
# L'installation se termine d'elle-même en quelques minutes : consommer
# l'occurrence ferait perdre la sauvegarde du jour sans rien dire à personne.
# On emprunte l'état plutôt que de réinstaller — c'est la colonne que lit le
# planificateur, et la réinstallation détruirait le volume.
Q "update servers set state = 'installing' where id = '$SRV'" >/dev/null
PL_OCC=$(planifier "$M-occupe" power start 0)
echoir "$PL_OCC"
sleep "$TOUR"
verdict "" "$(Q "select coalesce(last_run_at::text,'') from schedules where id = '$PL_OCC'")" \
  "rien n a été exécuté"
verdict "0" "$(docker ps -q --filter "name=$UUID" 2>/dev/null | wc -l)" "le serveur n a pas démarré"
# Le report, c'est la réservation laissée en place : quelques minutes, et non
# la prochaine occurrence du cron — demain à quatre heures.
verdict "t" "$(Q "select next_run_at < now() + interval '1 hour' from schedules where id = '$PL_OCC'")" \
  "l échéance est reportée de quelques minutes"

Q "update servers set state = null where id = '$SRV'" >/dev/null
echoir "$PL_OCC"
for i in $(seq 1 "$TOUR"); do
  [ -n "$(docker ps -q --filter "name=$UUID" 2>/dev/null)" ] && break
  sleep 1
done
verdict "1" "$(docker ps -q --filter "name=$UUID" 2>/dev/null | wc -l)" \
  "et elle part une fois l installation finie"
