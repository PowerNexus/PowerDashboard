# Production locale (WSL — Codiax)

La production, répétée sur la machine. Même `NODE_ENV=production`, même
construction, mêmes ports, même nginx devant, même PostgreSQL. Ce n'est pas un
second serveur de développement : c'est ce qui permet de voir, avant de
livrer, ce qui ne se comporte pas pareil une fois construit.

```bash
# Mise en place, ou remise à jour après des changements de code
bash infra/local/install.sh

# Au quotidien
panel start | stop | restart | status | logs [api|web]
```

Le panel répond sur **https://gamedashboard.local**.

## Une étape se fait sous Windows, une seule fois

Le reste est automatique, mais deux choses relèvent de l'administration de
Windows et ne se font pas depuis Linux :

```powershell
# PowerShell, en administrateur
$h = "$env:SystemRoot\System32\drivers\etc\hosts"
if (-not (Select-String -Path $h -Pattern 'gamedashboard\.local' -Quiet)) {
  Add-Content -Path $h -Value "`n127.0.0.1`tgamedashboard.local"
}
Copy-Item "\\wsl.localhost\Codiax\root\.local\share\mkcert\rootCA.pem" `
          "$env:TEMP\mkcert-rootCA.crt" -Force
Import-Certificate -FilePath "$env:TEMP\mkcert-rootCA.crt" `
                   -CertStoreLocation Cert:\LocalMachine\Root
```

La première ligne fait résoudre le nom ; la seconde fait reconnaître
l'autorité de mkcert par Chrome et Edge, sans quoi ils afficheront un
avertissement à chaque ouverture.

**Ce que la seconde implique**, parce qu'elle mérite d'être dite : tout
certificat signé par cette autorité sera accepté par la machine entière. Sa
clé privée vit dans `/root/.local/share/mkcert` sur Codiax. C'est le
fonctionnement normal de mkcert, et c'est la même autorité que celle qui signe
déjà `powervideo.local`.

Une fois la ligne `hosts` posée côté Windows, WSL la recopie dans son propre
`/etc/hosts` à chaque démarrage : il n'y a rien à refaire côté Linux.

## Le certificat

Émis par mkcert pour `gamedashboard.local`, `*.gamedashboard.local`,
`localhost`, `127.0.0.1` et `::1`. Le joker permet de tester les **domaines de
revendeurs** sans émettre un certificat de plus à chaque essai. Il expire en
décembre 2028 ; `install.sh` affiche la date à chaque passage.

Aucune autorité publique ne signe un nom en `.local` — c'est pourquoi mkcert,
et non certbot.

## Une seule origine

`PANEL_ORIGIN` sert de référence au contrôle d'origine des WebSockets, à CORS
et à l'identifiant de partie vérifiante des clés d'accès. Deux noms vivants
donneraient des échecs discrets sur l'un des deux — console muette, clé d'accès
refusée — sans message qui l'explique.

Tout ce qui arrive en clair, ou par `gamedashboard.localhost`, ou par
`localhost`, est donc **redirigé** en 301 vers `https://gamedashboard.local`
plutôt que servi.

## Éprouver le contrat Wings

Dix bancs, à lancer quand le panel tourne. Ils montent un node et un daemon
réels, puis nettoient tout — serveur, volume, node, egg, localisation.

```bash
bash infra/local/verifier-wings.sh          # le daemon accepte la configuration et bat
bash infra/local/verifier-cycle-serveur.sh  # créer, installer, démarrer, arrêter, supprimer
bash infra/local/verifier-sftp.sh           # clé publique, authentification, dépôt de fichier
bash infra/local/verifier-sauvegardes.sh    # archive, compte rendu, téléchargement, restauration
bash infra/local/verifier-console.sh        # autorisation, flux, commande par l'API, socket muette aux ordres
bash infra/local/verifier-bases.sh          # hôte MySQL, identifiants, connexion réelle, quota
bash infra/local/verifier-revendeur.sh      # parc, offre complète, enveloppe, périmètre
bash infra/local/verifier-transfert.sh      # deux daemons, copie, intégrité, nettoyage
bash infra/local/verifier-rotation.sh       # remplacer le jeton d'un node sans le perdre
bash infra/local/verifier-planificateur.sh  # une tâche part seule, sans gêner les autres
```

**Le dixième éprouve la promesse la moins vérifiable du panel** : celle de
l'écran « Tâches », qui ne se tient pas au moment où on la fait mais à quatre
heures du matin. Il crée une planification par la vraie route, ramène son
échéance dans le passé, **ne clique sur rien**, et regarde si le conteneur
s'arrête de lui-même. Il vérifie ensuite qu'un serveur en installation fait
*reporter* l'occurrence de quelques minutes plutôt que de la consommer — la
sauter perdrait la sauvegarde du jour sans le dire à personne.

Il a été écrit pour un défaut précis : les planifications étaient exécutées
**en file pour toute la plateforme, attentes comprises**. Une séquence
courante — « prévenir les joueurs, attendre dix minutes, redémarrer » —
suspendait donc les sauvegardes nocturnes de tous les autres clients pendant
dix minutes, sans que rien ne le signale. Le banc pose deux planifications
échues au même instant, l'une qui attend dix minutes et l'autre qui part tout
de suite, et mesure le temps que met la seconde.

**Le dernier garde la porte de secours.** Le jeton d'un node sert dans les
deux sens : le daemon s'en sert pour appeler le panel, le panel pour appeler
le daemon. Écrire en base un jeton que la machine n'a jamais reçu la rend
injoignable *des deux côtés*, et il ne reste aucun chemin pour la corriger à
distance. Le banc éprouve donc trois choses, mais une seule compte vraiment :
**quand le daemon ne répond pas, le panel s'abstient-il d'écrire ?** Il coupe
le daemon, demande une rotation, et vérifie que la réponse est un refus motivé
et que la colonne en base n'a pas bougé — puis relance le daemon avec le
fichier qu'il avait pour prouver que le refus n'a rien abîmé.

