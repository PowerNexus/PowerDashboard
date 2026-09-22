#!/usr/bin/env bash
#
# Banc : le cycle de vie complet d'un serveur, contre un vrai daemon.
#
# La seconde moitié du contrat Wings. La première — le daemon accepte la
# configuration du panel et s'authentifie — est prouvée par
# `verifier-wings.sh`. Celle-ci va au bout : créer un serveur, le laisser
# s'installer, le démarrer, le voir vivre, le supprimer.
#
# Ce que ce banc cherche vraiment : **le panel dit-il au daemon ce qu'il faut,
# et sait-il lire ce que le daemon lui répond ?** Les événements
# d'installation, l'état de gestion, la date d'installation, le volume sur le
# disque. Aucun test unitaire ne peut répondre à cela.
#
# L'egg est minimal et local : une image `alpine`, un script qui écrit un
# fichier témoin. Pas de jeu à télécharger, et le témoin prouve que le script
# s'est **réellement exécuté** plutôt que de se fier à un état en base.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-cycle » et supprimé à la fin :
# serveur (volume compris, par le daemon), node, egg, localisation. Wings est
# arrêté et sa configuration retirée.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-cycle'
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")
J="$M-$(date +%s)-$RANDOM"
Q "insert into sessions (user_id, token_hash, expires_at, auth_method)
   values ('$ADMIN', '$(printf '%s' "$J" | sha256sum | cut -d' ' -f1)', now() + interval '60 minutes', 'password')" >/dev/null
adm() { curl -s -b "__Host-gd_session=$J" -H 'content-type: application/json' "$@"; }

