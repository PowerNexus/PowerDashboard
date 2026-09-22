#!/usr/bin/env bash
#
# Banc : un vrai daemon Wings, contre le panel local.
#
# C'est le plus grand angle mort du projet. Tout le panel est écrit autour du
# contrat de Wings — routes imposées, événements d'installation, états
# protégés — et ce contrat n'a jamais été éprouvé qu'en **lisant** la source du
# daemon. Lire dit ce qu'il attend ; seul l'exécuter dit si on le lui donne.
#
# Trois questions, dans l'ordre où elles comptent :
#   1. le daemon accepte-t-il la configuration que le panel fabrique ?
#   2. s'authentifie-t-il, et le panel enregistre-t-il son battement de cœur ?
#   3. le panel le voit-il « opérationnel » ?
#
# RÈGLE DE SÛRETÉ — un node et une localisation marqués « banc-wings »,
# supprimés à la fin. Wings est arrêté et sa configuration retirée. Aucun
# conteneur de jeu n'est créé à ce stade.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1" 2>&1 | grep -viE 'requiretty|Defaults:ds|\^~'; }
titre() { printf '\n== %s\n' "$1"; }
verdict() {
  if [ "$1" = "$2" ]; then printf '  OK    %-46s %s\n' "$3" "$2"
  else printf '  ÉCHEC %-45s attendu %s, obtenu %s\n' "$3" "$1" "$2"; fi
}

M='banc-wings'
ADMIN=$(Q "select id from users where role = 'admin' order by created_at limit 1")
J="banc-$(date +%s)-$RANDOM"
Q "insert into sessions (user_id, token_hash, expires_at, auth_method)
   values ('$ADMIN', '$(printf '%s' "$J" | sha256sum | cut -d' ' -f1)', now() + interval '30 minutes', 'password')" >/dev/null
adm() { curl -s -b "__Host-gd_session=$J" -H 'content-type: application/json' "$@"; }

# La plateforme exige une seconde preuve d'identite pour l'administration, et
# c'est le bon reglage : un panel qui s'installe sans elle laisse le compte le
# plus puissant derriere un seul mot de passe. On la leve le temps du banc, et
# le `trap` la remet meme si le banc s'interrompt en chemin.
regler_2fa() {
  sudo -u postgres psql -d gamedashboard -q -c     "insert into settings (key, value) values ('security.staffRequires2fa', '$1'::jsonb)
     on conflict (key) do update set value = '$1'::jsonb, updated_at = now()"
}
AVANT_2FA=$(sudo -u postgres psql -d gamedashboard -tAqc \
  "select coalesce((select value::text from settings where key = 'security.staffRequires2fa'), 'true')")

# En cas de doute, on restaure le **plus strict**.
#
# Lire « false » ici ne veut pas dire que l'exploitant l'a voulu : cela veut
# surtout dire qu'un passage précédent est mort avant sa restauration. C'est
# arrivé, et le réglage est resté abaissé sans que rien ne le signale. Le repli
# du catalogue est `true` ; qui veut vraiment `false` le repose en un clic,
# tandis qu'un `false` oublié ne se remarque pas.
[ "$AVANT_2FA" = "false" ] && AVANT_2FA=true

regler_2fa false
trap 'regler_2fa "$AVANT_2FA"; echo "  2fa exigé : $(sudo -u postgres psql -d gamedashboard -tAqc "select value::text from settings where key = '"'"'security.staffRequires2fa'"'"'")"' EXIT

titre "1. Le panel décrit une machine"
LOC=$(adm -X POST -d '{"short":"bw","long":"Banc Wings","countryCode":"FR"}' "$API/api/v1/admin/locations" \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)
[ -n "$LOC" ] || { echo "  ÉCHEC création de la localisation"; exit 1; }
NODE=$(adm -X POST -d "{\"name\":\"$M\",\"locationId\":\"$LOC\",\"fqdn\":\"127.0.0.1\",\"scheme\":\"http\",\"daemonPort\":8080,\"daemonSftpPort\":2022,\"memoryMb\":4096,\"diskMb\":20480,\"cpuCores\":4}" \
       "$API/api/v1/admin/nodes" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)
