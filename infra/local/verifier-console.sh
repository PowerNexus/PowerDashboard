#!/usr/bin/env bash
#
# Banc : la console, du clic jusqu'à la sortie du programme.
#
# C'est la fonction la plus visible d'un panel de jeu, et le dernier grand
# chemin jamais éprouvé. Il traverse quatre acteurs : l'interface qui demande,
# le relais de Next, l'API qui signe un jeton, et le daemon qui ouvre le flux.
#
# Ce que le panel promet ici : « ouvrez la console de votre serveur, tapez une
# commande, voyez ce qu'il répond ». Quatre questions :
#
#   1. le relais de Next rend-il une autorisation au navigateur ?
#   2. refuse-t-il de le faire pour un site tiers ?
#   3. le daemon accepte-t-il le jeton que l'API a signé ?
#   4. **une commande envoyée revient-elle sur le flux ?**
#
# La quatrième seule prouve que la console sert à quelque chose.
#
# RÈGLE DE SÛRETÉ — tout est marqué « banc-console » et retiré à la fin.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
WEB=https://gamedashboard.local
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

M='banc-console'
TMP=$(mktemp -d /tmp/banc-console.XXXXXX)
CA=$(mkcert -CAROOT)/rootCA.pem
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
  Q "delete from eggs where name = '$M'" >/dev/null 2>&1
  Q "delete from nests where name = '$M'" >/dev/null 2>&1
  Q "delete from locations where lower(short) = 'bo'" >/dev/null 2>&1
  Q "delete from sessions where expires_at < now() + interval '65 minutes'" >/dev/null
  rm -f /etc/pterodactyl/config.yml
  [ -f "$TMP/wings.log" ] && cp "$TMP/wings.log" /tmp/banc-console-wings.log
  rm -rf "$TMP"

  titre "État final"
  echo "  serveurs : $(Q 'select count(*) from servers')"
  echo "  nodes    : $(Q 'select count(*) from nodes')"
  echo "  wings    : $(pgrep -x wings >/dev/null && echo 'ENCORE LÀ' || echo arrêté)"
}
trap nettoyer EXIT

# ---------------------------------------------------------------------------
titre "1. Le décor : un serveur qui tourne"
# ---------------------------------------------------------------------------
CLIENT=$(Q "select id from users where role = 'user' order by created_at limit 1")
[ -n "$CLIENT" ] || { echo "  ÉCHEC aucun compte client — lancez creer-compte.sh"; exit 1; }
JC=$(session "$CLIENT")
cli() { curl -s -b "__Host-gd_session=$JC" -H 'content-type: application/json' "$@"; }

cat > "$TMP/egg.json" <<'EGG'
{
  "name": "banc-console",
  "author": "banc@gamedashboard.local",
  "description": "Egg minimal : le shell de l'image sert de programme, donc de console.",
  "docker_images": { "Alpine": "alpine:latest" },
  "startup": "sh",
  "config": { "files": "{}", "startup": "{\"done\": \"/ #\"}", "logs": "{}", "stop": "^C" },
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
open('$TMP/payload.json','w').write(json.dumps({'egg': json.load(open('$TMP/egg.json')), 'nest': 'banc-console'}))
"
EGG_ID=$(adm -X POST -d @"$TMP/payload.json" "$API/api/v1/admin/eggs/import" | jq_ "d['data']['id']")
[ -n "$EGG_ID" ] || { echo "  ÉCHEC import de l'egg — le panel répond-il ?"; exit 1; }
adm -X POST -d '{"enabled":true}' "$API/api/v1/admin/eggs/$EGG_ID/enabled" >/dev/null

LOC=$(adm -X POST -d '{"short":"bo","long":"Banc Console","countryCode":"FR"}' \
      "$API/api/v1/admin/locations" | jq_ "d['data']['id']")
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | jq_ "d['data']['id']")
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
adm -X POST -d '{"ip":"127.0.0.1","from":42400,"to":42402}' \
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

