#!/bin/bash
#
# Installation d'un serveur Minecraft Java, quel que soit son chargeur.
#
# **Pourquoi un seul egg pour tous les chargeurs.** Un egg par chargeur oblige
# à changer d'egg pour passer de Paper à Forge, donc à changer la commande de
# démarrage, l'image, et toutes les variables — un déménagement, pour ce qui
# est en réalité le même jeu. Ici, changer de moteur revient à changer la
# variable `LOADER` et à réinstaller : le serveur garde son identifiant, ses
# sous-utilisateurs, ses planifications et ses fichiers.
#
# **Ce que ce script ne touche jamais** : `world/`, `world_nether/`,
# `world_the_end/`, `plugins/`, `mods/`, `server.properties`, `ops.json`,
# `whitelist.json` et `banned-*.json`. Une réinstallation change le moteur,
# pas la partie. C'est la condition pour que le changement de moteur soit un
# geste qu'on ose faire.
#
# **La commande de démarrage ne change pas non plus.** Elle vaut `bash
# gd-run.sh` pour tout le monde, et c'est ce script-ci qui écrit `gd-run.sh`
# selon ce qu'il a installé. Forge 1.17 et suivants ne produisent pas de jar
# lançable mais un fichier d'arguments ; sans cette indirection, il faudrait
# deux commandes de démarrage et donc deux eggs — ce qu'on cherchait à éviter.

set -euo pipefail

# **`set -e` et `[ test ] && commande`.** Sous `set -e`, une telle ligne fait
# sortir le script quand le test est faux : sa valeur de retour est celle du
# test, et bash n'y voit pas une condition mais un échec. Ce script s'est
# arrêté ainsi juste avant d'écrire sa commande de démarrage, parce que Forge
# 1.20.1 ne produit pas de jar universel et que `[ -f forge-*.jar ]` était donc
# faux — l'installation paraissait échouée alors que tout était en place.
# Tout ce qui est conditionnel s'écrit ici avec `if`.

echo "== Préparation"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq curl jq unzip ca-certificates >/dev/null
mkdir -p /mnt/server
cd /mnt/server

LOADER="$(echo "${LOADER:-paper}" | tr '[:upper:]' '[:lower:]')"
SERVER_JARFILE="${SERVER_JARFILE:-server.jar}"
LOADER_VERSION="${LOADER_VERSION:-latest}"

MANIFESTE="https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"

# --- Version du jeu ---------------------------------------------------------
# `latest` est résolu ici, une fois, et la valeur retenue est affichée : une
# installation qui dit « latest » dans ses journaux ne se rejoue pas à
# l'identique six mois plus tard.
if [ -z "${MINECRAFT_VERSION:-}" ] || [ "${MINECRAFT_VERSION}" = "latest" ]; then
  MINECRAFT_VERSION="$(curl -sSL "$MANIFESTE" | jq -r '.latest.release')"
  echo "   version la plus récente : ${MINECRAFT_VERSION}"
fi
echo "== Minecraft ${MINECRAFT_VERSION}, chargeur ${LOADER}"

# Le journal d'une installation ratée doit nommer la cause. `fatal` écrit une
# phrase et s'arrête, plutôt que de laisser `set -e` tuer le script sur une
# ligne que personne ne sait relier à un problème.
fatal() {
  echo "ÉCHEC : $1" >&2
  exit 1
}

# `curl` avec les garde-fous qui manquent à son comportement par défaut :
# `-f` pour qu'une page d'erreur HTML ne soit pas enregistrée comme un jar,
# `--retry` parce qu'un dépôt public refuse parfois une requête sur trois.
telecharger() {
  curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1" || fatal "téléchargement impossible : $1"
  [ -s "$2" ] || fatal "fichier vide : $2"
}

# Interroge une API d'éditeur et **nomme la panne**.
#
# Sans elle, un `curl -fsSL` dans une substitution de commande meurt sous
# `set -e` en laissant « curl: (22) The requested URL returned error: 404 » :
# on ne sait ni quelle adresse, ni quel chargeur, ni si c'est la version
# demandée qui n'existe pas ou l'éditeur qui a déplacé son API. C'est arrivé —
# les promotions de Forge ont changé d'hôte.
interroger() {
  local corps
  corps="$(curl -fsSL --retry 3 --retry-delay 2 "$1" 2>/dev/null)" \
    || fatal "l'API de l'éditeur n'a pas répondu : $1"
  printf '%s' "$corps"
}

# L'URL du serveur nu, depuis le manifeste de Mojang. Employée par `vanilla`,
# et par les chargeurs qui ont besoin du serveur d'origine à côté.
url_vanilla() {
  local version_url
  version_url="$(curl -sSL "$MANIFESTE" | jq -r --arg v "$MINECRAFT_VERSION" \
    '.versions[] | select(.id == $v) | .url')"
  [ -n "$version_url" ] || fatal "Minecraft ${MINECRAFT_VERSION} est inconnu de Mojang."
  curl -sSL "$version_url" | jq -r '.downloads.server.url // empty'
}

