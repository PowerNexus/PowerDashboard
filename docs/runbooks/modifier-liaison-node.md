# Changer l'adresse ou les ports d'un node

**Quand** : la machine change de nom de domaine, passe de `http` à `https`, ou
le port du daemon (8080 par défaut) ou du SFTP (2022) doit changer.

**Ce qu'on risque** : perdre le node. Ces quatre valeurs vivent **des deux
côtés** : en base, où le panel les lit pour joindre le daemon, et dans le
`config.yml` de la machine, où Wings lit les ports sur lesquels écouter. Les
changer d'un seul côté coupe le panel de son daemon. Et **Wings ne rouvre ses
ports qu'à son redémarrage** : `POST /api/update` écrit le fichier et la
configuration en mémoire, pas les serveurs HTTP et SFTP déjà lancés. Le panel
ne peut pas redémarrer Wings ([ADR 0001](../adr/0001-wings-conserve.md)).

Les autres réglages d'un node (nom, localisation, capacité, visibilité) ne
concernent que le panel et s'enregistrent directement : voir « Réglages » sur
la fiche du node. Une capacité inférieure à ce qui est déjà promis aux
serveurs est refusée.

## Ce que fait le panel

`POST /api/v1/admin/nodes/:id/binding`, section « Adresse et ports » de la
fiche du node (`NodeConfigurationService.rebind`). Il **n'enregistre que ce
que le daemon a prouvé** : une réponse à `GET /api/system` authentifiée par le
jeton du node *à la nouvelle adresse*, plus une bannière SSH au nouveau port
SFTP quand il change.

1. La nouvelle configuration est **poussée** au daemon, à l'ancienne adresse
   (`POST /api/update`, authentifié par le jeton du node).
2. Le panel **vérifie** à la nouvelle adresse :
   - le daemon y répond → enregistré (`applied`), que la poussée ait abouti
     ou non (un daemon déjà redémarré n'écoute plus à l'ancienne adresse) ;
   - il n'y répond pas, mais la poussée a abouti → `restart_required` : le
     fichier est écrit sur la machine, Wings attend son redémarrage. Rien
     n'est changé dans le panel ;
   - il n'y répond pas et la poussée a échoué → `refused` : rien n'est écrit,
     et le `config.yml` à déposer à la main est rendu (il porte le jeton en
     clair ; sa sortie est consignée comme `node.configuration_read`).

Deux allers-retours de quatre secondes au plus : l'interface abandonne une
action au bout de dix.

Chaque issue est tracée : `node.binding_changed`,
`node.binding_pending_restart`, `node.binding_refused`.

## Procédure

1. **Ouvrir la fiche du node**, section « Adresse et ports », saisir les
   nouvelles valeurs, valider.
2. **Lire l'issue** :
   - « Enregistré » : terminé (typiquement un simple changement de nom DNS).
   - « Wings doit redémarrer » : sur la machine, `systemctl restart wings`,
     puis **valider à nouveau la même modification**. La vérification constate
     que le daemon écoute à la nouvelle adresse et l'enregistre.
   - « Refusé » : le daemon n'a pas été joint, ou refuse les mises à jour du
     panel (`ignore_panel_config_updates`). Télécharger le fichier proposé, le
     déposer à la place de `/etc/pterodactyl/config.yml`, redémarrer Wings,
     puis valider à nouveau.
3. **Vérifier** : le node reste « En ligne », une console s'ouvre sur un de
   ses serveurs, et un client SFTP se connecte au nouveau port.

Entre le redémarrage de Wings et la seconde validation, le panel ne joint plus
le daemon (consoles, fichiers, sauvegardes). Le daemon, lui, joint toujours le
panel, et **les serveurs tournent**. Ne pas laisser traîner cette fenêtre.

## Si le node devient injoignable après un redémarrage de Wings

Cas typique : une modification est restée en « Wings doit redémarrer », puis
la machine a redémarré d'elle-même des jours plus tard. Wings écoute sur les
nouveaux ports, le panel appelle les anciens.

**Revalider la même modification** depuis la fiche du node. La vérification
à la nouvelle adresse la constate et l'enregistre : c'est précisément le cas
qu'elle couvre. Ne jamais
corriger en écrivant l'adresse en base à la main.

## Éprouver

Les tests `apps/api/src/modules/admin/node-edit.integration.test.ts` rejouent
les quatre issues contre un faux daemon qui, comme Wings, ne rouvre pas ses
ports sans redémarrage. Ils ne prouvent pas que le vrai Wings se comporte
ainsi : cela relève d'un banc `infra/local/`, sur Codiax, à écrire sur le
modèle de `verifier-rotation.sh`.
