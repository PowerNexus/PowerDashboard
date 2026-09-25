import { settingsAnchor } from "@gamedashboard/contracts";
import { AlertBanner } from "@gamedashboard/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Ce qui manquerait à l'accueil tant que la facturation n'est pas reliée.
 *
 * Le bloc des services ne s'affiche pas sans HostBill, et c'est voulu — mais
 * l'absence est muette : l'exploitant qui découvre l'accueil ne peut pas
 * distinguer « rien à facturer » de « rien n'est branché ». Ce bandeau décrit
 * donc ce que la page **montrerait** une fois la facturation reliée, avec le
 * chemin pour le faire.
 *
 * **Réservé à qui peut y remédier**, c'est-à-dire aux administrateurs seuls.
 * Un client n'a aucune prise sur ce réglage : lui annoncer une fonction qu'il
 * ne peut pas activer ne fait que du bruit, et lui apprend au passage comment
 * la plateforme est configurée. Le support non plus — il voit l'espace
 * d'administration mais n'y écrit pas, et le lien l'enverrait vers un
 * formulaire qu'il ne peut pas enregistrer.
 *
 * Le composant ne décide pas lui-même : `show` lui est donné par la page, qui
 * connaît le rôle. Y refaire le test obligerait à lui passer l'utilisateur, et
 * à tenir deux endroits d'accord sur la même règle.
 */
export async function BillingSetupNotice({ show }: { show: boolean }) {
  if (!show) return null;

  const t = await getTranslations("quickAccess");

  return (
    <AlertBanner title={t("billingSetupTitle")}>
      <p>{t("billingSetupBody")}</p>
      <ul className="mt-2 ml-4 list-disc space-y-1">
        <li>{t("billingSetupItemServices")}</li>
        <li>{t("billingSetupItemDue")}</li>
        <li>{t("billingSetupItemLink")}</li>
      </ul>
      <p className="mt-3">
        <Link
          href={`/admin/settings#${settingsAnchor("billing")}`}
          className="inline-flex items-center gap-1.5 font-semibold text-sm"
        >
          {t("billingSetupAction")} <ArrowRight className="size-4" />
        </Link>
      </p>
    </AlertBanner>
  );
}
