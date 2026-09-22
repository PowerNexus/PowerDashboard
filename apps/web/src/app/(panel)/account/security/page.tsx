import { SecurityWorkspace } from "@/components/security-workspace";
import { pageTitle } from "@/lib/page-title";
import { listPasskeys } from "@/server/api/passkeys";
import { listSessions } from "@/server/api/sessions";
import { listSshKeys } from "@/server/api/ssh-keys";
import { fetchTwoFactorStatus } from "@/server/api/two-factor";

export const generateMetadata = pageTitle("security", "title");

export default async function SecurityPage() {
  // Les quatre lectures sont indépendantes : les enchaîner ferait attendre la
  // page quatre fois pour rien.
  const [sessions, twoFactor, passkeys, sshKeys] = await Promise.all([
    listSessions(),
    fetchTwoFactorStatus(),
    listPasskeys(),
    listSshKeys(),
  ]);

  return (
    <SecurityWorkspace
      initial={sessions}
      twoFactor={twoFactor}
      passkeys={passkeys}
      sshKeys={sshKeys}
    />
  );
}
