# Essais de charge

```bash
k6 run infra/load/lecture.js  -e BASE=https://panel.example
k6 run infra/load/console.js  -e BASE=https://panel.example -e NODE=wings.example:8080
```

**Ils ne tournent pas en intégration continue**, et c'est délibéré. Un essai de
charge sur une machine partagée mesure la machine, pas le panel : les chiffres
varieraient d'un passage à l'autre sans que rien n'ait changé, et un seuil posé
là-dessus finirait par être relevé jusqu'à ne plus rien dire. On les lance
avant une mise en service, contre l'installation qu'on s'apprête à servir.

## Ce que chacun mesure

**`lecture.js`** — la surface que tout le monde touche : l'état, la marque, la
liste des serveurs. C'est ce qui est demandé à chaque ouverture de page, donc
ce qui se dégrade en premier quand la base peine.

**`console.js`** — les websockets de console, tenus ouverts. Le panel n'en
relaie aucun octet : il ne fait qu'émettre les jetons, et c'est **cela** que
l'essai charge. Le flux lui-même va du navigateur au daemon, et le charger
mesurerait le daemon.

## Les seuils, et pourquoi ceux-là

| Mesure | Seuil | Raison |
|---|---|---|
| `http_req_duration` p95 | < 500 ms | Au-delà, une page composée de trois appels dépasse la seconde et se ressent |
| `http_req_failed` | < 1 % | Une erreur sur cent est déjà visible en support |
| Jetons de console | 200/s | Un incident fait recharger la console à tout le monde en même temps |

Les valeurs du plan — 500 consoles simultanées, 1 000 requêtes par seconde —
sont des objectifs de dimensionnement, pas des seuils d'échec. Les inscrire
comme seuils ferait échouer l'essai sur un poste de développement, ce qui
n'apprendrait rien.
