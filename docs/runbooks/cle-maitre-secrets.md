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

L'API refuse de démarrer sans `APP_SECRET_KEY` (`assertEncryptionKey`), et
avec une clé de moins de 32 caractères : le sel de dérivation est public, une
clé courte se devinerait donc hors ligne sur une copie de la base. Une
installation dont la clé est plus courte en change par la rotation du § 1,
l'ancienne clé dans `APP_SECRET_KEY_OLD` : le script la relit, quelle que soit
sa longueur, et n'exige le seuil que de la nouvelle.

`deploy.sh` et `install.sh` ne la génèrent qu'une fois et ne la remplacent
jamais.

Trois situations, trois procédures.

---

## 1. Rotation de la clé maître

**Quand** : la clé a fuité, ou une personne qui la connaissait part.

**Préalable** : une version du script qui reprend le format `v3:`
(`apps/api/src/common/rekey.ts`). Avant ce correctif, le script ne reprenait
que l'ancien format sans préfixe. Il se terminait sur « 0 secret rechiffré »,
et le redémarrage sous la nouvelle clé perdait tous les secrets.

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
   de lignes chiffrées. Si le bilan annonce des valeurs « laissées en l'état »,
   ce sont des valeurs que l'ancienne clé ne lit pas. Les examiner avant de
   continuer.
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
     const id = randomBytes(8).toString("hex");
     const enc = encryptSecret(randomBytes(32).toString("base64url"));
     console.log(`update nodes set daemon_token_id = '\''${id}'\'', daemon_token_enc = '\''${enc}'\'' where id = '\''<node>'\'';`);
   ' | sudo -u postgres psql -d gamedashboard
   ```
   puis déposer sur la machine le `config.yml` téléchargé depuis l'écran
   « Machines » et redémarrer Wings, comme dans
   [« Si le node est perdu »](./rotation-jeton-node.md#si-le-node-est-perdu-malgré-tout).
   C'est la seule écriture de jeton à la main admise : il n'existe alors plus
   aucun jeton valide des deux côtés, donc plus rien à désaccorder.

**Pour ne pas en arriver là** : conserver `APP_SECRET_KEY` hors de la machine,
dans un gestionnaire de secrets, à côté de la sauvegarde de la base. Une
sauvegarde sans sa clé ne restaure que la moitié du panel.
