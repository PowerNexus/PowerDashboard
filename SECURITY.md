# Politique de sécurité

GameDashboard administre des machines de jeu : une faille dans le panel peut
donner la main sur des nodes entiers. Les signalements sont donc traités en
priorité, avant toute autre évolution.

## Versions suivies

Seule la **dernière version publiée** (étiquette `v*`, page
[Releases](https://github.com/PowerNexus/PowerDashboard/releases)) reçoit des
correctifs de sécurité. Une installation se met à jour par :

```bash
sudo gamedashboard update   # sauvegarde la base et env/, puis installe la nouvelle version
```

Les versions antérieures et la branche `main` entre deux publications ne sont
pas suivies à part : le correctif sort dans une nouvelle version.

## Signaler une vulnérabilité

**N'ouvrez pas de ticket public**, ni de pull request, ni de discussion : ce
serait publier la faille avant son correctif.

Passez par le signalement privé de GitHub : onglet **Security** du dépôt, puis
**Report a vulnerability**
([lien direct](https://github.com/PowerNexus/PowerDashboard/security/advisories/new)).
Le rapport n'est visible que des mainteneurs.

Pour qu'on puisse reproduire vite, indiquez si possible :

- la version concernée (`gamedashboard status`, ou le commit) ;
- le composant touché (`apps/web`, `apps/api`, `packages/*`, scripts `infra/`) ;
- les étapes de reproduction et le rôle du compte utilisé (`user`, `reseller`,
  `support`, `admin`, sous-utilisateur d'un serveur, clé d'API…) ;
- l'impact constaté : ce qu'un attaquant lit, modifie ou exécute ;
- une piste de correction, si vous en avez une.

### Ce à quoi vous pouvez vous attendre

| Étape | Délai visé |
|---|---|
| Accusé de réception | 3 jours ouvrés |
| Évaluation (confirmée ou non, gravité CVSS) | 10 jours ouvrés |
| Correctif publié, faille critique ou haute | 30 jours |
| Correctif publié, gravité moyenne ou basse | prochaine version |

Vous êtes tenu informé à chaque étape. L'avis de sécurité est publié avec le
correctif, et vous y êtes crédité si vous le souhaitez. Nous demandons de ne
rien divulguer avant cette publication, ou avant 90 jours si le correctif
tarde : passé ce délai, prévenez-nous et divulguez librement.

## Périmètre

**Dans le périmètre** : tout le code de ce dépôt — l'interface (`apps/web`),
l'API (`apps/api`), les paquets partagés (`packages/*`, dont `auth` et
`contracts`), les eggs maison (`infra/eggs`) et les scripts d'installation et
d'exploitation (`infra/prod`, `infra/release`, la commande `gamedashboard`).

En particulier, sont des failles et non des défauts d'interface :

- un contournement d'autorisation : accès au serveur d'un autre client,
  permission de sous-utilisateur ignorée, revendeur sortant de son parc ;
- une erreur de portée ou d'expiration sur les jetons que le panel remet à
  Wings (WebSocket, transfert de fichiers) ;
- l'authentification SFTP, que Wings délègue au panel ;
- toute fuite de secret : jeton de node, clé d'API, mot de passe de base de
  données, clé maître `APP_SECRET_KEY`.

**Hors périmètre** :

- **Wings** et l'isolation des conteneurs (traversée de chemin, symlinks,
  évasion) : Wings est utilisé tel quel, sans fork
  ([ADR 0001](./docs/adr/0001-wings-conserve.md)). Signalez ces failles
  directement au [projet Pterodactyl](https://github.com/pterodactyl/wings/security).
  Si le panel les rend exploitables, par exemple en transmettant une donnée
  non filtrée, c'est en revanche dans notre périmètre.
- Le **jeton statique** qui authentifie le panel auprès de Wings : c'est une
  limite connue du contrat de Wings, assumée et compensée (PLAN §5.5, runbook
  [rotation du jeton de node](./docs/runbooks/rotation-jeton-node.md)).
- Une installation qui s'écarte du modèle `infra/prod` : API de Wings exposée
  sur Internet, TLS désactivé, `.env` lisible par tous.
- Les dénis de service volumétriques, l'ingénierie sociale, les rapports
  d'outils automatiques sans démonstration d'impact.

## Mesures en place

Pour situer un signalement, voici ce que le panel garantit aujourd'hui :

- **Mots de passe** hachés en Argon2id (paramètres OWASP) ; les condensats
  bcrypt repris de Pterodactyl sont lus puis réécrits à la connexion suivante
  ([ADR 0002](./docs/adr/0002-argon2id.md)). Politique de longueur et
  vérification HaveIBeenPwned par k-anonymat.
- **Double authentification** TOTP et passkeys WebAuthn, avec codes de secours ;
  imposée par défaut au personnel pour l'accès à l'administration.
- **Sessions et clés d'API** opaques (256 bits d'aléa), stockées sous forme de
  condensat SHA-256, révocables immédiatement ; clés préfixées `gd_live_`,
  avec portées et liste d'IP autorisées.
- **Secrets relus par le panel** (jetons de node, mots de passe de bases)
  chiffrés en AES-256-GCM sous la clé maître ; rotation outillée
  ([runbook](./docs/runbooks/cle-maitre-secrets.md)).
- **Cookies** `HttpOnly`, `SameSite=Lax`, `Secure` en production ; en-têtes
  CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`. Captcha Turnstile sur connexion, inscription et
  réinitialisation ; limitation des tentatives.
- **Chaîne de livraison** : chaque archive publiée porte une empreinte SHA-256
  que l'installeur vérifie avant usage, et une attestation de provenance
  GitHub ; dépendances suivies par Renovate, alertes de vulnérabilité
  appliquées sans attendre le cycle hebdomadaire.

## Pour les contributeurs

- Aucun secret dans le dépôt : seuls les `.env.example` sont versionnés.
- Toute correction de faille s'accompagne d'un test de non-régression qui
  échoue sans elle.
- Le détail d'une faille non publiée ne va ni dans un message de commit, ni
  dans une pull request publique : on travaille dans l'avis de sécurité privé
  (fork temporaire proposé par GitHub), puis on publie correctif et avis
  ensemble.
