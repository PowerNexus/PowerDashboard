import { GoogleIcon, OAuthButton, OrDivider } from "@gamedashboard/ui";

/**
 * « Se connecter avec Google » (PLAN §12.4, décision 4).
 *
 * Une porte de plus au-dessus du formulaire, jamais à sa place : le mot de
 * passe reste possible. Un lien et non une action : `/auth/google/start`
 * envoie le navigateur chez Google, ce qu'une action serveur ne sait pas faire.
 */
export function GoogleSignIn({ label, separator }: { label: string; separator: string }) {
  return (
    <div className="mb-4 flex flex-col gap-4">
      <OAuthButton icon={<GoogleIcon />} href="/auth/google/start">
        {label}
      </OAuthButton>
      <OrDivider>{separator}</OrDivider>
    </div>
  );
}
