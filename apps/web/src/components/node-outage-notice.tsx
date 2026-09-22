import { AlertBanner, RelativeTime } from "@gamedashboard/ui";
import { getTranslations } from "next-intl/server";

/**
 * « La machine ne répond plus », dit une fois et à la bonne place.
 *
 * **Le problème qu'il résout.** Quand un node tombe, l'écran d'un serveur
 * affichait quatre signaux, dont aucun ne nommait la panne :
 *
 * - un badge « Hors ligne », qui *affirme* que le serveur est arrêté — alors
 *   qu'on n'en sait rien : la machine est muette, le conteneur tourne
 *   peut-être encore ;
 * - « Connexion interrompue — rechargez la page », un conseil qui ne peut pas
 *   marcher, puisque ce n'est pas la page qui a lâché ;
 * - un bandeau orange réclamant d'accepter le contrat de licence Minecraft,
 *   parce que la lecture de `eula.txt` avait échoué et qu'un échec de lecture
 *   était compté comme un refus ;
 * - la vraie cause — « le node n'a pas répondu » — en petits caractères
 *   rouges, **à l'intérieur** du bandeau qui parlait de licence.
 *
 * Quatre messages, trois faux, et le vrai caché dans l'un des trois. Celui-ci
 * les remplace : il dit ce qui se passe, ce que cela implique pour le serveur,
 * et ce qu'il y a à faire — c'est-à-dire, le plus souvent, rien.
 *
 * **Il ne demande pas au daemon.** L'information vient de la base, écrite par
 * la veille des nodes : interroger une machine muette pour savoir si elle est
 * muette ferait attendre l'écran le temps d'un délai d'attente, pour apprendre
 * ce qu'on savait déjà.
 */
export async function NodeOutageNotice({
  nodeName,
  since,
}: {
  nodeName: string;
  since: string | null;
}) {
  if (!since) return null;

  const t = await getTranslations("nodeOutage");

  return (
    <div className="mx-auto mb-6 w-full max-w-[1400px]">
      {/*
        `warning` et non `danger` : rien n'est perdu, et l'écarlate d'une
        suppression définitive banaliserait le rouge. C'est une gêne, souvent
        passagère, et le ton doit le dire.
      */}
      <AlertBanner variant="warning" title={t("title", { node: nodeName })}>
        <div className="flex flex-col gap-2">
          <p>{t("body")}</p>
          <p className="text-sm opacity-80">
            {t("since")} <RelativeTime value={since} />
          </p>
        </div>
      </AlertBanner>
    </div>
  );
}
