import { SecurityWorkspace } from "@/components/security-workspace";
import { pageTitle } from "@/lib/page-title";
import { listPasskeys } from "@/server/api/passkeys";
import { listSessions } from "@/server/api/sessions";
import { listSshKeys } from "@/server/api/ssh-keys";
import { fetchTwoFactorStatus } from "@/server/api/two-factor";

export const generateMetadata = pageTitle("security", "title");

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>;
}) {
  // Les lectures sont indépendantes : les enchaîner ferait attendre la page
  // autant de fois pour rien.
  const [sessions, twoFactor, passkeys, sshKeys, search] = await Promise.all([
    listSessions(),
    fetchTwoFactorStatus(),
    listPasskeys(),
    listSshKeys(),
    searchParams,
  ]);

  return (
    <SecurityWorkspace
      initial={sessions}
      twoFactor={twoFactor}
      passkeys={passkeys}
      sshKeys={sshKeys}
      // Posé par la connexion quand le mot de passe est provisoire.
      provisionalPassword={search.password === "provisional"}
    />
  );
}
