# 0007 — La machine protège les données au repos : données personnelles en clair, clé maître en fichier

- **État** : acceptée
- **Date** : 2026-09
- **Références** : PLAN §5.4 ; `packages/db/src/schema/identity.ts` ;
  `packages/auth/src/secrets.ts`, `password.ts` ; `infra/prod/deploy.sh`,
  `app.sh` ; [rapport ASVS](../securite/rapport-asvs-l2.md) NC-62 (6.1.1,
  6.4.1, 6.4.2, 2.4.5) ; [clé maître](../runbooks/cle-maitre-secrets.md)

## Contexte

L'audit ASVS niveau 2 relève trois écarts d'architecture, à consigner plutôt
qu'à corriger à la volée :

- **les données personnelles sont en clair en base** : adresse, prénom et
  nom (`users`), adresse IP et agent des sessions (`sessions`), adresses du
  journal d'activité et des tentatives de connexion ;
- **la clé maître des secrets vit dans un fichier d'environnement**
  (`APP_SECRET_KEY`, `/opt/gamedashboard/env/api.env`) et la clé de
  chiffrement en est **dérivée dans le processus de l'API** (scrypt, sel
  public, `secrets.ts`) : pas de coffre, pas de module matériel (HSM), la clé
  dérivée est en mémoire tant que l'API tourne ;
- **pas de poivre** : les mots de passe sont en Argon2id (ADR 0002), sans
  secret supplémentaire gardé hors de la base.

Le panel s'installe sur **une machine**, par un script, chez un hébergeur de
serveurs de jeu. Pas de fournisseur de clés géré, pas d'équipe d'exploitation
pour tenir un coffre, et la même machine porte souvent Wings.

## Décision

**Le panel chiffre ce qu'il doit présenter à un tiers, hache ce qu'il ne
relit jamais, et laisse le reste en clair en base ; la confidentialité au
repos de l'ensemble repose sur la machine** : chiffrement du volume,
permissions, services confinés et sauvegardes chiffrées.

Concrètement :

- **Chiffré** (AES-256-GCM, `encryptSecret`) : jetons de node, mots de passe
  MySQL, secrets de webhooks, secret TOTP, secrets de plateforme (SMTP, S3,
  OIDC, Google, Turnstile, facturation). **Haché** : mots de passe (Argon2id),
  sessions, clés d'API, jetons de courrier et d'invitation (SHA-256 de
  256 bits aléatoires). Tableau complet : rapport ASVS §5.
- **En clair** : ce que l'écran affiche et que la recherche, le tri, l'unicité
  lisent — adresse (index unique, recherche insensible à la casse), noms,
  adresses IP des sessions et du journal.
- **Clé maître** : `APP_SECRET_KEY` dans `env/api.env`, `root:gamedashboard`
  en 640, dans un dossier en 750 ; lue par systemd (`EnvironmentFile`), jamais
  par l'interface web, qui n'a ni la clé ni la base. L'API refuse de démarrer
  sans elle (`assertEncryptionKey`). Elle se remplace par
  `rekey-secrets.mts` ([runbook](../runbooks/cle-maitre-secrets.md)).

## Options écartées

- **Chiffrer les données personnelles en base**, colonne par colonne. L'adresse
  sert d'identifiant de connexion, d'index unique et de critère de recherche :
  il faudrait un condensat déterministe à côté de chaque colonne chiffrée, et
  la clé qui les déchiffre serait dans le même processus, sur la même machine.
  Contre qui lit la base *et* la machine, rien de gagné ; contre qui ne lit
  que la base (une copie, une sauvegarde), le chiffrement du volume et des
  sauvegardes protège déjà.
- **Coffre de secrets (Vault, KMS d'un nuage) ou HSM.** Un service de plus à
  installer, à sauvegarder et à garder en ligne, sur une installation d'une
  machine : son indisponibilité rendrait l'API muette, et sa clé de
  déverrouillage finirait elle-même dans un fichier. Le jour où le panel est
  hébergé là où un KMS existe, la dérivation dans `secrets.ts` est le seul
  endroit à changer.
- **Poivre des mots de passe.** Un secret de plus, rangé au même endroit que
  `APP_SECRET_KEY`, donc volé avec elle ; et perdu, il rend **tous** les mots
  de passe invalides, sans rotation possible autrement qu'en faisant
  réinitialiser tout le monde. Argon2id à 19 MiB rend déjà l'attaque d'une base
  volée coûteuse.

## Conséquences

- **Mesures compensatoires, à tenir** :
  - **chiffrement du volume** de la machine du panel (LUKS, ou chiffrement du
    disque par l'hébergeur) : c'est lui qui protège les données personnelles
    d'un disque sorti du centre de données ;
  - **permissions** : `env/` en 750, les fichiers en 640, `.dbpass` en 600 ;
    API et interface sous un utilisateur système sans shell, confinés par
    systemd (`ProtectSystem=strict`, `NoNewPrivileges`), n'écoutant que
    `127.0.0.1` ; PostgreSQL local ;
  - **sauvegardes chiffrées** : `gamedashboard backup` écrit base et `env/`
    chiffrés par une clé de sauvegarde tenue hors de l'archive, à garder hors
    de la machine ([restauration](../runbooks/restauration-base.md)) ;
  - **rétention** : sessions, tentatives de connexion et journal purgés
    (`retention.service.ts`), ce qui borne la quantité d'adresses IP gardées.
- **Qui obtient root sur la machine lit tout** : la clé maître, la base, les
  secrets déchiffrés. C'est le plafond assumé ; la réponse est le
  [runbook d'incident](../runbooks/incident-securite.md), rotation de la clé
  maître et de chaque jeton de node comprise.
- **Une copie de la base seule** livre les données personnelles, pas les
  secrets (chiffrés) ni les mots de passe (Argon2id).
- **À revoir** si le panel devient multi-machines (la clé voyagerait), s'il
  est hébergé là où un KMS est disponible, ou si une obligation
  réglementaire impose le chiffrement applicatif des données personnelles.
