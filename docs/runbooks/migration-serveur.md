# Déplacer un serveur entre nodes

**Quand** : une machine se remplit, doit être rendue ou mise à jour, ou un
client doit changer de région.

**Ce qu'on risque** : un serveur bloqué « en transfert », que ni le client ni
l'administration ne peuvent plus démarrer. Ses fichiers, eux, ne se perdent
pas. Tant que le panel n'a pas enregistré la bascule, la copie du node de
départ reste intacte et c'est elle que la base désigne.

## Ce que fait le panel

`POST /api/v1/admin/servers/:id/transfer`, carte « Déplacer vers un autre
node » de la fiche du serveur (`ServerTransferService`) :

1. **réserve** le premier port libre du node d'arrivée, passe le serveur en
   état `transferring` et crée une ligne `server_transfers` (`running`), dans
   une seule transaction ;
2. **donne l'ordre** au node de départ, avec un jeton de transfert valable une
   heure. Le départ arrête le serveur, fabrique l'archive et la pousse
   **directement** au node d'arrivée, sans passer par le panel ;
3. **bascule** quand l'arrivée rapporte `success` : `servers.node_id` change,
   le port réservé devient l'adresse par défaut, les ports du départ sont
   rendus, puis le panel demande au départ d'effacer sa copie ;
4. **défait tout** si l'un des deux bouts rapporte `failure`, ou si le départ
   refuse l'ordre : le port réservé est rendu, l'état effacé, le motif
   conservé dans `server_transfers.failure_reason`.

Le client est prévenu dans les deux cas (`server.transferred`,
`server.transfer_failed`), et les webhooks `server.transfer_started`,
`…_completed` et `…_failed` partent vers les systèmes tiers.

## Avant de lancer

- **Le serveur doit être disponible.** Le bouton est désactivé tant que
  l'état n'est pas nul : une installation, une restauration ou une suspension
  en cours l'empêchent.
- **Le node d'arrivée ne doit pas être en maintenance**, sinon le panel refuse.
  Il doit aussi avoir **un port libre** : sinon, « Plus aucun port libre sur
  le node de destination ».
- **Vérifier la place à la main.** Le panel ne contrôle ni la mémoire ni le
  disque du node d'arrivée : sous Administration › Nodes, comparer la charge
  du node aux limites du serveur.
- **Les deux daemons doivent se joindre.** L'archive part du départ vers
  l'adresse publique du daemon d'arrivée (`fqdn` et port déclarés). Un pare-feu
  entre les deux machines fait échouer le transfert, pas le panel.
- **Prévenir le client.** Son serveur est arrêté pendant toute la copie, et
  **son adresse change** : un port appartient à une machine.

## Procédure

1. Administration › Serveurs › le serveur › « Déplacer vers un autre node »,
   choisir la destination, confirmer.
2. Suivre l'état sur la fiche : « Transfert » pendant la copie, puis retour à
   l'état normal sur le nouveau node.
3. En cas d'échec, lire le motif dans le journal de l'API, où l'échec est
   rapporté par le daemon qui l'a vu. Sur la machine de ce daemon,
   `journalctl -u wings -n 200` en dit plus.

## Vérifier que c'est terminé

- La fiche du serveur nomme le nouveau node, avec une adresse de ce node.
- Le serveur démarre depuis sa console.
- Sur le **node de départ**, plus de conteneur ni de volume à son identifiant :
  ```bash
  docker ps -a --filter "name=<uuid>"
  ls /var/lib/pterodactyl/volumes/<uuid>    # dossier `system.data` de config.yml
  ```
  Si la copie de départ n'a pas pu être effacée, le journal de l'API porte
  « le node de départ n'a pas retiré sa copie ». Le serveur **est** déplacé :
  effacer ce conteneur et ce dossier à la main, et seulement ceux-là.

## Serveur bloqué « en transfert »

Le panel ne clôt pas de lui-même un transfert dont aucun daemon ne rapporte
l'issue : un daemon mort en pleine copie, un compte rendu perdu. Au bout de
deux heures (`TRANSFER_STALE_MS`), le node d'arrivée perd seulement le droit
de lire la configuration du serveur. Le serveur, lui, reste en `transferring`,
et toute action lui est refusée.

1. **Repérer** les transferts sans nouvelles depuis plus de deux heures :
   ```sql
   select t.server_id, f.name as depart, d.name as arrivee, t.created_at
   from server_transfers t
   join nodes f on f.id = t.from_node_id
   join nodes d on d.id = t.to_node_id
   where t.state = 'running' and t.created_at < now() - interval '2 hours';
   ```
2. **Vérifier que rien ne tourne encore** sur le node d'arrivée :
   `journalctl -u wings -n 200` ne doit plus montrer de réception pour ce
   serveur. Un transfert lent mais vivant se laisse finir.
3. **Faire à la main ce que fait `rollback()`**, et rien d'autre, dans une
   transaction (`sudo -u postgres psql gamedashboard`) :
   ```sql
   \set serveur '<uuid>'
   begin;
   update allocations a set server_id = null, updated_at = now()
     from server_transfers t
    where t.server_id = :'serveur' and t.state = 'running'
      and a.server_id = t.server_id and a.node_id = t.to_node_id;
   update server_transfers
      set state = 'failed', failure_reason = 'Clos à la main : aucun compte rendu du daemon.', updated_at = now()
    where server_id = :'serveur' and state = 'running';
   update servers set state = null, updated_at = now()
    where id = :'serveur' and state = 'transferring';
   commit;
   ```
   C'est sans risque pour les fichiers : la base désignait toujours le node de
   départ, qui garde sa copie jusqu'à la bascule.
4. **Nettoyer l'arrivée** : un conteneur ou un volume à cet identifiant sur le
   node d'arrivée est une copie partielle. L'effacer, en vérifiant bien qu'il
   s'agit de la machine d'**arrivée**.
5. Redémarrer le serveur depuis sa console. Relancer le transfert si besoin.

## Ce que le transfert ne sait pas faire

**Évacuer une machine morte.** C'est le node de départ qui fabrique l'archive :
un node injoignable ne transfère rien. Il reste alors à remettre la machine
sur pied ([machine injoignable](./machine-injoignable.md)). À défaut, il faut
recréer le serveur ailleurs. Les sauvegardes du serveur ne sauvent pas la mise :
seul l'adaptateur local est proposé aujourd'hui, et elles vivent sur la même
machine.

**Déplacer un parc entier d'un coup.** Chaque serveur se déplace à part, et
chacun change d'adresse. Pour vider un node, déplacer ses serveurs un à un, en
choisissant chaque fois une destination qui a la place. Le passer en
maintenance empêche seulement qu'on y déplace un serveur : cela n'arrête pas
ceux qui y tournent.
