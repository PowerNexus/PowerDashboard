# Machine injoignable

**Quand** : un node passe « Injoignable » dans l'administration, ou un
système tiers reçoit le webhook `node.unreachable`.

**Ce que voient les clients** : l'interface de chacun de leurs serveurs sur
cette machine est **entièrement bloquée** par un écran qui dit la vérité. La
machine ne répond plus, le serveur tourne peut-être encore, rien n'est perdu,
et l'hébergeur est prévenu. Aucune mesure n'est affichée à zéro : elles sont
absentes. Voir [ADR 0005](../adr/0005-machine-muette.md).

## Comment le panel en décide

1. **La sonde** (`node-probe.service.ts`) appelle `GET /api/system` sur chaque
   daemon qu'elle n'a pas entendu depuis dix secondes, avec le jeton du node.
   Seule une réponse 2xx compte : **un 401 ou un 403 vaut silence**. La
   machine répond, mais avec un autre jeton que le nôtre, donc elle est
   inutilisable.
2. **Le seuil** : au-delà de deux minutes sans contact
   (`NODE_HEARTBEAT_LOST_MS`), `nodeStatus()` conclut « injoignable ».
3. **Le veilleur** (`node-health-watcher.service.ts`, toutes les 30 s) pose
   `nodes.unreachable_since` et émet `node.unreachable` **une seule fois**. Le
   webhook porte le nombre de serveurs coupés et le drapeau `maintenance`.

Le retour est automatique. Dès qu'une sonde réussit, le veilleur efface la
marque et émet `node.recovered` avec la durée de la panne, et les interfaces
des clients se débloquent d'elles-mêmes.

## Diagnostic

Depuis la machine du panel, sans jeton (il ne sort pas de la base) :

```bash
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' https://<fqdn>:<port>/api/system
```

| Réponse | Ce qu'elle dit | Suite |
|---|---|---|
| délai dépassé, connexion refusée | le daemon ne répond pas : arrêté, machine éteinte, pare-feu | sur la machine : `systemctl status wings`, `journalctl -u wings -n 200` |
| erreur TLS | certificat du daemon expiré, ou émis pour un autre nom que `fqdn` | renouveler le certificat que `config.yml` désigne, redémarrer Wings |
| `401` | le daemon répond et la liaison fonctionne : c'est **le jeton du panel** qu'il refuse | [rotation du jeton de node](./rotation-jeton-node.md#si-le-node-est-perdu-malgré-tout) |

Un `401` est la réponse normale d'un daemon en bonne santé à une requête sans
jeton. Associé à un node « injoignable », il désigne donc un désaccord de
jetons : la sonde, elle, présente le jeton de la base et se fait refuser.

Un désaccord de jetons juste après une rotation refusée est le cas documenté
dans le runbook de rotation. Un désaccord sans rotation récente veut dire que
quelqu'un a modifié le `config.yml` de la machine : le traiter comme un
incident de sécurité.

## Ce qu'il ne faut pas faire

- **Écrire `unreachable_since` à la main.** Le veilleur en est le seul
  écrivain, et la colonne dit *ce qui a été annoncé*. L'effacer ne ramène pas
  la machine. Cela débloque seulement des écrans dont les boutons n'auront
  aucun effet, et fait taire l'alerte suivante.
- **Passer le node en maintenance pour faire taire l'alerte.** L'état
  « injoignable » l'emporte sur la maintenance, et l'alerte part quand même.
  La maintenance ne change que le drapeau `maintenance` du webhook.

## Intervention prévue

Avant d'arrêter une machine volontairement (mise à jour du noyau, de Wings,
redémarrage), **passer le node en maintenance** depuis l'écran « Machines ».
L'alerte partira quand même si l'arrêt dépasse deux minutes, mais avec
`maintenance: true`, ce qui permet au système qui la reçoit de ne réveiller
personne. Retirer la maintenance une fois la machine revenue.

Une montée de version de Wings se fait node par node, après les bancs de
[`infra/local`](../../infra/local/README.md), jamais sur tout le parc à la fois
([ADR 0001](../adr/0001-wings-conserve.md)).
