import { createHmac, randomUUID } from "node:crypto";

import { BOUTON_CONNEXION, COMPTE, expect, fermerAvertissement, test } from "./fixtures";

/**
 * L'arrivée d'un client par le lien de sa facturation : `/sso/<jeton>`.
 *
 * C'est le chemin d'entrée **ordinaire** des clients quand un facturier tient
 * les comptes : ils n'ont pas de mot de passe ici. Aucun test ne le jouait dans
 * un navigateur, et il était cassé sans que personne le voie. Le jeton était
 * consommé au rendu de la page, où Next refuse toute écriture de cookie
 * (`ReadonlyRequestCookiesError`) : l'API ouvrait la session, la page levait en
 * voulant la poser, et le client voyait la page d'erreur au lieu de son panel.
 * Un test unitaire ne pouvait pas le voir : il appelle le code hors du serveur
 * de Next, où rien n'interdit d'écrire un cookie. Seul le serveur construit
 * applique la règle.
 *
 * Il attrape aussi une redirection bâtie sur l'adresse d'écoute de Next plutôt
 * que sur l'hôte demandé : l'interface est servie ici sur `127.0.0.1` alors que
 * Next se croit sur `localhost`, comme derrière nginx. Le client repartait
 * ailleurs que là où son cookie de session venait d'être posé.
 *
 * Le lien est demandé comme le fait le plugin du facturier : par l'API
 * applicative, avec une clé. La clé et le client sont préparés par l'API
 * d'administration, qu'il faut joindre directement puisque nginx ne l'expose
 * pas. Contre une installation existante (`E2E_BASE_URL`), `E2E_API_URL` la
 * désigne ; sans elle, ces tests sont sautés.
 */
const API =
  process.env.E2E_API_URL ??
  (process.env.E2E_BASE_URL ? null : `http://127.0.0.1:${process.env.E2E_API_PORT ?? 3401}`);

/**
 * Un appel à l'API, avec le `fetch` de Node plutôt que celui de Playwright.
 *
 * Aucun bocal à cookies : chaque appel dit lui-même qui il est, session de
 * l'administrateur ou clé applicative, et rien ne passe de l'un à l'autre
 * sans qu'on l'ait écrit.
 */
