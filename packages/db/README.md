# @gamedashboard/db

Schéma PostgreSQL du panel (§6 de `PLAN.md`), en Drizzle.

## Migrations

Le dossier `migrations/` est **généré** par drizzle-kit et validé tel quel :
il est exclu du formatage Biome, sans quoi chaque passage du formateur le ferait
diverger du générateur et la vérification de CI échouerait indéfiniment.

```bash
pnpm --filter @gamedashboard/db db:generate   # après toute modification du schéma
pnpm --filter @gamedashboard/db db:migrate    # applique, exige DATABASE_URL
```

La CI régénère et compare : une colonne ajoutée au schéma sans migration fait
échouer le build, plutôt que de se découvrir au déploiement face à une base qui
ne la possède pas.

## Deux règles que le schéma applique

**L'état du conteneur n'est pas stocké.** `servers.state` n'accepte que les
états de gestion (`installing`, `suspended`…). `offline`, `starting`, `running`
et `stopping` appartiennent à Wings et sont rapportés en direct ; les dupliquer
créerait une seconde vérité qui finirait par mentir. `enums.test.ts` empêche
cette liste de dériver.

**Une mesure absente n'est pas zéro.** `server_metrics.players` est nullable :
une sonde qui n'a pas abouti se dit `null`, pas « zéro joueur ».
