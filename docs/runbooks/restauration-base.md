# Restaurer la base du panel

**Quand** : une mise à jour a échoué après ses migrations, des données ont été
effacées ou abîmées, ou la machine du panel est perdue.

**Ce qu'on risque** : perdre tout ce qui s'est passé depuis la sauvegarde. La
base remonte **en entier** à l'instant du `pg_dump`. Les nodes, eux, ne
remontent pas le temps : ce qui a changé sur les machines entre-temps ne
correspond plus à la base.

La sauvegarde se prend avec `gamedashboard backup` (voir
[installation, § 8](../installation.md)). Un fichier
`/opt/gamedashboard/backups/gamedashboard-<date>.tar.enc` contient `base.dump`,
`env/` (dont `APP_SECRET_KEY`) et `RELEASE`, la version qui tournait. **Une base
sans son `env/` ne se restaure pas** : tous les secrets chiffrés seraient
illisibles ([clé maître](./cle-maitre-secrets.md#3-la-clé-est-perdue)).

L'archive est **chiffrée** (AES-256, `openssl enc`) avec la clé des
sauvegardes, `/opt/gamedashboard/backup.key` : tirée à la première
sauvegarde, jamais remplacée, lisible par root seul, et **hors** de
l'archive. Elle se garde hors de la machine, une fois pour toutes, et à part
des sauvegardes (gestionnaire de secrets) : une sauvegarde volée ne livre
alors rien, mais **sans cette clé, aucune sauvegarde ne se relit** — la
machine perdue, c'est la copie gardée ailleurs qui sert. Les archives `.tar`
d'avant le chiffrement sont en clair ; elles partent avec la rotation.

Toutes les commandes ci-dessous lisent l'archive par ce déchiffrement :

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass file:/opt/gamedashboard/backup.key -in <fichier>
```

Ces réglages sont ceux de `CHIFFRE` dans `infra/prod/app.sh`, vérifiés
contre cette page par `infra-prod.test.ts`. `bad decrypt` veut dire : pas la
bonne clé, ou fichier abîmé.

## Avant de restaurer

1. **Sauvegarder l'état présent**, même abîmé, avant de l'écraser :
   `sudo gamedashboard backup`. C'est la seule façon de revenir sur une
   restauration faite avec le mauvais fichier, et la seule preuve s'il s'agit
   d'un incident ([incident de sécurité](./incident-securite.md)).
2. **Choisir le fichier** : le plus récent d'avant le problème. La version
   qui l'a produit :
   ```bash
   sudo openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass file:/opt/gamedashboard/backup.key \
     -in <fichier> | tar -xO ./RELEASE
   ```
3. **Noter ce qui va se perdre**, pour le refaire ou le signaler :
   - le journal d'activité entre la sauvegarde et maintenant
     (Administration › Journal, « Exporter en CSV ») ;
   - les serveurs créés, supprimés ou déplacés depuis ;
   - les rotations de jeton de node faites depuis (voir plus bas).

## Procédure

### Même version, même machine

Données effacées par erreur, base corrompue, sans changement de version :

```bash
sudo gamedashboard stop
sudo mkdir -p /tmp/restauration
sudo openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass file:/opt/gamedashboard/backup.key \
  -in <fichier> | sudo tar -x -C /tmp/restauration
sudo cp -a /tmp/restauration/env/. /opt/gamedashboard/env/
sudo -u postgres pg_restore --clean --if-exists -d gamedashboard < /tmp/restauration/base.dump
sudo gamedashboard setup      # réaligne le mot de passe de la base et redémarre
sudo rm -rf /tmp/restauration
```

Le dump passe par l'entrée standard : le dossier extrait n'est lisible que par
root, et c'est voulu — il contient la clé maître en clair, d'où le `rm -rf`
final. La table des migrations (schéma `drizzle`) est dans le dump : la base
revient avec l'état de migration qui allait avec.

### Après une mise à jour ratée

`gamedashboard update` prend une sauvegarde juste avant de migrer, et c'est
celle-là qu'il faut. Les migrations ne vont que vers l'avant : l'ancienne
version ne doit **jamais** tourner sur le schéma de la nouvelle.

1. Restaurer la base comme ci-dessus, **sans** lancer `gamedashboard setup`.
2. Remettre la version qui allait avec la sauvegarde (`RELEASE`) :
   ```bash
   sudo gamedashboard update --version <vX.Y.Z> --sans-sauvegarde
   ```
   L'installation reconnaît le panel existant, garde ses secrets, trouve les
   migrations déjà appliquées et redémarre les services.
3. Signaler la version fautive avant de retenter la mise à jour.

### Machine perdue

Installer le panel sur une machine neuve **avec le même domaine**
([installation, étape 4](../installation.md)), dans la version de `RELEASE`
(`GD_VERSION=<vX.Y.Z>`). Remettre la clé des sauvegardes, depuis la copie
gardée hors de la machine, **avant** toute sauvegarde sur la machine neuve
(sinon la première en tirerait une autre) :

```bash
sudo install -m 600 -o root -g root backup.key /opt/gamedashboard/backup.key
```

Puis restaurer comme dans le premier cas. Les daemons appellent le panel par
son domaine : un autre domaine les laisserait parler dans le vide.

## Remettre la base d'accord avec les nodes

La base restaurée décrit le parc tel qu'il était. Chaque écart se corrige d'un
côté ou de l'autre, jamais en réécrivant la base à la main.

| Changé depuis la sauvegarde | Ce qu'on voit | Correction |
|---|---|---|
| Jeton de node remplacé | Node « Injoignable », `401` au diagnostic | [Rotation du jeton, node perdu](./rotation-jeton-node.md#si-le-node-est-perdu-malgré-tout) |
| Serveur créé | Conteneur et volume sur le node, inconnus du panel | Recréer le serveur et y recopier les fichiers, ou effacer ce qui reste sur le node |
| Serveur supprimé | Serveur de retour dans le panel, absent du node | Le supprimer à nouveau depuis l'administration |
| Serveur déplacé | Le panel le place sur l'ancien node, qui a effacé sa copie | Recopier le volume vers l'ancien node, ou le déplacer à nouveau |
| Serveur en cours d'installation ou de transfert au moment du dump | État figé | Installation : se résout au redémarrage de Wings. Transfert : [serveur bloqué en transfert](./migration-serveur.md#serveur-bloqué--en-transfert-) |

**Les révocations sont annulées elles aussi.** Une session fermée, une clé
d'API révoquée ou un compte suspendu depuis la sauvegarde **redevient actif**.
Si ces gestes répondaient à un incident, les refaire tout de suite après la
restauration.

## Vérifier que c'est terminé

- `gamedashboard status` : les deux services sont actifs.
- La page de connexion répond et un administrateur se connecte.
- Administration › Nodes : chaque node repasse en ligne en moins de deux
  minutes. Un node qui reste « Injoignable » relève du tableau ci-dessus.
- Un secret chiffré se relit : ouvrir la configuration d'un node, ou
  **Paramètres** › envoyer un courriel d'essai. Une erreur de déchiffrement
  veut dire que `env/` ne va pas avec ce dump.

## Tester la restauration

Une sauvegarde qu'on n'a jamais restaurée ne vaut rien. Chaque mois, restaurer
la dernière sur une machine de test (PLAN §12.3), **coupée des nodes** par un
pare-feu sortant. La base restaurée porte les vrais jetons : sans cette
coupure, la machine de test sonderait les vrais daemons et son planificateur
lancerait les tâches planifiées sur les vrais serveurs.
