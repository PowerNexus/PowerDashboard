-- Les réglages de facturation cessent de nommer un fournisseur.
--
-- `hostbill.*` devient `billing.*`. Le panel sait désormais travailler avec
-- HostBill, WHMCS ou ClientXCMS — le plugin diffère, pas le panel — et garder
-- le nom du premier dans les clés aurait obligé un exploitant WHMCS à
-- renseigner des champs « hostbill ».
--
-- Les valeurs sont **déplacées**, pas recopiées : deux clés portant la même
-- chose se contrediraient au premier changement, et c'est toujours celle qu'on
-- ne regarde pas qui reste juste.
--
-- `billing.apiKey` transporte un secret chiffré. Il n'est pas déchiffré ici :
-- le chiffrement ne dépend pas du nom de la clé, seulement du sel de la
-- plateforme. Renommer la ligne suffit, et la valeur reste lisible.
--
-- Le `DO` protège le rejeu et le cas où les deux clés coexisteraient déjà :
-- l'ancienne est alors simplement supprimée, la nouvelle faisant foi.
DO $$
DECLARE
  ancienne text;
  nouvelle text;
BEGIN
  FOREACH ancienne IN ARRAY ARRAY[
    'hostbill.apiUrl', 'hostbill.apiId', 'hostbill.apiKey', 'hostbill.clientUrl'
  ] LOOP
    nouvelle := 'billing.' || split_part(ancienne, '.', 2);

    IF EXISTS (SELECT 1 FROM settings WHERE key = nouvelle) THEN
      DELETE FROM settings WHERE key = ancienne;
    ELSE
      UPDATE settings SET key = nouvelle WHERE key = ancienne;
    END IF;
  END LOOP;
END $$;
