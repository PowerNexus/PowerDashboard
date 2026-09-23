# Rotation du jeton de node

**Quand** : rotation planifiée, fuite suspectée d'un `config.yml` ou d'une
sauvegarde de la base, départ d'une personne qui avait accès à une machine.

**Ce qu'on risque** : perdre le node. Le jeton sert dans les deux sens : le
daemon s'en sert pour appeler le panel, le panel pour appeler le daemon. Si la
base porte un jeton que la machine n'a jamais reçu, le node devient
injoignable *des deux côtés*, et il ne reste aucun chemin pour le corriger à
distance. Voir [ADR 0001](../adr/0001-wings-conserve.md).

## Ce que fait le panel

`POST /api/v1/admin/nodes/:id/token/rotate`, bouton « Remplacer le jeton »
de l'écran « Machines » (`NodeConfigurationService.rotateToken`) :

1. tire un nouveau couple identifiant et jeton ;
2. **pousse** la nouvelle configuration au daemon, authentifié par l'*ancien*
   jeton ;
3. **vérifie** en rappelant le daemon avec le *nouveau* jeton ;
4. n'écrit en base **que si la vérification réussit**.

Si le daemon ne répond pas, la rotation est **refusée** (`applied: false`,
motif dans `failure`) et rien n'est écrit : l'ancien jeton reste bon des deux
côtés. Les deux issues sont tracées au journal d'activité
(`node.token_rotated` ou `node.token_rotation_failed`), avec l'identifiant du
jeton, jamais le secret.

## Procédure

1. **Vérifier que le node est en ligne** sur l'écran « Machines ». Une
   rotation sur un node injoignable sera refusée, ce qui est le comportement
   voulu.
2. **Lancer la rotation** depuis l'écran, ou :
   ```bash
   curl -s -X POST -b "__Host-gd_session=…" \
     https://gamedashboard.local/api/v1/admin/nodes/<id>/token/rotate
   ```
   Sans corps, donc **sans** `content-type: application/json` : Fastify refuse
   un en-tête JSON suivi de rien.
3. **Lire la réponse** :
   - `applied: true` : terminé. Le nouvel identifiant est dans `tokenId`.
   - `applied: false` : rien n'a changé. Lire `failure`, rétablir la liaison,
     puis recommencer. Un daemon lancé avec `ignore_panel_config_updates`
     refuse toujours la poussée : passer l'option à `false` dans le
     `config.yml` de la machine, redémarrer Wings, puis relancer la rotation.
4. **Vérifier** : le node reste « En ligne » au-delà de deux minutes
   (`NODE_HEARTBEAT_LOST_MS`), et une console s'ouvre sur un de ses serveurs.

## Si le node est perdu malgré tout

Un seul cas peut séparer les deux côtés : le daemon a appliqué le nouveau
jeton, mais la vérification a échoué (daemon en cours de redémarrage, réseau
coupé entre la poussée et la vérification). Le panel garde alors l'ancien
jeton, et la machine a le nouveau. Symptômes : node injoignable juste après
une rotation refusée, et `401` ou `403` dans les journaux de Wings.

Le panel a gardé la bonne référence. C'est la machine qu'on remet d'accord :

1. télécharger le `config.yml` du node depuis l'écran « Machines »
   (`GET /api/v1/admin/nodes/:id/configuration`). Il porte le jeton que la
   base connaît, **en clair** : le traiter comme un secret ;
2. le déposer sur la machine, à la place de `/etc/pterodactyl/config.yml` ;
3. redémarrer le daemon (`systemctl restart wings`) ;
4. attendre le retour « En ligne », puis relancer la rotation.

Ne **jamais** corriger en écrivant un jeton en base à la main. C'est
précisément l'erreur que la procédure empêche.

## Éprouver la procédure

```bash
bash infra/local/verifier-rotation.sh
```

Le banc monte un node et un Wings réels, fait une rotation, vérifie que
l'ancien jeton cesse de valoir, puis **coupe le daemon** et vérifie que la
rotation est refusée sans rien écrire en base. Il relance enfin le daemon avec
son fichier pour prouver que le refus n'a rien abîmé. À lancer après toute
modification de `node-configuration.service.ts` et à chaque montée de version
de Wings. Il ne tourne que sur Codiax : il faut Docker, le binaire `wings` et
la production locale.
