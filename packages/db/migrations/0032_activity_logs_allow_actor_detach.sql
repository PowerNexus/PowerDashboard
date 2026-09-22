-- Le journal en ajout seul empêchait de supprimer un compte.
--
-- `activity_logs.actor_id` porte `on delete set null` : supprimer un compte
-- fait poser NULL par Postgres sur ses lignes de journal. Le déclencheur de la
-- migration 0025 refusait **tout** UPDATE, y compris celui-là. La suppression
-- échouait donc avec « activity_logs est en ajout seul : UPDATE refusé ».
--
-- Ce n'était pas un cas de bord : tout compte qui a fait quoi que ce soit a une
-- ligne de journal. La résiliation par le facturier
-- (`DELETE /api/v1/application/users/:id`) et la suppression depuis
-- l'administration étaient donc **cassées pour tout le monde** — et un panel
-- qui ne sait pas supprimer un compte ne sait pas honorer une demande
-- d'effacement.
--
-- Le correctif n'ouvre pas la porte : seul est admis l'UPDATE qui **détache un
-- acteur**, c'est-à-dire qui passe `actor_id` de renseigné à NULL sans toucher
-- à rien d'autre. La comparaison se fait sur la ligne entière, `actor_id` mis à
-- NULL des deux côtés : pas besoin d'énumérer les colonnes, et une colonne
-- ajoutée demain sera couverte d'office sans qu'on ait à y penser.
--
-- La ligne survit à son auteur, et c'est voulu : `actor_label` conserve
-- l'adresse employée au moment du geste. Le journal continue de dire ce qui
-- s'est passé quand le compte n'est plus là — c'est précisément ce qu'on lui
-- demande.
CREATE OR REPLACE FUNCTION activity_logs_append_only() RETURNS trigger AS $$
DECLARE
  detache activity_logs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('gamedashboard.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL THEN
    detache := OLD;
    detache.actor_id := NULL;
    IF NEW IS NOT DISTINCT FROM detache THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'activity_logs est en ajout seul : % refusé', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
