# Installer GameDashboard

Ce guide s'adresse à quelqu'un qui **n'a jamais vu le projet**. Il part d'un
serveur Linux vide et arrive à un premier serveur de jeu qui tourne. Aucune
connaissance de Node.js, de nginx ou de PostgreSQL n'est nécessaire : deux
scripts font le travail, et ce guide explique ce qu'ils demandent, ce qu'ils
font et quoi faire si quelque chose coince.

Comptez **30 à 45 minutes**, dont une bonne partie à attendre.

| Étape | Où | Durée |
|---|---|---|
| [1. Comprendre en deux minutes](#1-comprendre-en-deux-minutes) | — | 2 min |
| [2. Ce qu'il vous faut](#2-ce-quil-vous-faut) | — | 5 min |
| [3. Préparer les noms de domaine](#3-préparer-les-noms-de-domaine) | chez votre registraire | 5 min |
| [4. Installer le panel](#4-installer-le-panel) — une seule commande | machine du panel | 10 min |
| [5. Première connexion](#5-première-connexion) | navigateur | 5 min |
| [6. Ajouter une machine de jeu](#6-ajouter-une-machine-de-jeu-wings) | machine de jeu + navigateur | 10 min |
| [7. Créer un premier serveur](#7-créer-un-premier-serveur-de-jeu) | navigateur | 5 min |
| [8. Au quotidien](#8-au-quotidien) | — | — |
| [9. En cas de problème](#9-en-cas-de-problème) | — | — |

Annexes : [installation manuelle](#annexe-a--installation-manuelle-sans-le-script),
[ce que les scripts modifient](#annexe-b--ce-que-les-scripts-modifient-sur-la-machine),
[désinstaller](#annexe-c--désinstaller).

> **Vous venez de Pterodactyl ?** Vos daemons Wings se conservent tels quels.
> Installez le panel avec ce guide (étapes 2 à 5), puis suivez
> [la reprise Pterodactyl](./reprise-pterodactyl.md) au lieu de l'étape 6.

---

## 1. Comprendre en deux minutes

GameDashboard se compose de **deux pièces**, qui peuvent vivre sur la même
machine ou sur deux machines différentes :

```
      Navigateur des joueurs et des administrateurs
          │                                   │
          │ https://panel.mondomaine.fr       │ console, fichiers
          ▼                                   ▼ (https://node1.mondomaine.fr:8080)
  ┌───────────────────────┐   jeton    ┌─────────────────────────────┐
  │  LE PANEL             │◀──────────▶│  UNE MACHINE DE JEU (node)  │
  │  site web + API       │            │  Wings + Docker             │
  │  base PostgreSQL      │            │  ┌──────┐ ┌──────┐ ┌──────┐ │
  │  (ce dépôt)           │            │  │ jeu  │ │ jeu  │ │ jeu  │ │
  └───────────────────────┘            │  └──────┘ └──────┘ └──────┘ │
                                       └─────────────────────────────┘
```

| Mot | Ce que c'est |
|---|---|
| **Panel** | Le site web où l'on gère tout : comptes, serveurs, sauvegardes. C'est ce dépôt. Il ne fait tourner aucun jeu lui-même. |
| **Node** | Une machine qui fait tourner les jeux. Il en faut au moins une. |
| **Wings** | Le programme installé sur chaque node. Il reçoit les ordres du panel et lance les jeux dans des conteneurs Docker. C'est le Wings officiel de Pterodactyl, non modifié. |
| **Egg** | Une « recette » qui décrit comment installer et lancer un jeu (Minecraft, Rust…). |
| **Serveur** | Une instance de jeu, créée à partir d'un egg sur un node. |
| **Allocation** (port) | Un port réseau réservé sur un node, par lequel les joueurs rejoignent un serveur (ex. 25565 pour Minecraft). |

**Une ou deux machines ?** Pour commencer ou pour quelques serveurs, une
seule machine suffit : panel et Wings cohabitent. Dès que les jeux
consomment beaucoup, séparez-les : le panel reste léger, et vous ajoutez
des nodes au besoin.

---

## 2. Ce qu'il vous faut

### Une machine (ou deux)

| | Panel seul | Panel + jeux sur la même machine | Node seul |
|---|---|---|---|
| Système | Debian 12/13 ou Ubuntu 22.04/24.04 | idem | Debian ou Ubuntu |
| Processeur | 2 cœurs, 64 bits | 4 cœurs et plus | selon les jeux |
| Mémoire | 2 Go (4 Go confortables) | 4 Go + ce que prennent les jeux | selon les jeux |
| Disque | 10 Go | 10 Go + les jeux | selon les jeux |
| Accès | root en SSH | root en SSH | root en SSH |

Un VPS ou un serveur dédié chez n'importe quel hébergeur convient. Ce qui
**ne convient pas** : WSL, un conteneur Docker, un conteneur OpenVZ ou LXC
(Docker n'y tourne pas correctement), un hébergement mutualisé.

> **Moins de 4 Go de mémoire ?** La construction du site en demande beaucoup
> pendant quelques minutes. Le script le détecte et propose de créer un
> fichier d'échange de 2 Go : acceptez.

### Un nom de domaine

Vous devez pouvoir créer des enregistrements DNS sur un domaine à vous
(chez OVH, Gandi, Cloudflare, Namecheap…). Un **sous-domaine** suffit, et
c'est le plus simple : `panel.mondomaine.fr` pour le panel,
`node1.mondomaine.fr` pour la machine de jeu.

Une adresse IP seule ne suffit pas : le panel exige HTTPS, et aucun
certificat gratuit n'est délivré pour une adresse IP.

### Des ports ouverts

| Port | Machine | Pour |
|---|---|---|
| 22 | toutes | votre accès SSH (déjà ouvert en général) |
| 80 et 443 | panel | le site, et l'obtention du certificat |
| 80 | node | l'obtention du certificat |
| 8080 | node | le panel et les navigateurs parlent à Wings |
| 2022 | node | l'accès SFTP aux fichiers des serveurs |
| ceux des jeux | node | ex. 25565 à 25575 pour Minecraft |

Si votre hébergeur a un pare-feu dans son interface web, ouvrez-y ces ports.
Le pare-feu `ufw` de la machine, lui, est géré par les scripts s'il est actif.

---

## 3. Préparer les noms de domaine

Chez votre registraire, dans la zone DNS de votre domaine, créez un
enregistrement **A** par machine, vers son adresse IPv4 publique (donnée par
l'hébergeur) :

| Type | Nom | Valeur | |
|---|---|---|---|
| A | `panel` | `203.0.113.10` | adresse de la machine du panel |
| A | `node1` | `203.0.113.10` | la même si les jeux tournent sur la même machine, sinon celle du node |

Si la machine a aussi une adresse IPv6, ajoutez un enregistrement **AAAA**
de la même façon — ou n'en mettez pas du tout : un AAAA faux fait échouer
le certificat.

> **Cloudflare** : laissez le nuage **gris** (« DNS only ») pour ces deux
> noms. Le mode proxy (nuage orange) coupe la console et Wings.

**Vérifier** depuis n'importe quel terminal, après quelques minutes :

```bash
getent hosts panel.mondomaine.fr    # doit afficher l'adresse de la machine
```

Rien ne s'affiche ? Patientez (jusqu'à une heure chez certains registraires)
et réessayez. Le script vérifiera de toute façon avant d'aller plus loin.

---

## 4. Installer le panel

### 4.1 Se connecter à la machine

Depuis votre ordinateur (Terminal sous macOS et Linux, PowerShell sous
Windows) :

```bash
ssh root@panel.mondomaine.fr
```

Si l'hébergeur vous a donné un utilisateur autre que root (souvent `debian`
ou `ubuntu`), connectez-vous avec lui : toutes les commandes ci-dessous
commencent déjà par `sudo`.

### 4.2 Une seule commande

Sur la machine du panel, collez :

```bash
curl -fsSL https://github.com/PowerNexus/PowerDashboard/releases/latest/download/gamedashboard.sh | sudo bash -s -- install
```

C'est tout. Cette commande :

1. télécharge la dernière version publiée du panel, **déjà compilée** —
   votre serveur n'a rien à construire, une petite machine suffit ;
2. vérifie son empreinte : un fichier abîmé ou altéré n'est jamais utilisé ;
3. installe la commande **`gamedashboard`**, qui servira ensuite à tout
   (`gamedashboard help`) ;
4. lance l'installation guidée ci-dessous.

> **Lire avant d'exécuter ?** C'est une bonne habitude. Le même script, en
> deux temps :
> ```bash
> curl -fsSLO https://github.com/PowerNexus/PowerDashboard/releases/latest/download/gamedashboard.sh
> less gamedashboard.sh                 # le lire
> sudo bash gamedashboard.sh install    # puis l'exécuter
> ```

L'installation guidée pose **quatre questions**, puis récapitule et demande
confirmation. Rien n'est modifié sur la machine avant cette confirmation.

```
GameDashboard — installation du panel

[1/9] Vérifications avant de commencer
  ✔ Dépôt trouvé : /opt/gamedashboard/releases/gamedashboard-v1.0.0
  ✔ Système : Debian GNU/Linux 12 (bookworm)
  ✔ Architecture : x86_64
  • Mémoire : 3915 Mo, fichier d'échange : 0 Mo
  ✔ Disque : 71 Go libres

[2/9] Vos réponses
  • Le panel sera servi en HTTPS sur un nom de domaine qui pointe vers cette machine.
  Nom de domaine du panel : panel.mondomaine.fr
  • Le premier compte administrateur. Son mot de passe sera tiré au sort et affiché à la fin.
  Adresse électronique : moi@mondomaine.fr
  Prénom : Alex
  Nom : Martin

  Récapitulatif
    Adresse du panel   https://panel.mondomaine.fr
    Administrateur     Alex Martin <moi@mondomaine.fr>
    Certificat         Let's Encrypt, avis d'expiration à moi@mondomaine.fr
  Tout est correct ? [O/n] :
```

| Question | Quoi répondre |
|---|---|
| Nom de domaine du panel | Le nom créé à l'étape 3, **sans** `https://` : `panel.mondomaine.fr` |
| Adresse électronique | La vôtre. Elle sert d'identifiant de connexion, et Let's Encrypt y envoie ses rares avis. |
| Prénom, Nom | Ceux de l'administrateur. Modifiables ensuite. |

Viennent ensuite, sans intervention :

| Étape | Ce qui se passe |
|---|---|
| 3. Le domaine pointe-t-il ici ? | Vérifie l'enregistrement DNS. Derrière une box ou un NAT, l'avertissement est normal. |
| 4. Paquets du système | nginx, certbot et quelques outils. Fichier d'échange si la mémoire est juste. |
| 5. Node.js et PostgreSQL | Node.js 24 et PostgreSQL 18 depuis leurs dépôts officiels. Un PostgreSQL déjà installé est réutilisé. |
| 6. Copie du panel | Le panel est copié dans `/opt/gamedashboard/app`, d'où il tourne. |
| 7. Certificat HTTPS | Let's Encrypt, renouvelé ensuite tout seul. |
| 8. Démarrage | **La plus longue : deux à trois minutes.** Dépendances, base de données, secrets, services, puis contrôle que les pages s'affichent vraiment. |
| 9. Premier administrateur | Crée votre compte. |

À la fin :

```
══════════════════════════════════════════════════════════════
  Le panel est en ligne : https://panel.mondomaine.fr
══════════════════════════════════════════════════════════════

  Identifiant          moi@mondomaine.fr
  Mot de passe         q3N0v…
  Il n'est affiché qu'une fois. Notez-le, puis changez-le à la première connexion.
```

> ⚠ **Notez le mot de passe maintenant.** Il n'est enregistré nulle part en
> clair. Perdu, il se réinitialise avec
> `gamedashboard password moi@mondomaine.fr`, voir [§ 9](#9-en-cas-de-problème).

### 4.3 Sauvegarder — tout de suite

```bash
gamedashboard backup
```

Le fichier produit, dans `/opt/gamedashboard/backups/`, contient la base
**et** `APP_SECRET_KEY`, la clé qui chiffre les secrets rangés en base
(jetons des nodes, mots de passe des bases de données des clients…). Sans
cette clé, une sauvegarde de la base ne sert à rien : c'est pourquoi les
deux voyagent ensemble. Copiez-le hors de la machine :

```bash
# depuis votre ordinateur
scp 'root@panel.mondomaine.fr:/opt/gamedashboard/backups/*.tar' .
```

Rangez-le comme un mot de passe : dans un gestionnaire de secrets ou un
stockage chiffré, pas dans un dossier partagé.

### 4.4 Sans aucune question

Pour une installation automatisée (Ansible, cloud-init…), toutes les
réponses se donnent en options, après `install` :

```bash
curl -fsSL https://github.com/PowerNexus/PowerDashboard/releases/latest/download/gamedashboard.sh \
  | sudo bash -s -- install --oui \
      --domaine panel.mondomaine.fr --courriel moi@mondomaine.fr --prenom Alex --nom Martin
```

`--oui` accepte aussi le fichier d'échange. Le mot de passe s'affiche de la
même façon à la fin. `GD_VERSION=v1.0.0` installe une version précise plutôt
que la dernière.

### 4.5 Autre méthode : depuis une archive ou un clone

Pour qui préfère tout avoir sous les yeux, ou contribuer au projet. Il faut
d'abord Node.js 24 et pnpm :

```bash
sudo apt-get update && sudo apt-get install -y curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
sudo corepack enable        # fournit pnpm, à la version exacte que le projet demande
```

Puis, au choix, l'archive de la page
[Releases](https://github.com/PowerNexus/PowerDashboard/releases) (déjà
compilée) :

```bash
curl -fLO https://github.com/PowerNexus/PowerDashboard/releases/download/v1.0.0/gamedashboard-v1.0.0.tar.gz
curl -fLO https://github.com/PowerNexus/PowerDashboard/releases/download/v1.0.0/gamedashboard-v1.0.0.tar.gz.sha256
sha256sum -c gamedashboard-v1.0.0.tar.gz.sha256      # doit répondre « OK »
tar -xzf gamedashboard-v1.0.0.tar.gz && cd gamedashboard-v1.0.0
```

ou le dépôt (le panel est alors compilé pendant l'installation : cinq
minutes et 2 Go de mémoire de plus) :

```bash
git clone https://github.com/PowerNexus/PowerDashboard.git && cd PowerDashboard
```

Et dans ce dossier, trois commandes :

```bash
pnpm app:install    # vérifie Node.js et pnpm, installe les dépendances
pnpm app:setup      # la même installation guidée qu'au § 4.2
pnpm app:start      # démarre le panel (déjà fait par app:setup la première fois)
```

Toutes les commandes du dossier commencent par **`app:`** (`pnpm app:help`) ;
ce sont les mêmes que `gamedashboard …`, qui est installée aussi. N'oubliez
pas le préfixe : `pnpm setup` tout court est une commande de pnpm lui-même,
qui ne lance rien du panel.

---

## 5. Première connexion

Ouvrez `https://panel.mondomaine.fr` et connectez-vous avec l'adresse et le
mot de passe affichés.

**À faire dans cet ordre :**

1. **Changer le mot de passe** — *Compte › Sécurité › Mot de passe*.
2. **Activer la double authentification** — *Compte › Sécurité › Double
   authentification › Activer*. Scannez le QR code avec une application
   (Aegis, 2FAS, Google Authenticator, 1Password…), et **gardez les codes de
   secours** : ce sont eux qui vous rouvrent le compte si le téléphone est
   perdu. **L'administration reste fermée tant que ce n'est pas fait** : la
   seconde preuve est exigée du personnel (et des revendeurs) dès
   l'installation, et l'espace d'administration vous renvoie ici en
   attendant. Votre compte, lui, reste ouvert pour l'activer.
3. **Configurer l'envoi de courriels** — *Administration › Paramètres ›
   Envoi d'e-mails* : hôte, port (587 en général), utilisateur et mot de
   passe du SMTP de votre fournisseur de messagerie. Puis *Tester l'envoi*.
   Sans SMTP, le panel fonctionne, mais « mot de passe oublié » et les
   notifications restent muets.
4. **Choisir qui peut créer un compte** — *Administration › Paramètres ›
   Sécurité et accès*. Les inscriptions publiques sont **fermées** par
   défaut : seuls les comptes que vous créez existent. *2FA obligatoire pour
   le personnel* est **actif** par défaut : laissez-le ainsi. Un compte que
   vous nommez administrateur, support ou revendeur devra activer sa propre
   seconde preuve avant d'entrer dans son espace.

**Facultatif : « Se connecter avec Google ».** Un bouton au-dessus du
formulaire, pour qui préfère son compte Google au mot de passe :

1. Dans la [console Google Cloud](https://console.cloud.google.com/apis/credentials),
   *Créer des identifiants › ID client OAuth*, type **Application Web**.
2. *URI de redirection autorisés* : `https://panel.mondomaine.fr/auth/google/callback`,
   à l'identique.
3. Recopier l'identifiant et le secret dans *Administration › Paramètres ›
   Connexion avec Google*, puis cocher *Proposer le bouton*.

Un compte du panel est reconnu par son adresse, vérifiée par Google. Un
compte n'est **créé** que si les inscriptions publiques sont ouvertes ; sinon,
seuls les comptes existants entrent par ce bouton.

---

## 6. Ajouter une machine de jeu (Wings)

Le panel est en ligne mais ne peut encore rien héberger : il lui faut un node.

### 6.1 Installer Wings sur la machine de jeu

**Si les jeux tournent sur la machine du panel** :

```bash
gamedashboard wings
```

**Sur une autre machine**, la même commande d'une ligne que pour le panel,
avec `wings` au lieu d'`install` — rien d'autre à télécharger :

```bash
curl -fsSL https://github.com/PowerNexus/PowerDashboard/releases/latest/download/gamedashboard.sh | sudo bash -s -- wings
```

Il demande le nom de domaine **de la machine de jeu** (`node1.mondomaine.fr`)
et une adresse pour Let's Encrypt, puis installe Docker, Wings et le
certificat. Il ne démarre pas Wings : Wings ne sait pas encore à quel panel
parler.

### 6.2 Déclarer le node dans le panel

1. *Administration › Nodes › Classement* : créez une **localisation**
   (code `fr`, libellé « France », par exemple). Un node ne peut pas être
   déclaré sans.
2. *Administration › Nodes › Déclarer un node* :

   | Champ | Valeur |
   |---|---|
   | Nom | ce que vous voulez, ex. `Node 1` |
   | Nom de domaine | `node1.mondomaine.fr` — **le même que dans le script** |
   | Schéma | `https` |
   | Port du daemon | `8080` |
   | Port SFTP | `2022` |
   | Localisation | celle créée juste avant |
   | Mémoire, Disque, Cœurs | ce que vous accordez aux jeux sur cette machine, en laissant de la marge au système |

   Le panel affiche ensuite des valeurs techniques : **vous n'en avez pas
   besoin**, l'étape suivante les transmet toute seule.

### 6.3 Relier Wings au panel

1. Dans la liste des nodes, ouvrez le menu (⋯) du node : **Configurer le
   daemon**. Le panel affiche une commande du type :

   ```bash
   wings configure --panel-url https://panel.mondomaine.fr --token … --node …
   ```

2. Copiez-la et collez-la **sur la machine de jeu**, en root. Elle va
   chercher la configuration et l'écrit dans `/etc/pterodactyl/config.yml`.
   La clé qu'elle contient ne sert qu'une fois et expire en trente minutes :
   si elle a expiré, *Émettre une nouvelle clé*.
3. Démarrez Wings :

   ```bash
   sudo systemctl enable --now wings
   ```

4. Revenez dans le panel : le node passe **En ligne** en moins d'une minute.

### 6.4 Ouvrir des ports aux jeux

Menu (⋯) du node › **Ajouter des ports** : par exemple de `25565` à `25575`
pour dix serveurs Minecraft. Sans port, aucun serveur ne peut être créé sur
ce node. Si `ufw` est actif sur la machine de jeu, ouvrez-les aussi :

```bash
sudo ufw allow 25565:25575/tcp && sudo ufw allow 25565:25575/udp
```

---

## 7. Créer un premier serveur de jeu

1. **Importer un egg** — *Administration › Catalogue › Importer un egg*.
   Le dépôt en fournit un pour Minecraft Java, qui couvre Vanilla, Paper,
   Fabric, Forge, NeoForge et les autres : collez le contenu de
   [`infra/eggs/minecraft-java/egg.json`](../infra/eggs/minecraft-java/egg.json).
   Les eggs au format Pterodactyl — exportés d'un ancien panel, ou pris
   dans les dépôts communautaires d'eggs — s'importent de la même façon.
2. **Le proposer** — un egg importé est désactivé tant que vous ne l'avez pas
   relu. Dans le catalogue, cochez *Proposé aux clients*.
3. **Créer le serveur** — *Serveurs › Nouveau serveur* : choisir le jeu, la
   localisation, les ressources. L'installation démarre aussitôt ; suivez-la
   dans la console du serveur.
4. **Jouer** — l'adresse à donner aux joueurs est le nom du node suivi du
   port attribué au serveur : `node1.mondomaine.fr:25565`.

---

## 8. Au quotidien

### Mettre à jour

```bash
gamedashboard update
```

Dans l'ordre, elle :

1. compare la version installée à la dernière publiée — si ce sont les
   mêmes, elle s'arrête là (« Déjà à jour ») ;
2. **fait une sauvegarde** (`gamedashboard backup`) : une mise à jour peut
   modifier la base, c'est le seul moyen d'en revenir ;
3. télécharge la nouvelle version et vérifie son empreinte ;
4. l'installe sans poser de question : comptes, secrets et réglages sont
   conservés, les migrations de base appliquées, le panel redémarré.

Le panel est indisponible une trentaine de secondes ; **les serveurs de jeu,
eux, ne s'arrêtent pas** (ils vivent sur les nodes).

| Option | Effet |
|---|---|
| `--version v1.2.0` | installe cette version plutôt que la dernière |
| `--forcer` | réinstalle même si la version est déjà la bonne |
| `--sans-sauvegarde` | saute la sauvegarde (déconseillé) |

Depuis un clone git, la mise à jour suit le dépôt plutôt que les versions
publiées : `git pull && pnpm app:install && pnpm app:setup`.

Pour mettre Wings à jour : `gamedashboard wings` (ou la commande `curl … wings`)
sur chaque node.

### Démarrer, arrêter, surveiller

De n'importe quel dossier :

| Commande | Effet |
|---|---|
| `gamedashboard status` | état des deux services, adresse et version installée |
| `gamedashboard start` | démarre le panel et attend qu'il réponde |
| `gamedashboard stop` | l'arrête — les serveurs de jeu continuent de tourner |
| `gamedashboard restart` | l'arrête puis le redémarre |
| `gamedashboard logs` | journaux en direct (`logs api` ou `logs web` pour un seul) ; `Ctrl+C` pour sortir |
| `gamedashboard admin <email> <prénom> <nom>` | crée un autre compte administrateur |
| `gamedashboard password <email>` | tire un nouveau mot de passe pour un compte, affiché une fois |
| `gamedashboard help` | la liste complète |

Ces commandes parlent à systemd, qui fait tourner le panel : il redémarre
aussi tout seul avec la machine. Elles demandent les droits
d'administrateur d'elles-mêmes. Depuis un clone ou une archive extraite,
`pnpm app:status`, `pnpm app:start`… font exactement la même chose. Sur un
node : `journalctl -u wings -f`.

### Sauvegarder

```bash
gamedashboard backup
```

Un seul fichier, `/opt/gamedashboard/backups/gamedashboard-<date>.tar`,
lisible par root seul, qui contient **les deux moitiés indispensables** : la
base (comptes, serveurs, réglages) et la clé qui déchiffre ses secrets. Les
sept plus récentes sont gardées, les plus anciennes effacées.

| Variable | Effet |
|---|---|
| `GD_GARDER=30` | nombre de sauvegardes gardées (7 par défaut) |
| `GD_SAUVEGARDES=/mnt/disque` | dossier de destination |

**Chaque nuit, automatiquement** — une ligne dans la table de root
(`sudo crontab -e`) :

```
30 4 * * * /usr/local/bin/gamedashboard backup >> /var/log/gamedashboard-backup.log 2>&1
```

Une sauvegarde restée sur la machine ne protège pas de la perte de la
machine : copiez-les régulièrement ailleurs (`scp`, `rclone`, stockage
objet).

Les **fichiers des serveurs de jeu** ne sont pas dans la base : ils vivent
sur les nodes, et se sauvegardent depuis l'onglet *Sauvegardes* de chaque
serveur. Ces sauvegardes restent sur le disque du node tant qu'aucun
compartiment compatible S3 n'est réglé (Administration › Paramètres ›
Stockage des sauvegardes) : sans lui, elles meurent avec la machine.

### Restaurer sur une machine neuve

1. Installer le panel normalement (étape 4), avec le **même domaine**.
2. Y copier la sauvegarde, puis :

   ```bash
   sudo gamedashboard stop
   sudo mkdir -p /tmp/restauration && sudo tar -xf gamedashboard-20260923-043000.tar -C /tmp/restauration
   sudo cp -a /tmp/restauration/env/. /opt/gamedashboard/env/
   sudo -u postgres pg_restore --clean --if-exists -d gamedashboard < /tmp/restauration/base.dump
   sudo gamedashboard setup      # réaligne le mot de passe de la base et redémarre
   sudo rm -rf /tmp/restauration
   ```

   La même marche à suivre est dans le fichier `LISEZMOI.txt` de chaque
   sauvegarde. Le dump passe par l'entrée standard (`<`) : le dossier
   extrait n'est lisible que par root, et c'est voulu.

---

## 9. En cas de problème

Chaque message d'erreur des scripts dit quoi faire ensuite. Les deux scripts
peuvent être **relancés sans risque** : ils reprennent ce qui manque et ne
régénèrent jamais un secret existant.

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Let's Encrypt n'a pas pu vérifier… » | DNS pas encore propagé, ou port 80 fermé | `getent hosts panel.mondomaine.fr` doit donner l'adresse de la machine ; ouvrir le port 80 chez l'hébergeur ; relancer. Après cinq échecs, Let's Encrypt bloque une heure. |
| La construction s'arrête sur `Killed` | Mémoire épuisée | Relancer et accepter le fichier d'échange, ou en créer un à la main (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`). |
| `pnpm setup` a affiché « export PNPM_HOME=… » et rien installé | Préfixe `app:` oublié : c'est la commande de pnpm | Lancer `pnpm app:setup`. La ligne ajoutée à `~/.bashrc` par pnpm est sans danger et peut être retirée. |
| `pnpm : commande introuvable` | corepack pas activé (méthode du § 4.5) | `sudo corepack enable`. |
| « Aucune version publiée » | Le dépôt n'a pas encore de release | Installer depuis un clone (§ 4.5). |
| « L'empreinte … ne correspond pas » | Téléchargement abîmé, ou fichier altéré | Relancer. Si cela persiste, ne pas insister et le signaler : rien n'a été installé. |
| « Le panel n'est pas encore installé » | L'installation n'a pas abouti | Relancer la commande d'installation (§ 4.2). |
| `Missing script: app:…` ou « Commande inconnue » | Commande mal tapée | `gamedashboard help` (ou `pnpm app:help`) donne la liste exacte. |
| « Domaine inconnu » en lançant `deploy.sh` | Premier passage sans domaine | Passer par `gamedashboard setup`, ou `GD_DOMAIN=panel.mondomaine.fr bash infra/prod/deploy.sh`. |
| `nginx -t` échoue sur un autre fichier | Un autre site de la machine est mal configuré | Le message nomme le fichier fautif. Le panel n'y touche pas ; corriger ce site, puis relancer. |
| Page « 502 Bad Gateway » | Un service est arrêté | `gamedashboard status`, puis `gamedashboard logs`. `gamedashboard start` le relance. |
| L'API ne démarre pas, journal : `APP_SECRET_KEY` | Fichier `/opt/gamedashboard/env/api.env` abîmé | Remettre `env/` depuis une sauvegarde (§ 8, *Restaurer*). **Ne jamais générer une nouvelle clé** : voir le [runbook de la clé maître](./runbooks/cle-maitre-secrets.md). |
| Mot de passe administrateur perdu | — | `gamedashboard password moi@mondomaine.fr` : un nouveau mot de passe s'affiche une fois. La double authentification et les sessions ouvertes sont conservées. |
| « Seconde preuve exigée » à l'entrée de l'administration | Le compte n'a pas encore de double authentification, exigée du personnel par défaut (y compris après une mise à jour d'un panel qui ne l'imposait pas) | *Compte › Sécurité › Double authentification › Activer*, puis revenir à l'administration. |
| Le node reste « Injoignable » | Wings arrêté, port 8080 fermé, ou nom de domaine différent entre le node et le certificat | Sur le node : `journalctl -u wings -n 50`. Voir aussi le [runbook machine injoignable](./runbooks/machine-injoignable.md). |
| `wings configure` répond 401 ou 403 | Clé expirée (trente minutes) ou déjà utilisée | *Configurer le daemon › Émettre une nouvelle clé*. |
| La console d'un serveur reste vide | Node déclaré en `http` alors que le panel est en `https`, ou proxy Cloudflare actif | Déclarer le node en `https` ; nuage gris sur Cloudflare. |
| Les joueurs ne peuvent pas se connecter | Port du jeu fermé | Ouvrir le port chez l'hébergeur et dans `ufw` sur le node. |
| Recherche CurseForge : erreur 403 | Pas de clé CurseForge | Ajouter `CURSEFORGE_API_KEY='…'` dans `/opt/gamedashboard/env/api.env`, puis redémarrer l'API. Modrinth fonctionne sans clé. |

Toujours bloqué ? Ouvrez une *issue* sur le dépôt avec le message d'erreur
exact et la sortie de `journalctl -u gamedashboard-api -n 100` (relisez-la
avant : elle ne doit contenir aucun mot de passe).

---

## Annexe A — Installation manuelle, sans le script

Pour qui veut tout maîtriser, ou pour une machine qui a déjà nginx,
PostgreSQL et Node.js. L'installation guidée (`infra/prod/installer.sh`) ne fait rien d'autre que ceci :

1. **Prérequis** : Node.js 24 ou plus avec `corepack`, PostgreSQL 17 ou
   plus en service, nginx, certbot, `rsync`, `openssl`, `sudo`.
2. **Code** : copier le dépôt dans `/opt/gamedashboard/app`, sans
   `node_modules`, `.next`, `.git` ni fichiers `.env`.
3. **Certificat** : obtenir un certificat pour le domaine sous
   `/etc/letsencrypt/live/<domaine>/` (certbot `--webroot -w /var/www/html`,
   le vhost final sert ce dossier pour les renouvellements), avec
   `--deploy-hook 'systemctl reload nginx'`.
4. **Déploiement** :
   ```bash
   sudo GD_DOMAIN=panel.mondomaine.fr bash /opt/gamedashboard/app/infra/prod/deploy.sh
   ```
   Il crée l'utilisateur système, la base, les secrets, construit, migre,
   installe les services et le vhost, puis contrôle les pages. Ses choix
   (écoute locale seulement, préfixes d'API exposés) sont expliqués dans
   [`infra/prod/README.md`](../infra/prod/README.md).
5. **Administrateur** :
   ```bash
   gamedashboard admin moi@mondomaine.fr Alex Martin
   ```
   Le script ne reçoit que `DATABASE_URL`, lue dans `/opt/gamedashboard/env/api.env`.

Pour Wings sans script : la [documentation de Wings](https://pterodactyl.io/wings/1.0/installing.html)
s'applique telle quelle — le panel remplace seulement celui de Pterodactyl
dans l'étape « configure ».

## Annexe B — Ce que les scripts modifient sur la machine

Rien n'est caché. L'installation (`gamedashboard.sh install`, puis `infra/prod/installer.sh`) :

| Quoi | Où |
|---|---|
| Paquets | `nginx`, `certbot`, `rsync`, `openssl`, `curl`, `sudo`, Node.js (NodeSource), PostgreSQL (apt.postgresql.org) |
| Code du panel | `/opt/gamedashboard/app` ; les versions téléchargées dans `/opt/gamedashboard/releases/` (les deux dernières) |
| Commande | `/usr/local/bin/gamedashboard` |
| Sauvegardes | `/opt/gamedashboard/backups/`, par `gamedashboard backup` et avant chaque `update` |
| Secrets | `/opt/gamedashboard/env/` (`api.env`, `web.env`, `.dbpass`), lisibles par root et le service seulement |
| Utilisateur système | `gamedashboard`, sans shell ni mot de passe |
| Base | rôle et base `gamedashboard` ; les autres bases ne sont pas touchées |
| Services | `gamedashboard-api`, `gamedashboard-web` (n'écoutent que `127.0.0.1`) |
| nginx | `/etc/nginx/sites-available/<domaine>.conf` et son lien ; `/etc/nginx/snippets/tls/tls-intermediate.conf` s'il n'existait pas. Les autres sites ne sont pas modifiés. |
| Certificat | `/etc/letsencrypt/live/<domaine>/`, renouvelé par le minuteur de certbot |
| Facultatif | `/swapfile` (si accepté), règles `ufw` 80 et 443 (si ufw était déjà actif) |

`installer-wings.sh` : Docker (script officiel `get.docker.com`),
`/usr/local/bin/wings`, `/etc/systemd/system/wings.service`, les dossiers
`/etc/pterodactyl`, `/var/lib/pterodactyl`, `/var/log/pterodactyl`, le
certificat du node, et les règles `ufw` 80, 8080 et 2022 si ufw est actif.

## Annexe C — Désinstaller

```bash
sudo systemctl disable --now gamedashboard-api gamedashboard-web
sudo rm /etc/systemd/system/gamedashboard-{api,web}.service && sudo systemctl daemon-reload
sudo rm /etc/nginx/sites-enabled/panel.mondomaine.fr.conf /etc/nginx/sites-available/panel.mondomaine.fr.conf
sudo nginx -t && sudo systemctl reload nginx
sudo -u postgres dropdb gamedashboard && sudo -u postgres dropuser gamedashboard   # efface les données
sudo rm -rf /opt/gamedashboard /usr/local/bin/gamedashboard && sudo userdel gamedashboard
```

`rm -rf /opt/gamedashboard` efface aussi les sauvegardes qui y sont : copiez-les
d'abord ailleurs si vous voulez les garder.

Les paquets (nginx, PostgreSQL, Node.js) restent installés : d'autres
programmes peuvent s'en servir.
