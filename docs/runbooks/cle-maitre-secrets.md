# Clé maître des secrets (`APP_SECRET_KEY`)

Le panel chiffre en AES-256-GCM tout secret qu'il doit **relire** :

| Table | Colonne | Contenu |
|---|---|---|
| `nodes` | `daemon_token_enc` | Jeton de chaque daemon |
| `database_hosts` | `password_enc` | Compte d'administration des hôtes MySQL |
| `databases` | `password_enc` | Mots de passe des bases des clients |
| `user_credentials_totp` | `secret_enc` | Secrets TOTP |
| `webhooks`, `application_webhooks` | `secret_enc` | Secrets de signature |
| `settings` (`is_secret`) | `value` | SMTP, SSO, clé d'API de facturation… |

La clé AES est dérivée par `scrypt(APP_SECRET_KEY, sel)`
(`packages/auth/src/secrets.ts`). **Changer l'un ou l'autre rend tout ce qui
précède illisible d'un coup.** Les mots de passe des comptes, les sessions et
les clés d'API ne sont pas concernés : ils sont hachés, pas chiffrés.

Chaque valeur est **liée à sa ligne** : chiffrée avec le contexte
`<table>.<colonne>:<id>` (la clé du réglage pour `settings`), sous la forme
`v4:…`. Recopiée sur une autre ligne, elle ne se relit plus : qui écrit en base
ne peut plus poser son propre secret TOTP sur le compte d'un autre, ni le jeton
d'un node sur un autre. Les valeurs écrites avant cette liaison (`v3:…`, ou
sans préfixe) se relisent encore ; le § 4 les lie.

L'API refuse de démarrer sans `APP_SECRET_KEY` (`assertEncryptionKey`), et
avec une clé de moins de 32 caractères : le sel de dérivation est public, une
clé courte se devinerait donc hors ligne sur une copie de la base. Une
installation dont la clé est plus courte en change par la rotation du § 1,
l'ancienne clé dans `APP_SECRET_KEY_OLD` : le script la relit, quelle que soit
sa longueur, et n'exige le seuil que de la nouvelle.

`deploy.sh` et `install.sh` ne la génèrent qu'une fois et ne la remplacent
jamais.

Quatre situations, quatre procédures.

---

## 1. Rotation de la clé maître

**Quand** : la clé a fuité, ou une personne qui la connaissait part.

**Préalable** : une version du script qui reprend les formats `v3:` et `v4:`
(`apps/api/src/common/rekey.ts`). Avant le premier de ces correctifs, le
script ne reprenait que l'ancien format sans préfixe. Il se terminait sur
« 0 secret rechiffré », et le redémarrage sous la nouvelle clé perdait tous
les secrets. Un script qui ne connaît pas la forme liée `v4:` laisserait de
même ces valeurs sous l'ancienne clé.

1. **Sauvegarder la base.** Le script travaille en une transaction, mais une
   sauvegarde est la seule chose qui rattrape une mauvaise clé saisie.
   ```bash
   sudo -u postgres pg_dump -Fc gamedashboard > /root/avant-rekey.dump
   ```
