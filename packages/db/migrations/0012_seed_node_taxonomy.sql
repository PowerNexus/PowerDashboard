-- Reprise de la taxonomie qui vivait en dur dans l'interface.
--
-- Elle était déclarée dans `apps/web/src/config/node-taxonomy.ts`, avec la
-- mention qu'elle irait en base le jour où l'administration saurait la
-- modifier. Ce jour-ci. La recopier plutôt que de partir d'une table vide
-- évite que les nodes déjà rangés se retrouvent tous « Non classé » au premier
-- chargement : leurs colonnes `category` et `subcategory` portent ces
-- identifiants-là.
--
-- `on conflict do nothing` : la migration doit pouvoir passer sur une base où
-- un administrateur aurait déjà créé la catégorie « game » à la main.

insert into "node_categories" ("id", "name", "description", "position") values
  ('game',     'Serveurs de jeu', 'Machines exposées aux clients.', 0),
  ('reseller', 'Revendeurs',      'Parc dédié aux revendeurs.',     1),
  ('internal', 'Interne',         'Build, tests et outillage.',     2)
on conflict ("id") do nothing;
--> statement-breakpoint

insert into "node_subcategories" ("id", "category_id", "name", "position") values
  ('game-gra',     'game',     'Gravelines',            0),
  ('game-rbx',     'game',     'Roubaix',               1),
  ('game-sbg',     'game',     'Strasbourg',            2),
  ('game-waw',     'game',     'Varsovie',              3),
  ('reseller-gra', 'reseller', 'Gravelines',            0),
  ('reseller-rbx', 'reseller', 'Roubaix',               1),
  ('internal-ci',  'internal', 'Intégration continue',  0),
  ('internal-lab', 'internal', 'Laboratoire',           1)
on conflict ("id") do nothing;