nettoyer() {
  titre "Nettoyage"
  # La suppression est demandée au panel, qui la relaie au daemon : c'est
  # **lui** qui retire le conteneur et le volume. Tuer le daemon deux secondes
  # plus tard interrompt son travail — et laisse un conteneur en marche et un
  # volume sur le disque. C'est arrivé.
  if [ -n "${SRV:-}" ]; then
    # Le code de retour est **affiché**, pas avale : un refus silencieux ici
    # ressemble trait pour trait a un daemon qui n'aurait rien recu.
    rep=$(curl -s -b "__Host-gd_session=$J" -o /tmp/del.json -w '%{http_code}'       -X DELETE "$API/api/v1/admin/servers/$SRV")
    echo "  suppression demandee au panel : $rep"
    [ "$rep" = "200" ] || head -c 200 /tmp/del.json | sed 's/^/    /'
    rm -f /tmp/del.json
    for i in $(seq 1 30); do
      [ -z "$(docker ps -aq --filter "name=$UUID" 2>/dev/null)" ] && break
      sleep 1
    done
    reste_c=$(docker ps -aq --filter "name=$UUID" 2>/dev/null | wc -l)
    [ "$reste_c" = "0" ] || echo "  ATTENTION le conteneur $UUID survit — retirez-le à la main"
  fi

  if [ -f /tmp/wings-cycle.pid ]; then
    kill -TERM -- "-$(cat /tmp/wings-cycle.pid)" 2>/dev/null || kill -TERM "$(cat /tmp/wings-cycle.pid)" 2>/dev/null
    sleep 2
    kill -KILL -- "-$(cat /tmp/wings-cycle.pid)" 2>/dev/null
    rm -f /tmp/wings-cycle.pid
  fi
  [ -n "${SRV:-}" ] && Q "delete from activity_logs where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "update allocations set server_id = null where server_id = '$SRV'" >/dev/null 2>&1
  [ -n "${SRV:-}" ] && Q "delete from servers where id = '$SRV'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from allocations where node_id = '$NODE'" >/dev/null 2>&1
  [ -n "${NODE:-}" ] && Q "delete from nodes where id = '$NODE'" >/dev/null 2>&1
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bc'" >/dev/null 2>&1
  Q "delete from sessions where user_id = '$ADMIN' and expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  if [ -n "${UUID:-}" ] && [ -d "/var/lib/pterodactyl/volumes/$UUID" ]; then
    echo "  ATTENTION le volume de $UUID survit — le daemon n'a pas fini"
  fi

  titre "État final"
  echo "  serveurs      : $(Q 'select count(*) from servers')"
  echo "  nodes         : $(Q 'select count(*) from nodes')"
  echo "  eggs d'essai  : $(Q "select count(*) from eggs where name = '$M'")"
  echo "  localisations : $(Q 'select count(*) from locations')"
  echo "  wings         : $(pgrep -x wings >/dev/null && echo 'ENCORE LÀ' || echo arrêté)"
  # Sans identifiant, `--filter name=` correspond a TOUT : le compte
  # affichait les conteneurs de developpement de la machine comme s'ils
  # venaient du banc.
  if [ -n "${UUID:-}" ]; then
    echo "  conteneurs    : $(docker ps -aq --filter "name=$UUID" 2>/dev/null | wc -l) du banc"
  else
    echo "  conteneurs    : aucun serveur cree, rien a compter"
  fi
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Un egg minimal, importé par la vraie route"
# ---------------------------------------------------------------------------
cat > /tmp/egg-cycle.json <<'EGG'
{
  "name": "banc-cycle",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal : une boucle qui parle, pour éprouver le cycle de vie.",
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
      "script": "#!/bin/sh\necho 'installation du banc en cours'\nmkdir -p /mnt/server\necho 'le script a tourne' > /mnt/server/temoin.txt\necho 'installation du banc terminee'\n",
      "container": "alpine:latest",
      "entrypoint": "sh"
    }
  },
  "variables": []
}
EGG
# Le corps passe par un fichier, pas par un tube : `-d @-` lit l'entrée
# standard, et celle-ci ne traverse pas la fonction `adm`. L'import
# echouait donc sur un corps vide, ce qui ressemblait a un egg refuse.
python3 -c "
import json
egg = json.load(open('/tmp/egg-cycle.json'))
open('/tmp/egg-payload.json','w').write(json.dumps({'egg': egg, 'nest': 'banc-cycle'}))
"
EGG_ID=$(adm -X POST -d @/tmp/egg-payload.json "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
rm -f /tmp/egg-payload.json
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l'egg"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null
verdict "t" "$(Q "select enabled from eggs where id = '$EGG_ID'")" "egg importé et activé"

# ---------------------------------------------------------------------------
titre "2. Une machine, avec des ports"
# ---------------------------------------------------------------------------
LOC=$(adm -X POST -d '{"short":"bc","long":"Banc Cycle","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
adm -X POST -d '{"ip":"127.0.0.1","from":42100,"to":42104}' \
  "$API/api/v1/admin/nodes/$NODE/allocations" >/dev/null
verdict "5" "$(Q "select count(*) from allocations where node_id = '$NODE'")" "cinq ports au stock"

# ---------------------------------------------------------------------------
titre "3. Le daemon démarre"
# ---------------------------------------------------------------------------
adm "$API/api/v1/admin/nodes/$NODE/configuration" | jq_ "d['data']['yaml']" > /tmp/wings-cycle.yml
install -d /etc/pterodactyl /var/lib/pterodactyl /var/log/pterodactyl
cp /tmp/wings-cycle.yml /etc/pterodactyl/config.yml
chmod 600 /etc/pterodactyl/config.yml
rm -f /tmp/wings-cycle.yml /tmp/egg-cycle.json
setsid wings --config /etc/pterodactyl/config.yml >/var/log/pterodactyl/wings-cycle.log 2>&1 &
echo $! > /tmp/wings-cycle.pid
for i in $(seq 1 20); do
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:8080/api/system && break
  sleep 1
done
verdict "401" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/api/system)" "le daemon écoute"

# ---------------------------------------------------------------------------
titre "4. Le panel crée un serveur"
# ---------------------------------------------------------------------------
SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":1,\"databases\":0}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
UUID=$(Q "select id from servers where id = '$SRV'")
echo "  serveur $SRV"
verdict "installing" "$(Q "select coalesce(state::text,'') from servers where id = '$SRV'")" "marqué en installation"

# ---------------------------------------------------------------------------
titre "5. L'installation se déroule vraiment"
# ---------------------------------------------------------------------------
# Jusqu'à trois minutes : la première fois, le daemon tire l'image alpine.
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "l état de gestion se libère"
verdict "oui" "$([ -n "$(Q "select installed_at from servers where id = '$SRV'")" ] && echo oui || echo non)" "la date d installation est posée"

# Le témoin : la preuve que le script d'installation a tourné pour de bon.
# Un état en base ne dit que ce que le panel a cru comprendre.
temoin=/var/lib/pterodactyl/volumes/$UUID/temoin.txt
verdict "oui" "$([ -f "$temoin" ] && echo oui || echo non)" "le script a écrit son témoin dans le volume"
[ -f "$temoin" ] && echo "    contenu : $(cat "$temoin")"

echo "  ce que le daemon a dit de l installation :"
grep -iE 'install' /var/log/pterodactyl/wings-cycle.log | tail -4 | sed 's/^/    /' | cut -c1-140

# ---------------------------------------------------------------------------
titre "6. Le panel démarre le serveur et lui transmet ses paramètres"
# ---------------------------------------------------------------------------
# **Ce qu'on vérifie ici est la moitié du contrat qui appartient au panel.**
#
# Wings ne met pas la commande de démarrage dans le `Cmd` du conteneur : il
# l'exporte en variable `STARTUP` et compte sur l'entrypoint de l'image pour
# l'exécuter. C'est le contrat des images « yolks » de Pterodactyl. Une image
# nue comme `alpine` ne l'honore pas et lance son shell par défaut — ce qui
# ressemble, à tort, à un panel qui n'aurait rien transmis.
#
# On mesure donc ce dont le panel répond : la commande, la mémoire et le port
# alloué, arrivés intacts dans l'environnement du conteneur. Que le programme
# démarre ensuite dépend de l'image, pas de nous.
adm -X POST -d '{"signal":"start"}' "$API/api/v1/client/servers/$SRV/power" >/dev/null
for i in $(seq 1 45); do
  conteneur=$(docker ps --filter "name=$UUID" --format '{{.Status}}' 2>/dev/null | head -1)
  [ -n "$conteneur" ] && break
  sleep 2
done
verdict "oui" "$([ -n "$conteneur" ] && echo oui || echo non)" "un conteneur tourne"
[ -n "$conteneur" ] && echo "    $conteneur"

env_de() { docker inspect "$UUID" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep "^$1=" | cut -d= -f2-; }
attendu_startup=$(Q "select startup from servers where id = '$SRV'")
verdict "$attendu_startup" "$(env_de STARTUP)" "la commande de démarrage est transmise"
verdict "512" "$(env_de SERVER_MEMORY)" "la limite de mémoire est transmise"
verdict "42100" "$(env_de SERVER_PORT)" "le port alloué est transmis"

# ---------------------------------------------------------------------------
titre "7. Le panel l'arrête"
# ---------------------------------------------------------------------------
# `kill` et non `stop` : l'arrêt propre envoie le signal déclaré par l'egg, et
# un processus qui ne l'écoute pas survit jusqu'au délai de grâce. `kill` ne
# dépend d'aucune coopération du programme — c'est donc lui qui répond à la
# question « le panel sait-il arrêter un conteneur ? ».
adm -X POST -d '{"signal":"kill"}' "$API/api/v1/client/servers/$SRV/power" >/dev/null
for i in $(seq 1 30); do
  docker ps -q --filter "name=$UUID" 2>/dev/null | grep -q . || break
  sleep 2
done
verdict "0" "$(docker ps -q --filter "name=$UUID" 2>/dev/null | wc -l)" "plus aucun conteneur en marche"
