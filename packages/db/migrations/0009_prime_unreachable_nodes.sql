-- Ardoise vierge pour la veille des nodes.
--
-- `unreachable_since` vient d'apparaître : elle est nulle partout, y compris
-- sur les machines dont le daemon est éteint depuis des heures. Au premier
-- balayage, le veilleur les prendrait toutes pour des chutes à l'instant et
-- enverrait une alerte par node — une salve qui ne décrit rien de nouveau, au
-- moment précis où l'on branche l'intégration et où l'on a le moins besoin de
-- bruit.
--
-- On les déclare donc déjà signalées. La règle qui en découle vaut d'être
-- énoncée : un rappel dit ce qui **change**, pas ce qui est. L'état courant du
-- parc se lit sur `GET /api/v1/application/nodes`, qui est fait pour cela.
--
-- La valeur inscrite est le dernier heartbeat, pas `now()` : la panne a
-- commencé quand le node s'est tu. Le jour où il reparlera, `node.recovered`
-- annoncera une durée exacte plutôt qu'une durée comptée depuis ce déploiement.
--
-- Migration à effet unique : une fois la colonne renseignée, le veilleur
-- l'entretient seul, et elle survit aux redémarrages. Rien à rejouer.
UPDATE "nodes"
SET "unreachable_since" = "last_heartbeat_at"
WHERE "unreachable_since" IS NULL
  -- Un node jamais joint n'est pas tombé : son daemon n'a pas encore été
  -- installé. Le veilleur l'ignore pour la même raison, et le marquer ici
  -- inventerait une panne qui n'a pas eu lieu.
  AND "last_heartbeat_at" IS NOT NULL
  -- Le seuil de `NODE_HEARTBEAT_LOST_MS` (@gamedashboard/contracts), écrit ici en
  -- clair : une migration ne peut pas importer de TypeScript. Les deux valeurs
  -- doivent rester d'accord, et ce fichier ne s'exécutera qu'une fois.
  AND "last_heartbeat_at" < now() - interval '2 minutes';
