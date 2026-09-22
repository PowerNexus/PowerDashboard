-- Le journal d'audit ne se réécrit pas et ne s'efface pas depuis l'application.
--
-- Jusqu'ici la règle tenait par discipline : aucune route ne modifiait la
-- table. Un déclencheur la tient désormais côté base, où un accès SQL obtenu
-- par ailleurs ne peut plus faire disparaître une ligne. La seule exception
-- est la purge de rétention, qui s'annonce en posant le réglage de session
-- `gamedashboard.retention` à `on` dans sa transaction.
CREATE OR REPLACE FUNCTION activity_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('gamedashboard.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'activity_logs est en ajout seul : % refusé', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS activity_logs_append_only ON "activity_logs";
--> statement-breakpoint
CREATE TRIGGER activity_logs_append_only
  BEFORE UPDATE OR DELETE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION activity_logs_append_only();
