-- L'issue de la dernière exécution d'une tâche planifiée.
--
-- Jusqu'ici, une planification qui échouait le faisait en silence : la cause
-- partait dans le journal applicatif, que le client ne lit pas et ne peut pas
-- lire. Il continuait à croire que ses sauvegardes se faisaient — la pire
-- forme de panne pour un panel de jeu, puisqu'elle ne se découvre qu'au moment
-- où l'on avait besoin de la sauvegarde.
--
-- `last_run_failure` porte la cause, `null` valant « la dernière a réussi ».
-- `failure_notified_at` borne l'avertissement à un par dérangement : une tâche
-- horaire cassée enverrait sinon vingt-quatre messages par jour.
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "last_run_failure" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "failure_notified_at" timestamp with time zone;