[ -n "$NODE" ] || { echo "  ÉCHEC création du node"; exit 1; }
echo "  node $NODE"

titre "2. Le panel fabrique le config.yml du daemon"
adm "$API/api/v1/admin/nodes/$NODE/configuration" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["yaml"])' > /tmp/wings-config.yml 2>/dev/null
verdict "oui" "$([ -s /tmp/wings-config.yml ] && echo oui || echo non)" "un fichier est rendu"
echo "  clés reçues : $(grep -cE '^[a-z_]+:' /tmp/wings-config.yml) sections"
# Le jeton ne s'affiche pas : il confère un pouvoir total sur la machine.
sed -n '1,8p' /tmp/wings-config.yml | sed 's/token.*/token: <masqué>/' | sed 's/^/    /'

install -d /etc/pterodactyl
cp /tmp/wings-config.yml /etc/pterodactyl/config.yml
chmod 600 /etc/pterodactyl/config.yml

titre "3. Le daemon démarre avec ce fichier"
install -d /var/lib/pterodactyl /var/log/pterodactyl
setsid wings --config /etc/pterodactyl/config.yml >/var/log/pterodactyl/wings.log 2>&1 &
echo $! > /tmp/wings.pid
sleep 8
vivant=$(kill -0 "$(cat /tmp/wings.pid)" 2>/dev/null && echo oui || echo non)
verdict "oui" "$vivant" "le processus tient debout"
echo "  dernières lignes du daemon :"
tail -6 /var/log/pterodactyl/wings.log | sed 's/^/    /' | cut -c1-150

titre "4. Le panel reçoit son battement de cœur"
for i in $(seq 1 20); do
  HB=$(Q "select coalesce(last_heartbeat_at::text, '') from nodes where id = '$NODE'")
  [ -n "$HB" ] && break
  sleep 2
done
verdict "oui" "$([ -n "$HB" ] && echo oui || echo non)" "un battement est enregistré"
[ -n "$HB" ] && echo "    reçu à $HB"

titre "5. Le battement est frais, donc le node est « opérationnel »"
# L'API ne rend **pas** de statut calculé, et c'est voulu : le figer au moment
# de la requête donnerait une conclusion périmée pendant qu'on regarde la page.
# Elle rend l'heure du dernier battement, et `nodeStatus()` tranche côté
# lecteur. On vérifie donc ce qui est de notre ressort : la fraîcheur.
age=$(Q "select round(extract(epoch from now() - last_heartbeat_at)) from nodes where id = '$NODE'")
if [ -n "$age" ] && [ "$age" -lt 30 ]; then
  printf '  OK    %-46s %ss
' "battement vieux de moins de 30 s" "$age"
else
  printf '  ÉCHEC %-45s %s
' "battement frais" "${age:-aucun}"
fi
# Et ce que le daemon a répondu au panel quand celui-ci l'a interrogé.
sys=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/api/system 2>/dev/null)
verdict "401" "$sys" "le daemon refuse un appel sans jeton"

titre "Nettoyage"
kill -TERM -- "-$(cat /tmp/wings.pid)" 2>/dev/null || kill -TERM "$(cat /tmp/wings.pid)" 2>/dev/null
sleep 2
kill -KILL -- "-$(cat /tmp/wings.pid)" 2>/dev/null
rm -f /tmp/wings.pid /tmp/wings-config.yml /etc/pterodactyl/config.yml
Q "delete from activity_logs where node_id = '$NODE'" >/dev/null 2>&1
Q "delete from nodes where id = '$NODE'" >/dev/null
Q "delete from locations where lower(short) = 'bw'" >/dev/null
Q "delete from sessions where user_id = '$ADMIN' and expires_at < now() + interval '35 minutes'" >/dev/null

titre "État final"
echo "  nodes d'essai   : $(Q "select count(*) from nodes where name = '$M'")"
echo "  nodes restants  : $(Q "select count(*) from nodes")"
echo "  localisations   : $(Q "select count(*) from locations")"
echo "  config du daemon: $([ -f /etc/pterodactyl/config.yml ] && echo RESTE || echo retirée)"
echo "  wings en marche : $(pgrep -x wings >/dev/null && echo OUI || echo non)"