Il a aussi rappelé que les deux sens n'emploient pas la même forme
d'autorisation : le daemon s'annonce au panel par `identifiant.jeton`, le
panel s'annonce au daemon par le **jeton nu**. Les confondre donne un 403 qui
ressemble à s'y méprendre à un jeton refusé.

Le huitième lance **deux daemons côte à côte** (A sur 8080, B sur 8081 avec sa
propre racine de données) et déplace un serveur de l'un à l'autre. Il a relevé
deux défauts d'un coup : le jeton de transfert partait sans son préfixe
`Bearer `, ce qui faisait échouer **tout** transfert ; et la copie de départ
restait sur la machine d'origine après un transfert réussi.

Le sixième monte son **propre** conteneur MySQL et le retire à la fin : celui
de votre environnement de développement n'est ni lu ni touché. Il va jusqu'à
ouvrir une connexion avec les identifiants que le panel remet au client — une
ligne en base ne prouve rien, elle décrit ce que le panel *croit* avoir fait
sur un serveur qu'il ne relit jamais.

**Le piège que le cinquième a mis au jour** : le daemon n'accepte le WebSocket
que si l'en-tête `Origin` **égale exactement** l'adresse du panel inscrite
dans son `config.yml`. Un `http` au lieu d'un `https`, ou un nom différent de
celui par lequel on ouvre le panel, et toutes les consoles restent muettes —
sans message d'erreur, ni côté navigateur ni côté panel. C'est pourquoi
`install.sh` réaffirme `PANEL_ORIGIN` à chaque passage plutôt que de le poser
une fois.

Le quatrième a déjà servi à quelque chose : il a relevé que le panel
**refusait le compte rendu de toute sauvegarde locale**. Le daemon laisse le
champ `parts` à zéro quand il n'y a pas d'envoi multipart, Go sérialise une
tranche nil en `null`, et le schéma exigeait un tableau. Les sauvegardes
restaient « en cours » pour toujours : quota consommé, téléchargement refusé,
restauration impossible. Invisible pour tout test unitaire, puisque la
divergence était entre le schéma du panel et ce que le daemon envoie vraiment.

Le troisième éprouve la promesse de l'écran « SFTP » des réglages d'un
serveur : il dépose une clé publique jetable sur un compte client, se met à la
place du daemon pour appeler la route d'authentification, puis ouvre une
**vraie session `sftp`** et vérifie que le fichier envoyé arrive dans le
volume. Il passe par la clé et non par le mot de passe — c'est le mode que
l'écran recommande, et un banc n'a pas à manipuler le mot de passe d'un compte.

**Après un redémarrage de WSL**, rien ne repart tout seul — il n'y a pas de
systemd. `panel start` relève PostgreSQL et les deux processus ; Docker se
lance à part, et les bancs en ont besoin :

```bash
sudo service docker start && panel start
```

Ils demandent aussi le binaire `wings`, compilé depuis le clone local :

```bash
cd /root/vendor/wings && go build -o /usr/local/bin/wings .
```

**Ce que le second prouve, et ce qu'il ne prouve pas.** Wings ne met pas la
commande de démarrage dans le `Cmd` du conteneur : il l'exporte en variable
`STARTUP` et compte sur l'entrypoint de l'image pour l'exécuter — c'est le
contrat des images « yolks ». Le banc vérifie donc que `STARTUP`,
`SERVER_MEMORY` et le port alloué arrivent intacts, ce dont le panel répond.
Que le programme démarre ensuite dépend de l'image, et une image nue comme
`alpine` ne l'honore pas : elle lance son shell par défaut, ce qui ressemble à
tort à un panel qui n'aurait rien transmis.

## Les trois divergences avec `infra/prod`

1. **Pas de systemd.** WSL n'en a pas ; `panel` pilote les trois processus.
2. **Tout tourne en root.** La production crée un compte système sans shell ;
   ici, le seul utilisateur est root et un second n'isolerait de personne.
3. **TLS par mkcert**, et pas de limitation par adresse — toutes les requêtes
   viennent de la même machine, et la zone se bloquerait elle-même au premier
   rechargement un peu vif.

## Ce qui n'est pas touché

nginx est **partagé** : `powervideo.local` était déjà servi sur cette machine
et le reste. Le seul site retiré du lien est le `default` d'Ubuntu, qui aurait
répondu à la place du nôtre. `install.sh` et `panel` passent `nginx -t` avant
tout démarrage ou rechargement, pour la même raison qu'en production.

Le serveur de développement écoute sur **3000**, la production locale sur
**3210** et **3211** : les deux cohabitent. La source est **copiée** dans
`/opt/gamedashboard/app` plutôt que construite dans l'arbre de travail : la
production se construit depuis un état figé, et ses `node_modules` lui restent
propres.

## Le premier compte

Une base fraîche n'a aucun compte, et rien ne promeut le premier inscrit.
`install.sh` en crée un s'il n'en existe aucun : il ouvre les inscriptions le
temps d'un appel à la vraie route d'inscription — c'est le code de
l'application qui hache le mot de passe — promeut le compte en administrateur,
puis **referme**. Le mot de passe est affiché une seule fois.

Pour en créer un autre plus tard, ouvrir les inscriptions depuis
l'administration, ou :

```bash
sudo -u postgres psql -d gamedashboard \
  -c "update users set role = 'admin' where email = 'vous@exemple.fr'"
```