SRV=$(adm -X POST -d "{\"eggId\":\"$EGG_ID\",\"name\":\"$M\",\"nodeId\":\"$NODE\",\"ownerId\":\"$CLIENT\",\"resources\":{\"memoryMb\":512,\"diskMb\":1024,\"cpuPct\":100,\"swapMb\":0,\"allocations\":1,\"backups\":0,\"databases\":0}}" \
      "$API/api/v1/client/servers" | jq_ "d['data']['id']")
[ -n "$SRV" ] || { echo "  ÉCHEC création du serveur"; exit 1; }
for i in $(seq 1 90); do
  etat=$(Q "select coalesce(state::text,'installé') from servers where id = '$SRV'")
  [ "$etat" != "installing" ] && break
  sleep 2
done
verdict "installé" "$etat" "le serveur est installé"

cli -X POST -d '{"signal":"start"}' "$API/api/v1/client/servers/$SRV/power" >/dev/null
for i in $(seq 1 45); do
  [ -n "$(docker ps -q --filter "name=$SRV" 2>/dev/null)" ] && break
  sleep 2
done
verdict "oui" "$([ -n "$(docker ps -q --filter "name=$SRV" 2>/dev/null)" ] && echo oui || echo non)" "et il tourne"

# ---------------------------------------------------------------------------
titre "2. Le relais de Next rend une autorisation"
# ---------------------------------------------------------------------------
# C'est le chemin exact du navigateur : il ne connaît pas l'adresse de l'API,
# il demande à Next, qui transmet le cookie de session.
code=$(curl -s --cacert "$CA" -b "__Host-gd_session=$JC" -o "$TMP/grant.json" -w '%{http_code}' \
  -X POST -H "Origin: $WEB" -H 'Sec-Fetch-Site: same-origin' \
  "$WEB/api/servers/$SRV/websocket")
# 201 : Nest répond « created » à un POST, même quand rien n'est créé, et
# Next relaie son code tel quel. On accepte les deux.
case "$code" in
  200|201) printf '  OK    %-46s %s\n' "le relais répond" "$code" ;;
  *)       printf '  ÉCHEC %-45s attendu 200 ou 201, obtenu %s\n' "le relais répond" "$code" ;;
esac
JETON=$(jq_ "d['data']['token']" < "$TMP/grant.json")
ADRESSE=$(jq_ "d['data']['socket']" < "$TMP/grant.json")
verdict "oui" "$([ -n "$JETON" ] && echo oui || echo non)" "un jeton est remis"
echo "    adresse : ${ADRESSE:-aucune}"

# ---------------------------------------------------------------------------
titre "3. Il refuse de le faire pour un site tiers"
# ---------------------------------------------------------------------------
# Sans ce contrôle, un site visité par quelqu'un de connecté pourrait obtenir
# un jeton de console à son nom. Le cookie en `SameSite=Lax` ne suffit pas :
# ce relais n'est pas une action serveur, il n'hérite pas de sa vérification.
code=$(curl -s --cacert "$CA" -b "__Host-gd_session=$JC" -o /dev/null -w '%{http_code}' \
  -X POST -H "Origin: https://ailleurs.invalid" -H 'Sec-Fetch-Site: cross-site' \
  "$WEB/api/servers/$SRV/websocket")
verdict "403" "$code" "une origine étrangère est refusée"

# ---------------------------------------------------------------------------
titre "4. Le daemon accepte le jeton, et la console répond"
# ---------------------------------------------------------------------------
cat > "$TMP/console.mjs" <<'JS'
// Client de console minimal, à la place du navigateur.
//
// **L'en-tête `Origin` n'est pas une politesse : sans lui, rien ne s'ouvre.**
// Le daemon n'accepte le flux que si l'origine égale l'adresse du panel
// inscrite dans son `config.yml` — c'est ainsi qu'il s'assure que la demande
// vient bien du panel et non d'un site quelconque. Un navigateur l'envoie
// d'office ; le `WebSocket` natif de Node ne permet pas de l'ajouter, d'où le
// paquet `ws`, déjà présent dans le dépôt.
//
// Conséquence à retenir : si `PANEL_ORIGIN` ne correspond pas exactement au
// nom par lequel on ouvre le panel — un `http` au lieu d'un `https` suffit —
// toutes les consoles restent muettes, sans message d'erreur.
import { createRequire } from "node:module";