2. **Arrêter l'API** (`panel stop` en local, `systemctl stop
   gamedashboard-api` sous systemd). Un secret écrit pendant la reprise le
   serait avec l'ancienne clé.
3. **Générer la nouvelle clé** : `openssl rand -base64 48`.
4. **Rechiffrer** :
   ```bash
   cd /opt/gamedashboard/app
   set -a; . /opt/gamedashboard/env/api.env; set +a
   APP_SECRET_KEY_OLD="$APP_SECRET_KEY" \
   APP_SECRET_KEY="<nouvelle clé>" \
   FROM_SALT=gamedashboard.secrets.v2 \
     pnpm --filter @gamedashboard/api exec tsx scripts/rekey-secrets.mts
   ```
   `FROM_SALT` est **obligatoire** ici : sa valeur par défaut est celle de
   l'ancien sel, qui sert au cas n° 2.
5. **Lire le bilan.** `N secret(s) rechiffré(s)` doit correspondre au nombre
   de lignes chiffrées, et `0 illisible(s)`. Une valeur illisible est une
   valeur que ni l'ancienne clé ni la nouvelle ne lisent, ou une valeur liée à
   une **autre** ligne que la sienne, donc recopiée : le script ne la blanchit
   pas. Chaque ligne en cause est nommée `ILLISIBLE` dans la sortie. Les
   examiner avant de continuer, et traiter une valeur recopiée comme un
   incident ([runbook](./incident-securite.md)).
6. **Remplacer** `APP_SECRET_KEY` dans `/opt/gamedashboard/env/api.env`, puis
   redémarrer l'API.
7. **Vérifier** : les nodes restent « En ligne » (le panel relit leur jeton à
   chaque appel), une console s'ouvre, l'écran des réglages SMTP ne se présente
   pas comme vide.

**Ce que la rotation ne règle pas.** Qui détient l'ancienne clé *et* une
copie de la base lit encore les anciens secrets. Si la fuite est avérée,
remplacer aussi ce que ces secrets protègent : jetons de node
([runbook](./rotation-jeton-node.md)), secrets de webhooks (« Renouveler le secret »), mots de passe des hôtes MySQL et des bases.

Le jeton d'étape intermédiaire de connexion est hors de portée du script. Il
ne vit que quelques minutes : une connexion en cours au moment de la bascule
est simplement à recommencer.

---

## 2. Le sel de dérivation a changé

**Symptôme** : juste après une livraison, tous les nodes deviennent
injoignables en même temps, et les journaux de l'API se remplissent d'échecs
de déchiffrement. C'est déjà arrivé : un remplacement global de nom a emporté
la chaîne `KEY_DERIVATION_SALT` avec les libellés.

**Ne pas « remettre » le sel à la main** si des secrets ont déjà été écrits
avec le nouveau. On aurait alors deux populations illisibles l'une pour
l'autre.

1. Arrêter l'API et sauvegarder la base (étapes 1 et 2 ci-dessus).
2. Vérifier que `TO_SALT` dans `apps/api/scripts/rekey-secrets.mts` est bien
   le sel de `packages/auth/src/secrets.ts`.
3. Lancer le script avec la clé courante seule : `FROM_SALT` prend par défaut
   l'ancien sel. S'il s'agit d'un autre sel, le passer explicitement.
   ```bash
   pnpm --filter @gamedashboard/api exec tsx scripts/rekey-secrets.mts
   ```
4. Redémarrer l'API et vérifier comme ci-dessus.

Le script est **idempotent** : une valeur déjà reprise ne se déchiffre plus
avec l'ancien sel, et GCM le dit franchement. Le relancer ne fait rien.

**Pour un changement de sel voulu**, l'ordre est inverse : rechiffrer
*d'abord*, avec l'ancien code encore en ligne, puis livrer le nouveau sel. Le
script n'importe pas la bibliothèque, justement pour pouvoir tourner avant la
livraison.

---

## 3. La clé est perdue

Il n'y a **aucune** reprise possible : GCM sans la clé ne se lit pas, et c'est
voulu. Il faut réémettre chaque secret. L'API démarre avec une nouvelle clé,
et les lectures de réglages dégradent proprement : un secret illisible est
traité comme non renseigné, et le SSO reste inactif.

1. **Générer une nouvelle clé** et la mettre dans `api.env`, puis redémarrer.
2. **Réglages** (SMTP, SSO, facturation) : les ressaisir depuis
   l'administration.
3. **Hôtes MySQL** : ressaisir le mot de passe d'administration de chaque
   hôte. Puis, pour chaque base de client, « Régénérer le mot de passe »
   (`POST …/databases/:id/rotate`) : le nouveau est posé sur le serveur MySQL
   *et* en base.
4. **Webhooks** : « Renouveler le secret », puis transmettre le nouveau aux
   destinataires.
5. **TOTP** : les utilisateurs se connectent avec un code de secours (haché,
   donc intact) et réactivent la double authentification. Pour un compte sans
   code de secours :
   ```sql
   delete from user_credentials_totp where user_id = '<id>';
   ```
6. **Jetons de node** : aucune route ne les réémet, car la rotation normale
   a besoin de l'ancien jeton pour parler au daemon. Pour chaque node :
   ```bash
   cd /opt/gamedashboard/app && set -a; . /opt/gamedashboard/env/api.env; set +a
   pnpm --filter @gamedashboard/api exec tsx -e '
     import { randomBytes } from "node:crypto";
     import { encryptSecret } from "@gamedashboard/auth";
     const node = process.env.NODE_ID;
     const id = randomBytes(8).toString("hex");
     // Lié à la ligne du node, comme l'écrit le panel.
     const enc = encryptSecret(randomBytes(32).toString("base64url"), undefined,
       `nodes.daemon_token_enc:${node}`);
     console.log(`update nodes set daemon_token_id = '\''${id}'\'', daemon_token_enc = '\''${enc}'\'' where id = '\''${node}'\'';`);
   ' | sudo -u postgres psql -d gamedashboard
   ```
   (`NODE_ID=<identifiant du node>` exporté avant la commande), puis déposer
   sur la machine le `config.yml` téléchargé depuis l'écran « Machines » et
   redémarrer Wings, comme dans
   [« Si le node est perdu »](./rotation-jeton-node.md#si-le-node-est-perdu-malgré-tout).
   C'est la seule écriture de jeton à la main admise : il n'existe alors plus
   aucun jeton valide des deux côtés, donc plus rien à désaccorder.

**Pour ne pas en arriver là** : conserver `APP_SECRET_KEY` hors de la machine,
dans un gestionnaire de secrets, à côté de la sauvegarde de la base. Une
sauvegarde sans sa clé ne restaure que la moitié du panel.

---

## 4. Lier à leur ligne les secrets d'avant la liaison

**Quand** : une fois, après la mise en ligne de la version qui lie les secrets
à leur ligne (forme `v4:`, audit ASVS NC-18). Elle relit les deux formes :
rien ne casse sans cette étape, mais les valeurs `v3:` restent permutables
jusqu'à leur prochaine écriture — un jeton de node ou un secret TOTP peut ne
jamais être réécrit.

**Jamais avant la mise en ligne** : une API antérieure ne lit pas la forme
`v4:`, et perdrait tous les secrets repris. Pour la même raison, un retour à
une version antérieure après cette étape (ou après la moindre écriture d'un
secret par la nouvelle version) passe par la restauration de la sauvegarde
prise par `gamedashboard update`, pas par un simple changement de version.

1. **Sauvegarder la base** (§ 1, étape 1).
2. **Lier**, avec la clé courante des deux côtés. L'API peut rester en ligne :
   le script verrouille les lignes qu'il reprend, et une écriture de l'API
   attend la fin de la transaction au lieu d'être écrasée.
   ```bash
   cd /opt/gamedashboard/app
   set -a; . /opt/gamedashboard/env/api.env; set +a
   FROM_SALT=gamedashboard.secrets.v2 \
     pnpm --filter @gamedashboard/api exec tsx scripts/rekey-secrets.mts
   ```
   La sortie commence par « Même clé et même sel : les secrets sont seulement
   liés à leur ligne ».
3. **Lire le bilan** : `N secret(s) rechiffré(s), M déjà à jour, 0
   illisible(s)`. Une valeur illisible se traite comme au § 1, étape 5.
4. **Vérifier** qu'il ne reste aucune valeur sans contexte :
   ```sql
   select 'nodes', count(*) from nodes where daemon_token_enc not like 'v4:%'
   union all select 'database_hosts', count(*) from database_hosts where password_enc not like 'v4:%'
   union all select 'databases', count(*) from databases where password_enc not like 'v4:%'
   union all select 'totp', count(*) from user_credentials_totp where secret_enc not like 'v4:%'
   union all select 'webhooks', count(*) from webhooks where secret_enc not like 'v4:%'
   union all select 'application_webhooks', count(*) from application_webhooks where secret_enc not like 'v4:%'
   union all select 'settings', count(*) from settings where is_secret and value #>> '{}' not like 'v4:%';
   ```
   Chaque ligne doit rendre 0. Puis, comme au § 1 : nodes « En ligne », une
   console s'ouvre, les réglages SMTP ne se présentent pas comme vides.

Relancer le script ne fait rien : une valeur déjà liée n'est pas réécrite. Une
rotation de la clé maître (§ 1) lie au passage ce qui ne l'était pas : après
elle, cette étape n'a plus d'objet.