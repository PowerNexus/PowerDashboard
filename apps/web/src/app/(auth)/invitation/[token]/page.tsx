import { AlertBanner, AuthCard, Badge, Button, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AcceptInvite, RegisterFromInvite } from "@/components/accept-invite";
import { pageTitle } from "@/lib/page-title";
import { fetchOptionalMe } from "@/server/api/client";
import { fetchInvite } from "@/server/api/invitations";

export const generateMetadata = pageTitle("invitation", "title");

/**
 * Le bout du lien reçu par courriel.
 *
 * **Rien n'est consommé au chargement**, contrairement à la confirmation
 * d'adresse : ce lien-ci accorde un pouvoir sur le serveur de quelqu'un
 * d'autre, et un antivirus de messagerie qui ouvre les liens l'accepterait à la
 * place du destinataire. Le clic explicite est la limite entre « j'ai lu ce
 * qu'on me propose » et « on a décidé pour moi ».
 *
 * Quatre situations, et l'écran ne montre que le geste qui convient :
 * la bonne personne est connectée et n'a qu'à accepter ; une **autre** personne
 * est connectée, et on le lui dit plutôt que d'échouer à l'acceptation ;
 * personne n'est connecté mais l'adresse a un compte ; ou il faut le créer.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getTranslations("invitation");
  const { token } = await params;
  const { invite, error } = await fetchInvite(token);

  // Une session absente n'est pas une erreur ici : c'est le cas ordinaire,
  // puisque la personne n'a le plus souvent pas encore de compte. D'où la
  // variante qui rend `null` au lieu de renvoyer vers la connexion.
  const me = await fetchOptionalMe();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard
        eyebrow={t("eyebrow")}
        title={invite ? t("titleFor", { server: invite.serverName }) : t("title")}
        description={invite ? t("description", { inviter: invite.invitedBy }) : undefined}
      >
        {error || !invite ? (
          <>
            <AlertBanner variant="danger" title={t("refused")}>
              {error}
            </AlertBanner>
            <Button className="mt-5" size="lg" fullWidth asChild>
              <Link href="/">{t("backHome")}</Link>
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("invitedAddress")}</dt>
                <dd className="gd-mono">{invite.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("rights")}</dt>
                <dd>
                  <Badge variant="neutral">
                    {t("rightsCount", { count: invite.permissions.length })}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("validUntil")}</dt>
                <dd>{new Date(invite.expiresAt).toLocaleDateString()}</dd>
              </div>
            </dl>

            {/* Le détail est replié mais présent : accepter sans pouvoir lire ce
                qu'on accepte reviendrait à demander une signature à l'aveugle. */}
            <details className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
              <summary className="cursor-pointer text-muted">{t("rightsDetail")}</summary>
              <ul className="gd-mono mt-2 flex flex-col gap-0.5">
                {invite.permissions.map((permission) => (
                  <li key={permission}>{permission}</li>
                ))}
              </ul>
            </details>

            {me === null && !invite.accountExists ? (
              /*
               * Le compte se crée **ici**, pas sur la page d'inscription.
               *
               * Le lien y menait, et ce lien mourait dès que l'exploitant
               * fermait les inscriptions — ce qui devient le réglage naturel
               * quand un système de facturation tient les comptes clients. Un
               * sous-utilisateur n'est pourtant pas un client : personne ne lui
               * vendra de serveur, il vient aider sur celui d'un autre.
               *
               * L'API prend l'adresse dans l'invitation, jamais dans le
               * formulaire : ce chemin ne peut donc créer qu'un compte
               * nominatif, à une adresse choisie par le propriétaire du
               * serveur, et seulement en détenant le secret envoyé à cette
               * boîte.
               */
              <RegisterFromInvite token={token} email={invite.email} />
            ) : me === null ? (
              <div className="flex flex-col gap-3">
                <AlertBanner variant="info" title={t("signInNeeded")}>
                  {t("signInExisting", { email: invite.email })}
                </AlertBanner>
                <Button size="lg" fullWidth asChild>
                  <Link href="/login">{t("goSignIn")}</Link>
                </Button>
                {/* Le lien reste dans la boîte de réception : on y revient
                    après s'être connecté, sans que le panel ait à transporter
                    un jeton d'invitation à travers la cérémonie de connexion. */}
                <p className="text-center text-muted text-xs">{t("returnHint")}</p>
              </div>
            ) : me.email.toLowerCase() !== invite.email.toLowerCase() ? (
              <AlertBanner variant="warning" title={t("wrongAccount")}>
                {t("wrongAccountBody", { connected: me.email, invited: invite.email })}
              </AlertBanner>
            ) : (
              <AcceptInvite token={token} />
            )}
          </div>
        )}
      </AuthCard>
    </div>
  );
}