function api(
  chemin: string,
  options: { methode?: string; session?: string; cle?: string; corps?: unknown } = {},
): Promise<Response> {
  const { methode, session, cle, corps } = options;
  return fetch(`${API}${chemin}`, {
    method: methode ?? (corps === undefined ? "GET" : "POST"),
    headers: {
      ...(corps === undefined ? {} : { "content-type": "application/json" }),
      ...(session ? { cookie: session } : {}),
      ...(cle ? { authorization: `Bearer ${cle}` } : {}),
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
}

/** Le champ `data` d'une réponse, ou une erreur qui dit ce que l'API a refusé. */
async function donnees<T>(reponse: Response): Promise<T> {
  if (!reponse.ok) throw new Error(`${reponse.url} : ${reponse.status} ${await reponse.text()}`);
  return ((await reponse.json()) as { data: T }).data;
}

/** Le cookie de session posé par une réponse, prêt à renvoyer (`nom=valeur`). */
function sessionDe(reponse: Response): string {
  const pose = reponse.headers.getSetCookie().find((cookie) => /gd_session=/.test(cookie));
  if (!pose) throw new Error(`${reponse.url} n'a ouvert aucune session (${reponse.status}).`);
  return pose.split(";")[0] ?? "";
}

/**
 * Code TOTP d'un pas donné (RFC 6238 : SHA-1, trente secondes, six chiffres).
 *
 * Réécrit ici plutôt qu'importé de `@gamedashboard/auth`, dont l'interface ne
 * dépend pas : c'est ce que ferait l'application du téléphone.
 */
function codeTotp(secret: string, pas: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const lettre of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(lettre).toString(2).padStart(5, "0");
  }
  const cle = Buffer.from((bits.match(/.{8}/g) ?? []).map((octet) => Number.parseInt(octet, 2)));

  const compteur = Buffer.alloc(8);
  compteur.writeUInt32BE(Math.floor(pas / 2 ** 32), 0);
  compteur.writeUInt32BE(pas >>> 0, 4);
  const condensat = createHmac("sha1", cle).update(compteur).digest();
  const decalage = (condensat.at(-1) ?? 0) & 0x0f;
  return ((condensat.readUInt32BE(decalage) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

interface Facturier {
  /** Crée un client, comme le plugin le fait à la commande. */
  client(): Promise<string>;
  /** Un lien de connexion pour ce client, réduit à son chemin (`/sso/<jeton>`). */
  lien(clientId: string): Promise<string>;
}

const it = test.extend<{ facturier: Facturier }>({
  facturier: async ({ baseURL }, use) => {
    const admin = sessionDe(
      await api("/api/v1/auth/login", {
        corps: { email: COMPTE.email, password: COMPTE.password, captchaToken: "" },
      }),
    );
    const { key, plaintext } = await donnees<{ key: { id: string }; plaintext: string }>(
      await api("/api/v1/admin/application-keys", {
        session: admin,
        corps: {
          name: `e2e facturation ${randomUUID()}`,
          scopes: ["users.write", "users.sso", "users.delete"],
        },
      }),
    );
    const clients: string[] = [];

    try {
      await use({
        client: async () => {
          const { id } = await donnees<{ id: string }>(
            await api("/api/v1/application/users", {
              cle: plaintext,
              corps: {
                email: `client-${randomUUID()}@gamedashboard.test`,
                nameFirst: "Client",
                nameLast: "Facturation",
              },
            }),
          );
          clients.push(id);
          return id;
        },

        lien: async (clientId) => {
          const demander = () =>
            api("/api/v1/application/users/sso-link", {
              cle: plaintext,
              corps: { userId: clientId },
            });

          let reponse = await demander();
          /*
           * Sans domaine de plateforme, l'API refuse de fabriquer un lien (503) :
           * il ne saurait pas où envoyer le client. Une base neuve n'en a pas ;
           * on lui donne celui qu'on sert. Le lien n'est suivi que par son
           * chemin, contre l'installation éprouvée, quel que soit ce domaine.
           */
          if (reponse.status === 503) {
            await donnees(
              await api("/api/v1/admin/settings", {
                session: admin,
                corps: { values: { "brand.domain": new URL(baseURL ?? "").host } },
              }),
            );
            reponse = await demander();
          }
          const { url } = await donnees<{ url: string }>(reponse);
          return new URL(url).pathname;
        },
      });
    } finally {
      // Les clients partent avec le test : l'écran d'administration compte les
      // comptes, et la suite visuelle le capture.
      for (const id of clients) {
        await api(`/api/v1/application/users/${id}`, { methode: "DELETE", cle: plaintext });
      }
      await api(`/api/v1/admin/application-keys/${key.id}`, { methode: "DELETE", session: admin });
      await api("/api/v1/auth/logout", { methode: "POST", session: admin });
    }
  },
});

/** L'accueil du panel, quelle que soit l'origine servie. */
const accueil = (url: URL) => url.pathname === "/";

it.describe("lien de connexion de la facturation", () => {
  it.skip(API === null, "API d'administration injoignable : renseigner E2E_API_URL.");

  it("un client sans second facteur arrive connecté sur l'accueil", async ({ page, facturier }) => {
    const client = await facturier.client();

    await page.goto(await facturier.lien(client));
    await fermerAvertissement(page);

    await expect(page).toHaveURL(accueil, { timeout: 15_000 });
    await expect(page.getByRole("main")).toBeVisible();
  });

  it("un compte protégé reprend à la seconde étape, sans défi dans l'adresse", async ({
    page,
    facturier,
  }) => {
    const client = await facturier.client();

    // Le client active son second facteur. Il lui faut une session : celle
    // d'un premier lien, consommé auprès de l'API tant que le compte n'exige
    // encore rien.
    const jeton = (await facturier.lien(client)).split("/").at(-1);
    const session = sessionDe(
      await api("/api/v1/auth/billing/consume", { corps: { token: jeton } }),
    );
    const { secret } = await donnees<{ secret: string }>(
      await api("/api/v1/auth/2fa/setup", { session, corps: {} }),
    );
    const pas = Math.floor(Date.now() / 30_000);
    await donnees(
      await api("/api/v1/auth/2fa/enable", { session, corps: { code: codeTotp(secret, pas) } }),
    );

    const arrivee = await page.goto(await facturier.lien(client));
    await fermerAvertissement(page);

    const code = page.locator('input[name="code"]');
    await expect(code).toBeVisible({ timeout: 15_000 });

    /*
     * Le défi voyage par un cookie et le champ caché du formulaire, jamais par
     * une adresse : elle finit dans l'historique, les journaux et le Referer.
     * Toutes celles du trajet sont relues, redirections comprises.
     */
    const defi = await page.locator('input[name="challenge"]').inputValue();
    expect(defi).not.toBe("");
    for (let etape = arrivee?.request() ?? null; etape; etape = etape.redirectedFrom()) {
      expect(decodeURIComponent(etape.url())).not.toContain(defi);
    }
    expect(decodeURIComponent(page.url())).not.toContain(defi);

    // Le pas suivant : celui de l'activation est déjà consommé (anti-rejeu),
    // et la fenêtre de tolérance accepte le suivant.
    await code.fill(codeTotp(secret, pas + 1));
    await page.locator(BOUTON_CONNEXION).click();

    await expect(page).toHaveURL(accueil, { timeout: 15_000 });
    await expect(page.getByRole("main")).toBeVisible();
  });

  it("un lien déjà employé dit de repartir de l'espace client", async ({ page, facturier }) => {
    const lien = await facturier.lien(await facturier.client());

    await page.goto(lien);
    await expect(page).toHaveURL(accueil, { timeout: 15_000 });

    // Le même lien, une seconde fois, par un navigateur qui n'a plus de session.
    await page.context().clearCookies();
    await page.goto(lien);
    await fermerAvertissement(page);

    await expect(page.getByText(/lien de connexion expiré|sign-in link expired/i)).toBeVisible();
    await expect(page.getByText(/espace client|client area/i)).toBeVisible();
  });
});