case "$LOADER" in
  # --- Serveurs livrés en un seul jar -------------------------------------
  vanilla)
    url="$(url_vanilla)"
    [ -n "$url" ] || fatal "Mojang ne publie pas de serveur pour ${MINECRAFT_VERSION} (antérieur à 1.2.5)."
    telecharger "$url" "$SERVER_JARFILE"
    ;;

  paper | folia | velocity | waterfall)
    # L'API v2 de PaperMC : la liste des constructions, puis le nom du
    # fichier — qui n'est pas déductible du numéro de construction.
    builds="https://api.papermc.io/v2/projects/${LOADER}/versions/${MINECRAFT_VERSION}/builds"
    if [ "$LOADER_VERSION" = "latest" ]; then
      build="$(interroger "$builds" | jq -r '[.builds[] | select(.channel == "default")] | last | .build // empty')"
      # Aucune construction stable : on prend la dernière quelle qu'elle soit,
      # plutôt que d'échouer sur une version que l'éditeur n'a pas encore
      # promue. Le journal le dit.
      if [ -z "$build" ]; then
        build="$(interroger "$builds" | jq -r '.builds | last | .build // empty')"
        echo "   aucune construction promue : ${build} (expérimentale)"
      fi
    else
      build="$LOADER_VERSION"
    fi
    [ -n "$build" ] || fatal "${LOADER} ne publie rien pour ${MINECRAFT_VERSION}."
    nom="$(interroger "${builds}/${build}" | jq -r '.downloads.application.name')"
    telecharger "${builds}/${build}/downloads/${nom}" "$SERVER_JARFILE"
    ;;

  purpur)
    base="https://api.purpurmc.org/v2/purpur/${MINECRAFT_VERSION}"
    # « latest » est une valeur que l'API de Purpur comprend telle quelle : il
    # n'y a rien à traduire.
    build="$LOADER_VERSION"
    telecharger "${base}/${build}/download" "$SERVER_JARFILE"
    ;;

  fabric)
    # La méta de Fabric rend un **jar lançable** quand on lui donne les trois
    # versions. C'est ce qui distingue Fabric de Forge, et pourquoi il n'y a
    # pas d'installeur à exécuter ici.
    loader="$LOADER_VERSION"
    if [ "$loader" = "latest" ]; then
      loader="$(interroger "https://meta.fabricmc.net/v2/versions/loader/${MINECRAFT_VERSION}" \
        | jq -r '.[0].loader.version // empty')"
    fi
    [ -n "$loader" ] || fatal "Fabric ne prend pas en charge ${MINECRAFT_VERSION}."
    installeur="$(interroger "https://meta.fabricmc.net/v2/versions/installer" | jq -r '.[0].version')"
    telecharger \
      "https://meta.fabricmc.net/v2/versions/loader/${MINECRAFT_VERSION}/${loader}/${installeur}/server/jar" \
      "$SERVER_JARFILE"
    ;;

  # --- Chargeurs livrés en installeur --------------------------------------
  quilt)
    # Quilt ne publie pas de serveur lançable : sa méta rend un profil de
    # lancement. On passe donc par son installeur, qui fabrique le serveur sur
    # place — c'est précisément ce qu'un remplacement de fichier ne peut pas
    # faire, et pourquoi Quilt reste absent de l'écran « Moteur ».
    version="$(interroger "https://meta.quiltmc.org/v3/versions/installer" | jq -r '.[0].version')"
    telecharger \
      "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${version}/quilt-installer-${version}.jar" \
      quilt-installer.jar
    java -jar quilt-installer.jar install server "$MINECRAFT_VERSION" \
      --download-server --install-dir=/mnt/server || fatal "l'installeur Quilt a échoué."
    rm -f quilt-installer.jar
    if [ -f quilt-server-launch.jar ]; then SERVER_JARFILE="quilt-server-launch.jar"; fi
    ;;

  forge)
    # Les promotions vivent sur `files.`, pas sur le maven : le maven sert les
    # artefacts, ce fichier n'en est pas un. L'y chercher donne un 404.
    promotions="https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
    version="$LOADER_VERSION"
    if [ "$version" = "latest" ]; then
      # `recommended` d'abord : c'est la construction que l'éditeur tient pour
      # sûre. À défaut, `latest`, en le disant.
      version="$(interroger "$promotions" | jq -r --arg k "${MINECRAFT_VERSION}-recommended" '.promos[$k] // empty')"
      if [ -z "$version" ]; then
        version="$(interroger "$promotions" | jq -r --arg k "${MINECRAFT_VERSION}-latest" '.promos[$k] // empty')"
        if [ -n "$version" ]; then
          echo "   aucune construction recommandée : ${version} (dernière)"
        fi
      fi
    fi
    [ -n "$version" ] || fatal "Forge ne publie rien pour ${MINECRAFT_VERSION}."

    complet="${MINECRAFT_VERSION}-${version}"
    telecharger \
      "https://maven.minecraftforge.net/net/minecraftforge/forge/${complet}/forge-${complet}-installer.jar" \
      forge-installer.jar
    echo "   exécution de l'installeur Forge (il télécharge ses bibliothèques)"
    java -jar forge-installer.jar --installServer >/dev/null || fatal "l'installeur Forge a échoué."
    rm -f forge-installer.jar forge-installer.jar.log
    # ≤ 1.16 : un jar universel. ≥ 1.17 : rien de lançable, seulement un
    # fichier d'arguments — c'est `ecrire_run` qui tranche.
    if [ -f "forge-${complet}.jar" ]; then SERVER_JARFILE="forge-${complet}.jar"; fi
    ;;

  neoforge)
    # NeoForge numérote d'après la version du jeu : 1.21.1 donne 21.1.x.
    # Cette correspondance est une convention de l'éditeur, pas une règle
    # dérivable — la relever ici évite de la redécouvrir à chaque version.
    court="$(echo "$MINECRAFT_VERSION" | cut -d. -f2)"
    patch="$(echo "$MINECRAFT_VERSION" | cut -d. -f3)"
    if [ -z "$patch" ]; then patch=0; fi
    prefixe="${court}.${patch}."

    version="$LOADER_VERSION"
    if [ "$version" = "latest" ]; then
      version="$(interroger "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml" \
        | grep -oE '<version>[^<]+</version>' | sed 's/<[^>]*>//g' \
        | grep "^${prefixe}" | grep -v -- '-beta' | tail -1)"
      if [ -z "$version" ]; then
        version="$(interroger "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml" \
          | grep -oE '<version>[^<]+</version>' | sed 's/<[^>]*>//g' | grep "^${prefixe}" | tail -1)"
      fi
    fi
    [ -n "$version" ] || fatal "NeoForge ne publie rien pour ${MINECRAFT_VERSION}."

    telecharger \
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar" \
      neoforge-installer.jar
    echo "   exécution de l'installeur NeoForge"
    java -jar neoforge-installer.jar --installServer >/dev/null || fatal "l'installeur NeoForge a échoué."
    rm -f neoforge-installer.jar neoforge-installer.jar.log
    ;;

  spigot)
    # BuildTools compile Spigot sur place, à partir des sources décompilées.
    # C'est long — dix à trente minutes — et cela demande du réseau et de la
    # mémoire. C'est le seul chargeur dont l'installation peut échouer pour
    # des raisons qui ne nous regardent pas ; le dire ici évite de chercher
    # une panne du panel.
    echo "   BuildTools compile Spigot : comptez dix à trente minutes."
    apt-get install -y -qq git >/dev/null
    mkdir -p /mnt/server/.buildtools
    cd /mnt/server/.buildtools
    telecharger \
      "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar" \
      BuildTools.jar
    java -jar BuildTools.jar --rev "$MINECRAFT_VERSION" >/dev/null || fatal "BuildTools a échoué."
    cp -f "spigot-${MINECRAFT_VERSION}.jar" "/mnt/server/${SERVER_JARFILE}" 2>/dev/null \
      || cp -f spigot-*.jar "/mnt/server/${SERVER_JARFILE}"
    cd /mnt/server
    rm -rf /mnt/server/.buildtools
    ;;

  *)
    fatal "Chargeur « ${LOADER} » inconnu. Attendus : vanilla, paper, purpur, folia, spigot, fabric, forge, neoforge, quilt."
    ;;