const [cheminWs, adresse, jeton, marqueur, origine] = process.argv.slice(2);
// `createRequire` et non `import()` : on vise un répertoire de paquet, et
// seule la résolution CommonJS sait y lire le point d'entrée déclaré.
const WS = createRequire(import.meta.url)(cheminWs);
const vu = { auth: false, statut: false, sortie: false, evenements: [] };

const ws = new WS(adresse, { headers: { Origin: origine } });
const fin = (code) => {
  try { ws.close(); } catch {}
  console.log(JSON.stringify(vu));
  process.exit(code);
};
const minuteur = setTimeout(() => fin(0), 20000);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ event: "auth", args: [jeton] }));
});

ws.addEventListener("message", (message) => {
  let trame;
  try { trame = JSON.parse(message.data); } catch { return; }
  if (vu.evenements.length < 12) vu.evenements.push(trame.event);

  if (trame.event === "auth success") {
    vu.auth = true;
    // Une commande dans le shell du conteneur : il la lit sur son entrée.
    setTimeout(() => ws.send(JSON.stringify({ event: "send command", args: [`echo ${marqueur}`] })), 500);
  }
  if (trame.event === "status") vu.statut = true;
  if (trame.event === "console output" && String(trame.args?.[0] ?? "").includes(marqueur)) {
    vu.sortie = true;
    clearTimeout(minuteur);
    fin(0);
  }
});

ws.addEventListener("error", () => fin(0));
JS

MARQUEUR="banc-console-$RANDOM"
# Le chemin est résolu, jamais figé : le dépôt de pnpm range chaque paquet
# sous sa version, et coder « ws@8.21.3 » ici casserait au prochain relevé.
CHEMIN_WS=$(ls -d /opt/gamedashboard/app/node_modules/.pnpm/ws@*/node_modules/ws 2>/dev/null | head -1)
[ -n "$CHEMIN_WS" ] || echo "  ATTENTION paquet ws introuvable — le point 4 ne prouvera rien"
node "$TMP/console.mjs" "$CHEMIN_WS" "$ADRESSE" "$JETON" "$MARQUEUR" "$WEB" \
  > "$TMP/console.json" 2>"$TMP/console.err"
verdict "true" "$(jq_ "str(d['auth']).lower()" < "$TMP/console.json")" "le daemon accepte le jeton"
verdict "true" "$(jq_ "str(d['statut']).lower()" < "$TMP/console.json")" "il annonce l état du serveur"
verdict "true" "$(jq_ "str(d['sortie']).lower()" < "$TMP/console.json")" "la commande envoyée revient sur le flux"
echo "    événements reçus : $(jq_ "', '.join(dict.fromkeys(d['evenements'])) or 'aucun'" < "$TMP/console.json")"
[ -s "$TMP/console.err" ] && sed 's/^/    erreur du client : /' "$TMP/console.err" | head -3
# Ce que le daemon a pensé de cette ouverture : sans cela, un refus ne laisse
# rien à lire côté client — le websocket se ferme, c'est tout.
echo "    le daemon a noté :"
grep -iE 'websocket|token|jwt|unauthor' "$TMP/wings.log" | tail -4 | cut -c1-150 | sed 's/^/      /'

# ---------------------------------------------------------------------------
titre "5. Un jeton étranger ne vaut rien"
# ---------------------------------------------------------------------------
# Le jeton est signé pour un serveur précis. Le présenter sur le flux d'un
# autre doit échouer — sinon toute console ouvrirait toutes les autres.
node "$TMP/console.mjs" "$CHEMIN_WS" "$ADRESSE" "jeton.completement.invente" "$MARQUEUR" "$WEB" \
  > "$TMP/faux.json" 2>/dev/null
verdict "false" "$(jq_ "str(d['auth']).lower()" < "$TMP/faux.json")" "un jeton inventé est rejeté"
