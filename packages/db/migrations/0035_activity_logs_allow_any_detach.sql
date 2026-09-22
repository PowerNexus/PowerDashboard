-- Le journal en ajout seul empêchait aussi de supprimer un **serveur**.
--
-- La migration 0032 a corrigé ce défaut pour les comptes, et s'est arrêtée là.
-- `activity_logs` porte pourtant deux références en `on delete set null` —
-- `actor_id` **et** `server_id` — et seule la première avait été admise.
-- Supprimer un serveur qui a fait l'objet du moindre geste échouait donc avec
-- « activity_logs est en ajout seul : UPDATE refusé ».
--
-- Ce n'est pas un cas de bord : un serveur consigne son installation, ses
-- démarrages, ses suspensions. En pratique **aucun serveur ne se supprimait**,
-- ni depuis l'administration, ni par la résiliation du facturier
-- (`DELETE /api/v1/application/servers/:id`) — c'est-à-dire que le panel
-- facturait des serveurs qu'il ne savait pas rendre.
--
-- Le correctif ne rattrape pas seulement `server_id` : il cesse d'énumérer les
-- colonnes une par une. Est admis l'UPDATE qui ne fait que **détacher des
-- références**, c'est-à-dire qui passe une ou plusieurs de ces colonnes de
-- renseignée à NULL sans toucher à rien d'autre. La comparaison porte sur la
-- ligne entière, ce qui rend le contrôle aussi strict qu'avant, et la prochaine
-- référence ajoutée à cette table sera couverte sans qu'on ait à y penser —
-- c'est exactement ce qui a manqué deux fois.
--
-- Une modification déguisée en détachement reste refusée : changer `server_id`
-- pour NULL **et** le libellé dans le même UPDATE échoue, parce que la ligne
-- comparée ne correspond plus.
--
-- Un UPDATE qui ne détache rien est refusé lui aussi, y compris s'il ne change
-- rien : en ajout seul, l'absence d'effet n'est pas une autorisation.
CREATE OR REPLACE FUNCTION activity_logs_append_only() RETURNS trigger AS $$
DECLARE
  detache activity_logs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('gamedashboard.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    detache := OLD;

    IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL THEN
      detache.actor_id := NULL;
    END IF;

    IF OLD.server_id IS NOT NULL AND NEW.server_id IS NULL THEN
      detache.server_id := NULL;
    END IF;

    IF detache IS DISTINCT FROM OLD AND NEW IS NOT DISTINCT FROM detache THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'activity_logs est en ajout seul : % refusé', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