esac

# --- Le contrat de licence --------------------------------------------------
# Écrit seulement s'il **n'existe pas** : le panel a son propre écran pour
# l'accepter, et l'écraser ici reviendrait à accepter à la place du client à
# chaque réinstallation.
if [ ! -f eula.txt ]; then
  echo "eula=false" > eula.txt
fi

# --- La commande de démarrage, écrite pour ce qui vient d'être installé -----
ecrire_run() {
  # Forge et NeoForge 1.17+ : pas de jar lançable, un fichier d'arguments que
  # Java lit avec `@`. Le chemin contient la version, on le cherche donc au
  # lieu de le composer.
  local args
  args="$(find libraries -name unix_args.txt 2>/dev/null | head -1 || true)"

  {
    echo '#!/bin/bash'
    echo '#'
    echo '# Écrit par l'"'"'installation. Le panel lance toujours `bash gd-run.sh`,'
    echo '# quel que soit le chargeur : c'"'"'est ce qui permet de changer de moteur'
    echo '# sans changer la commande de démarrage.'
    echo '#'
    echo '# Vous pouvez le modifier — il survit aux redémarrages, mais pas à une'
    echo '# réinstallation, qui le réécrit pour le nouveau moteur.'
    echo 'set -e'
    echo ': "${SERVER_MEMORY:=1024}"'
    if [ -n "$args" ]; then
      # `user_jvm_args.txt` est produit par l'installeur et destiné à être
      # modifié par l'exploitant : on le laisse tel quel.
      echo "exec java -Xms128M -Xmx\${SERVER_MEMORY}M @user_jvm_args.txt @${args} nogui"
    else
      echo "exec java -Xms128M -Xmx\${SERVER_MEMORY}M -jar ${SERVER_JARFILE} nogui"
    fi
  } > gd-run.sh
  chmod +x gd-run.sh

  echo "== Démarrage installé :"
  tail -1 gd-run.sh | sed 's/^/   /'
}

ecrire_run

echo "== Installation terminée"
