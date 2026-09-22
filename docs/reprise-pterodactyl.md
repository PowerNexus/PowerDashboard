# Reprendre un panel Pterodactyl

Ce panel remplace Pterodactyl sans remplacer **Wings**. Les daemons continuent
de tourner, les volumes restent où ils sont, et les identifiants de serveurs
sont conservés — c'est ce qui rend la bascule réversible et courte.

```bash
# 1. À blanc. Ne touche à rien, dit ce qu'il ferait.
pnpm --filter @gamedashboard/api import:pterodactyl \
  --source mysql://panel:MOTDEPASSE@10.0.0.5:3306/panel

# 2. Pour de vrai, une fois le bilan relu.
pnpm --filter @gamedashboard/api import:pterodactyl \
  --source mysql://panel:MOTDEPASSE@10.0.0.5:3306/panel --apply
```

Le script est **idempotent** : chaque objet est reconnu à une clé stable —
l'adresse d'un compte, l'identifiant d'un serveur, le couple (machine, port)
d'une allocation. On peut le relancer après avoir corrigé quelque chose sans
créer de doublon.

## L'ordre des opérations, le jour de la bascule

1. **Mettre les serveurs à l'arrêt**, ou accepter qu'ils tournent : la reprise
   ne les touche pas, mais un serveur démarré pendant l'opération sera connu
   des deux panels pendant quelques minutes.
2. **Lancer la reprise à blanc**, relire le bilan. Un serveur « ignoré » y est
   nommé avec sa raison.
3. **Lancer avec `--apply`.**
4. **Remplacer le `config.yml` de chaque machine**, depuis l'écran
   « Machines » du nouveau panel, puis redémarrer son daemon.
5. **Relire les scripts d'installation des eggs**, puis les activer.

L'étape 4 n'est pas facultative et ne peut pas être automatisée : voir plus
bas.

## Ce qui est repris

| | |
|---|---|
| Comptes | Adresse, nom, rôle, langue, **et mot de passe** |
| Localisations | |
| Machines | Nom, adresse, ports, mémoire, disque, surallocation, maintenance |
| Allocations | Adresse et port |
| Nids et eggs | Avec leurs variables, **désactivés** |
| Serveurs | Identifiant conservé, limites, commande, image, variables |
| Sous-utilisateurs | Avec leurs permissions, inchangées |
| Tâches planifiées | Avec leurs étapes, **sans échéance** |

## Ce qui n'est pas repris, et pourquoi

**Les clés d'API.** Leur préfixe et leur condensat ne se transposent pas, et
une clé qui survivrait à la bascule serait une clé que personne n'a revue.
Chaque intégration en recrée une.

**La double authentification.** Les secrets TOTP de Pterodactyl sont chiffrés
avec *sa* clé applicative. Nous ne l'avons pas, et un secret illisible vaut
moins qu'un secret absent : le compte serait verrouillé par un second facteur
que personne ne peut fournir. Les comptes concernés la réactivent en trente
secondes.

**Le jeton de chaque machine.** Même raison, avec une conséquence plus lourde :
la machine doit recevoir une nouvelle configuration. C'est l'étape 4, et le
script la rappelle à la fin.

**Les sauvegardes.** Elles vivent sur les nodes et dans le stockage objet, pas
en base. Wings les retrouve ; le panel les redécouvrira à la première lecture.

**Le journal d'activité.** C'est la trace d'audit du panel précédent. La
recopier la ferait passer pour la nôtre, et une trace d'audit dont on ne sait
plus qui l'a écrite ne vaut rien. L'ancien panel peut rester consultable le
temps voulu.

## Le mot de passe des comptes

Pterodactyl hache en **bcrypt**, ce panel en **Argon2id**. Les condensats sont
repris tels quels : le panel sait lire un bcrypt, le déclare périmé, et le
réécrit en Argon2id **à la première connexion réussie**. Personne n'a à changer
de mot de passe, et aucun bcrypt ne survit à son premier usage.

Les deux autres issues étaient pires. Refuser les condensats importés
obligerait tout le parc à passer par « mot de passe oublié » le jour de la
bascule — c'est-à-dire le jour où le support est déjà saturé. Migrer sans mot
de passe fermerait les comptes.

## Deux inversions à connaître

**Le tueur de mémoire.** Pterodactyl stocke `oom_disabled` : vrai veut dire que
le tueur est *désactivé*. Le panel stocke l'inverse. Recopier le booléen tel
quel aurait laissé des conteneurs dépasser leur limite sans jamais être
arrêtés — c'est-à-dire mettre en danger leurs voisins de machine.

**L'échéance des tâches planifiées.** Elle est laissée vide. Au moment de la
reprise, les daemons ne parlent pas encore au nouveau panel : une tâche qui
partirait échouerait, enverrait un avertissement au client et poserait son
drapeau de dérangement, pour une panne qui n'en est pas une. L'écran des tâches
recalcule l'échéance à la première modification, et « exécuter maintenant »
reste disponible.

## Le nombre de cœurs des machines

Pterodactyl ne le stocke pas : il raisonne en pourcentage de CPU par serveur.
Les machines reprises reçoivent donc **1 cœur**, valeur à corriger depuis
l'écran « Machines ». La deviner plus finement serait la deviner quand même, et
un chiffre inventé qui a l'air juste est pire qu'un chiffre visiblement faux.
