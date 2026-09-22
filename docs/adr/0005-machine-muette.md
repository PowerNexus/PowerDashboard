# 0005 — La machine injoignable est un état de premier rang

- **État** : acceptée
- **Date** : 2026-09
- **Références** : PLAN §8.2 ; `packages/contracts/src/node.ts` (`nodeStatus`,
  `NODE_HEARTBEAT_LOST_MS`), `packages/contracts/src/server.ts`
  (`nodeOutageBlock`), `apps/api/src/modules/scheduler/node-health-watcher.service.ts`

## Contexte

Quand le daemon d'une machine se tait, le panel ne sait plus rien des serveurs
qu'elle héberge. Ils tournent peut-être encore, ou peut-être plus. Deux
tentations sont fausses :

- **afficher le dernier état connu** : un serveur « en ligne » et une console
  ouverte, mais aucune commande ne part. Le client clique, rien ne se passe, et
  il conclut que le panel est cassé ;
- **afficher des mesures à zéro** : 0 % de CPU se lit comme « serveur arrêté »,
  alors que la vérité est « on ne sait pas ».

De plus, un état dérivé ne se remarque pas tout seul. `nodeStatus` conclut
« injoignable » chaque fois qu'on l'interroge, mais personne ne l'interroge la
nuit. Un node tombé à 3 h était découvert au matin, par le client.

## Décision

**« Injoignable » est un état à part entière, décidé à un seul endroit et
annoncé une seule fois.**

1. **La règle** : `nodeStatus()` (`contracts`) le déduit de l'âge du dernier
   battement, au-delà de `NODE_HEARTBEAT_LOST_MS` (deux minutes). On ne stocke
   pas de booléen à côté, qui finirait par contredire le battement.
2. **L'annonce** : `NodeHealthWatcherService` balaie toutes les 30 s et est
   **le seul écrivain** de `nodes.unreachable_since`. Cette colonne n'enregistre
   pas la santé du node, mais *ce qui a déjà été annoncé*. C'est ce qui permet
   d'émettre uniquement aux transitions : un rappel quand la machine tombe, un
   autre quand elle revient, et rien entre les deux. Elle reçoit l'heure du
   dernier battement, pas celle du constat : la panne a commencé quand le node
   s'est tu.
3. **L'interface** : `nodeOutageBlock()` (`contracts`) transforme
   `unreachableSince` en blocage **complet** de l'interface serveur, avec un
   texte qui dit la vérité : on ne sait pas, rien n'est perdu, l'hébergeur est
   prévenu. Les mesures sont *absentes*, jamais à zéro. `MetricBar` accepte une
   valeur nulle et l'affiche en hachures.

## Options écartées

- **Un booléen `online` stocké** : deux sources de vérité, qui divergent au
  premier battement manqué.
- **Un bandeau d'avertissement sur l'interface normale** : les boutons
  resteraient actifs et ne feraient rien.
- **Dériver l'alerte à l'affichage** : personne ne regarde l'écran à 3 h.

## Conséquences

- Si l'administration affiche « injoignable », le rappel est parti. Les deux
  lisent le même seuil.
- Un node **jamais joint** (`last_heartbeat_at` nul, daemon pas encore
  installé) n'est pas annoncé : on n'a rien perdu.
- La marque est posée *avant* l'émission du rappel. Si l'émission échoue,
  l'alerte est perdue, mais elle ne part jamais en boucle toutes les 30 s.
- Toute nouvelle vue d'un serveur doit passer par `nodeOutageBlock()` avant
  `serverBlock()`. Aucun écran ne doit tester `unreachableSince` lui-même.
- Le balayage passe par `battre()` (`apps/api/src/common/background-tick.ts`) :
  une panne de base pendant un tour ne doit pas tuer le processus.
