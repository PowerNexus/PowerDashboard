# @gamedashboard/auth

Primitives d'authentification (§5.1 du plan). Sans dépendance à un framework
HTTP : ce paquet contient les décisions, pas leur exposition. C'est ce qui
permet de les tester sérieusement, et c'est là que le moindre défaut est une
vulnérabilité plutôt qu'un bogue.

| Module | Contenu |
|---|---|
| `password` | Argon2id, vérification, `needsRehash` |
| `policy` | Longueur, identité dans le mot de passe, fuites via HaveIBeenPwned |
| `tokens` | Jetons de session, clés d'API, comparaison à durée constante |
| `throttle` | Limitation des tentatives, délai progressif, alerte au propriétaire |

## Quelques choix, et leurs raisons

**Argon2id, pas bcrypt.** bcrypt tronque silencieusement au-delà de 72 octets :
deux mots de passe longs différents y deviennent équivalents, et la connexion
réussit avec le mauvais. Un test le vérifie explicitement.

**Pas de classes de caractères imposées.** Exiger une majuscule, un chiffre et
un symbole produit surtout des « Motdepasse1! » : prévisibles pour un
attaquant, pénibles pour tout le monde. La longueur et la vérification des
fuites protègent davantage. En revanche, un mot de passe contenant l'e-mail ou
le nom est refusé — c'est la première chose qu'un attaquant essaie.

**Le mot de passe ne quitte jamais le serveur.** La vérification HIBP se fait en
k-anonymat : seuls les cinq premiers caractères de l'empreinte SHA-1 sont
transmis. Un test s'assure que le suffixe ne part pas.

**Une panne de HIBP ne bloque pas l'inscription.** Refuser un mot de passe
valide parce qu'un service tiers est indisponible pénalise l'utilisateur sans
rien protéger. L'appelant reçoit `pwnedCheckFailed` et peut le journaliser.

**Jetons opaques, pas JWT.** Un JWT en cookie ne peut pas être révoqué avant son
expiration. Un identifiant aléatoire adossé à une ligne en base se révoque
immédiatement — la seule chose qui compte quand un appareil est perdu.

**SHA-256 sans étirement pour les jetons.** Contrairement aux mots de passe :
256 bits d'aléa ne se devinent pas par force brute, donc le coût de calcul ne
protégerait rien et rendrait chaque requête authentifiée coûteuse, ce qui ouvre
un déni de service.

**Limitation sur deux axes.** Par compte seul, n'importe qui peut verrouiller
n'importe quel utilisateur en échouant volontairement. Par IP seule, une attaque
répartie passe inaperçue. La décision la plus restrictive des deux s'applique,
et le seuil par IP est plus haut — un bureau partage une adresse publique.
