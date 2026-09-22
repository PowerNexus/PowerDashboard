# Les eggs livrés avec le panel

```bash
pnpm eggs:build   # assemble egg.base.json + install.sh → egg.json
```

Chaque egg vit en **deux fichiers** : `egg.base.json` pour sa définition, et
`install.sh` pour son script d'installation. Le format d'échange des eggs
impose de noyer le script dans une chaîne JSON — rien n'oblige à l'écrire ainsi.
Un script de trois cents lignes où chaque retour à la ligne est un `\n` ne se
relit pas, ne se colore pas, et ne passe pas `bash -n`.

`egg.json` est le fichier à importer depuis **Administration → Catalogue**.

## `minecraft-java` — un seul egg pour tous les chargeurs

Vanilla, Paper, Purpur, Folia, Spigot, Fabric, Forge, NeoForge et Quilt.

**Pourquoi un seul.** Un egg par chargeur oblige à changer d'egg pour passer de
Paper à Forge : nouvelle commande de démarrage, nouvelle image, nouvelles
variables. C'est un déménagement, pour ce qui est le même jeu. Ici, changer de
moteur revient à changer la variable **Chargeur** et à réinstaller. Le serveur
garde son identifiant, ses sous-utilisateurs, ses planifications, ses clés
SFTP, son historique — et ses fichiers.

### La commande de démarrage ne change jamais

Elle vaut `bash gd-run.sh` pour tous les chargeurs. C'est l'installation qui
écrit `gd-run.sh`, selon ce qu'elle vient d'installer.

Sans cette indirection, un seul egg était impossible : Forge et NeoForge à
partir de 1.17 ne produisent **pas de jar lançable** mais un fichier
d'arguments, lu par Java avec `@`. Il aurait fallu deux commandes de démarrage,
donc deux eggs — exactement ce qu'on cherchait à éviter. Le fichier reste
visible et modifiable dans le gestionnaire de fichiers ; une réinstallation le
réécrit pour le nouveau moteur.

### Ce que l'installation ne touche jamais

`world/`, `world_nether/`, `world_the_end/`, `plugins/`, `mods/`,
`server.properties`, `ops.json`, `whitelist.json`, `banned-*.json`.

Une réinstallation change le moteur, pas la partie. C'est la condition pour que
le changement de moteur soit un geste qu'on ose faire. `eula.txt` n'est écrit
que s'il est absent : le panel a son propre écran pour l'accepter, et l'écraser
reviendrait à accepter à la place du client à chaque réinstallation.

### La version de Java se choisit à part

Minecraft 1.17 exige Java 17, et 1.20.5 exige Java 21. L'egg déclare les quatre
images (8, 11, 17, 21) ; le panel connaît les seuils et propose la bonne. Poser
un moteur récent sur une image Java 8 donne « requires running the server with
Java 17 or above » et un conteneur qui sort en code 1 — le jar était pourtant
parfaitement installé.

### Spigot est le seul chargeur qui peut échouer pour des raisons externes

Il n'est pas distribué compilé : BuildTools le construit sur place, en dix à
trente minutes, avec du réseau et de la mémoire. L'installation le dit dans son
journal. Tous les autres chargeurs sont téléchargés depuis leur éditeur.

### Ce que cet egg change pour l'écran « Moteur »

L'écran remplace un fichier — un jar de Paper, de Fabric. Forge, NeoForge et
Quilt n'y figuraient pas : ils ne distribuent pas un serveur prêt à poser mais
un **installeur**, qui doit s'exécuter pour fabriquer le serveur et télécharger
ses bibliothèques. C'est précisément ce que fait cette installation.

Sur un serveur porté par cet egg, la détection du moteur ne passe plus par le
nom de l'egg mais par la variable `LOADER` : un egg qui déclare son chargeur
sait mieux que son nom ce qu'il fait tourner. Un egg tiers qui déclarerait la
même variable en profiterait aussi, sans qu'on ait à ajouter son nom à une
liste de mots-clés.
