import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { decryptSecret, encryptSecret } from "@gamedashboard/auth";
import {
  applicationWebhooks,
  type Database,
  databaseHosts,
  databases,
  nodes,
  settings,
  userTotpCredentials,
  webhooks,
} from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser, seedWebhook } from "../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../test/throwaway-database";
import { REKEY_TARGETS, targetContext } from "./rekey";
import { type SecretColumn, secretContext } from "./row-secrets";

/**
 * `scripts/rekey-secrets.mts` tel que l'exploitant le lance, sur une vraie base.
 *
 * Le cœur (`rekey.ts`) a ses tests ; ici se vérifie ce qu'il ne voit pas : que
 * chaque table est lue et réécrite sous le contexte où l'API la relit, `jsonb`
 * des réglages compris, et que le bilan dit juste. Une erreur à cet endroit ne
 * se voit qu'à la bascule de clé, quand il est trop tard (audit ASVS, NC-18).
 */
const API = join(import.meta.dirname, "..", "..");
const SEL = "gamedashboard.secrets.v2";
const CLE = "cle-maitre-de-test-du-script-de-reprise-01";
const NOUVELLE = "nouvelle-cle-maitre-de-test-du-script-02";

describe.skipIf(!HAS_DATABASE)("scripts/rekey-secrets.mts (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let url: string;
  /** Chaque valeur chiffrée semée : sa colonne, sa ligne, son clair. */
  const semis: { colonne: SecretColumn; ligne: string; clair: string }[] = [];
  let recopiee: { ligne: string; valeur: string };

  function lancer(env: Record<string, string>): string {
    return execFileSync(join(API, "node_modules", ".bin", "tsx"), ["scripts/rekey-secrets.mts"], {
      cwd: API,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url, FROM_SALT: SEL, ...env },
    });
  }

  /** La valeur stockée de chaque ligne semée, lue comme le script la lit. */
  async function stockees(): Promise<Map<string, string>> {
    const valeurs = new Map<string, string>();
    for (const cible of REKEY_TARGETS) {
      const rows = (await db.execute(
        sql.raw(
          `select "${cible.key}" as k, ${cible.read ?? `"${cible.column}"`} as v from "${cible.table}"`,
        ),
      )) as unknown as { k: string; v: string }[];
      for (const row of rows) valeurs.set(targetContext(cible, String(row.k)), row.v);
    }
    return valeurs;
  }

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    const base = new URL(process.env.DATABASE_URL as string);
    base.pathname = `/${throwaway.name}`;
    url = base.toString();

    /*
     * Une ligne par colonne chiffrée, écrite **avant la liaison** : sans
     * contexte, au format `v3:` — ou sans préfixe pour le mot de passe d'hôte,
     * la forme la plus ancienne.
     */
    const cle = { APP_SECRET_KEY: CLE };
    const v3 = (clair: string) => encryptSecret(clair, cle);
    const owner = await seedUser(db);
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    const serverId = await seedServer(db, { nodeId, ownerId: owner });

    await db
      .update(nodes)
      .set({ daemonTokenEnc: v3("jeton-du-node") })
      .where(eq(nodes.id, nodeId));
    semis.push({ colonne: "nodes.daemon_token_enc", ligne: nodeId, clair: "jeton-du-node" });

    const [hote] = await db
      .insert(databaseHosts)
      .values({
        name: "hote",
        host: "hote.mysql.test",
        username: "gamedashboard",
        passwordEnc: v3("mdp-hote").slice("v3:".length),
      })
      .returning({ id: databaseHosts.id });
    semis.push({
      colonne: "database_hosts.password_enc",
      ligne: hote?.id as string,
      clair: "mdp-hote",
    });

    const [base_] = await db
      .insert(databases)
      .values({
        serverId,
        databaseHostId: hote?.id as string,
        name: "s_base",
        username: "u_base",
        passwordEnc: v3("mdp-base"),
      })
      .returning({ id: databases.id });
    semis.push({
      colonne: "databases.password_enc",
      ligne: base_?.id as string,
      clair: "mdp-base",
    });

    const [totp] = await db
      .insert(userTotpCredentials)
      .values({ userId: owner, secretEnc: v3("SECRETTOTP") })
      .returning({ id: userTotpCredentials.id });
    semis.push({
      colonne: "user_credentials_totp.secret_enc",
      ligne: totp?.id as string,
      clair: "SECRETTOTP",
    });

    const [rappel] = await db
      .insert(webhooks)
      .values({ ownerId: owner, serverId, url: "https://1.1.1.1/r", secretEnc: v3("hmac-client") })
      .returning({ id: webhooks.id });
    semis.push({
      colonne: "webhooks.secret_enc",
      ligne: rappel?.id as string,
      clair: "hmac-client",
    });

    const applicatif = await seedWebhook(db, { events: ["server.created"] });
    await db
      .update(applicationWebhooks)
      .set({ secretEnc: v3("hmac-boutique") })
      .where(eq(applicationWebhooks.id, applicatif));
    semis.push({
      colonne: "application_webhooks.secret_enc",
      ligne: applicatif,
      clair: "hmac-boutique",
    });

    await db
      .insert(settings)
      .values({ key: "smtp.password", value: v3("mdp-smtp"), isSecret: true });
    semis.push({ colonne: "settings.value", ligne: "smtp.password", clair: "mdp-smtp" });

    /*
     * Et une valeur déjà liée, mais **à une autre ligne** : recopiée ici par
     * qui écrit en base. Elle ne doit être ni reprise, ni blanchie.
     */
    const autreSecret = encryptSecret(
      "secret-d-un-autre",
      cle,
      secretContext("settings.value", "billing.apiKey"),
    );
    await db
      .insert(settings)
      .values({ key: "google.clientSecret", value: autreSecret, isSecret: true });
    recopiee = { ligne: "settings.value:google.clientSecret", valeur: autreSecret };
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  it("lie chaque valeur à sa ligne, à clé constante, sans toucher une valeur recopiée", async () => {
    const sortie = lancer({ APP_SECRET_KEY: CLE });

    expect(sortie).toContain(
      `${semis.length} secret(s) rechiffré(s), 0 déjà à jour, 1 illisible(s)`,
    );
    const valeurs = await stockees();
    for (const { colonne, ligne, clair } of semis) {
      const valeur = valeurs.get(secretContext(colonne, ligne)) as string;
      expect(valeur.startsWith("v4:"), colonne).toBe(true);
      // Relue comme l'API la relit : sous le contexte de sa ligne.
      expect(decryptSecret(valeur, { APP_SECRET_KEY: CLE }, secretContext(colonne, ligne))).toBe(
        clair,
      );
    }
    expect(valeurs.get(recopiee.ligne)).toBe(recopiee.valeur);
  });

  it("relancée, ne réécrit rien", async () => {
    const avant = await stockees();

    expect(lancer({ APP_SECRET_KEY: CLE })).toContain(
      `0 secret(s) rechiffré(s), ${semis.length} déjà à jour, 1 illisible(s)`,
    );
    expect(await stockees()).toEqual(avant);
  });

  it("fait tourner la clé maître sans rien perdre, contexte compris", async () => {
    const sortie = lancer({ APP_SECRET_KEY_OLD: CLE, APP_SECRET_KEY: NOUVELLE });

    expect(sortie).toContain(
      `${semis.length} secret(s) rechiffré(s), 0 déjà à jour, 1 illisible(s)`,
    );
    const valeurs = await stockees();
    for (const { colonne, ligne, clair } of semis) {
      const contexte = secretContext(colonne, ligne);
      const valeur = valeurs.get(contexte) as string;
      expect(decryptSecret(valeur, { APP_SECRET_KEY: NOUVELLE }, contexte)).toBe(clair);
      expect(() => decryptSecret(valeur, { APP_SECRET_KEY: CLE }, contexte)).toThrow();
    }
    expect(valeurs.get(recopiee.ligne)).toBe(recopiee.valeur);

    // Relancer la rotation une fois faite ne fait plus rien.
    expect(lancer({ APP_SECRET_KEY_OLD: CLE, APP_SECRET_KEY: NOUVELLE })).toContain(
      `0 secret(s) rechiffré(s), ${semis.length} déjà à jour`,
    );
  });
});
