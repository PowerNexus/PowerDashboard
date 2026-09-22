"use client";

import { WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  type ColumnDef,
  DataTable,
  KeyValueGrid,
  MethodBadge,
  PageHeader,
  PageTemplate,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@gamedashboard/ui";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Globe,
  Key,
  Plug,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { ApplicationKeys } from "@/components/application-keys";
import { PlatformWebhooks } from "@/components/platform-webhooks";
import {
  APPLICATION_ROUTES,
  type ApiRoute,
  CLIENT_ROUTES,
  REALTIME_EVENTS,
  SESSION_ROUTES,
} from "@/lib/api-reference";
import {
  type ApplicationKey,
  createApplicationKey,
  revokeApplicationKey,
} from "@/server/api/application-keys";
import {
  createWebhook,
  deleteWebhook,
  type PlatformWebhook,
  rotateWebhookSecret,
  setWebhookActive,
  type WebhookDelivery,
} from "@/server/api/webhooks";

export function ApiReference({
  origin,
  keys,
  webhooks,
  deliveries,
}: {
  origin: string;
  keys: ApplicationKey[];
  webhooks: PlatformWebhook[];
  deliveries: WebhookDelivery[];
}) {
  const t = useTranslations("apiReference");

  const baseClient = `${origin}/api/v1/client`;
  const baseApplication = `${origin}/api/v1/application`;
  // Le gateway partage l'origine du panel : wss:// sur un panel en https,
  // ws:// sur un panel servi en clair, sinon l'exemple ne se connecterait pas.
  const websocket = `${origin.replace(/^http/, "ws")}/ws`;

  const routeColumns = useMemo(
    () =>
      (baseUrl: string): ColumnDef<ApiRoute, unknown>[] => [
        {
          accessorKey: "path",
          header: t("columnRoute"),
          cell: ({ row }) => (
            <div className="flex min-w-0 items-start gap-3">
              <MethodBadge method={row.original.method} />
              <div className="min-w-0">
                <p className="gd-mono truncate text-sm text-fg">{row.original.path}</p>
                <p className="truncate text-xs text-muted">{row.original.summary}</p>
              </div>
            </div>
          ),
        },
        {
          accessorKey: "group",
          header: t("columnGroup"),
          cell: ({ getValue }) => <span className="text-muted">{getValue() as string}</span>,
        },
        {
          accessorKey: "scope",
          header: t("columnScope"),
          cell: ({ getValue }) => {
            const scope = getValue() as string | null;
            return scope ? (
              <Badge variant="accent">
                <span className="gd-mono">{scope}</span>
              </Badge>
            ) : (
              <span className="text-faint">{t("noScope")}</span>
            );
          },
        },
        {
          id: "base",
          header: t("columnBase"),
          cell: () => <span className="gd-mono text-xs text-faint">{baseUrl}</span>,
        },
      ],
    [t],
  );

  const clientColumns = useMemo(() => routeColumns(baseClient), [routeColumns, baseClient]);
  const applicationColumns = useMemo(
    () => routeColumns(baseApplication),
    [routeColumns, baseApplication],
  );
  // Les routes de session vivent sous l'origine du panel, sans préfixe de
  // version cliente : leur colonne « Base » doit le dire.
  const sessionColumns = useMemo(() => routeColumns(`${origin}/api/v1`), [routeColumns, origin]);

  const curlExample = `curl -X POST "${baseClient}/servers/31201e0c/power" \\
  -H "Authorization: Bearer gd_live_8Kq2..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 7f3c1a90-restart-nightly" \\
  -d '{"signal":"restart"}'`;

  /**
   * Vérification d'un rappel, du point de vue du receveur.
   *
   * Écrit en entier plutôt que résumé en prose : c'est le code que
   * l'intégrateur va recopier, et la moitié des intégrations de webhooks se
   * trompent exactement sur les trois points qu'il contient — comparer le corps
   * **brut** et non l'objet reparsé, comparer à temps constant, et refuser un
   * horodatage trop vieux.
   */
  const verifyExample = `import { createHmac, timingSafeEqual } from "node:crypto";

// Le corps BRUT, avant tout JSON.parse : re-sérialiser change les espaces,
// et la signature ne correspondrait plus.
export function verifyGameDashboardWebhook(rawBody, signatureHeader, secret) {
  const parts = new Map(
    signatureHeader.split(",").map((c) => c.trim().split("=")),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return false;

  // Au-delà de ${WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS} s, on refuse : une livraison captée ne doit pas
  // rester rejouable indéfiniment.
  if (Math.abs(Date.now() / 1000 - t) > ${WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS}) return false;

  const expected = createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  // Comparaison à durée constante : un === fuite la signature attendue.
  return a.length === b.length && timingSafeEqual(a, b);
}`;

  const ssoRedirectUri = `${origin}/auth/sso/callback`;

  /**
   * Ce que le fournisseur doit servir pour que le panel sache s'y brancher.
   *
   * Écrit du point de vue de celui qui configure le fournisseur, et non du
   * panel : c'est lui qui a du travail à faire, et la question qu'il se pose
   * est « qu'est-ce que GameDashboard attend de moi ».
   */
  const ssoContract = `# 1. /authorize — le panel y envoie le navigateur
GET <votre URL d'autorisation>
  ?response_type=code
  &client_id=<l'identifiant que vous donnez au panel>
  &redirect_uri=${ssoRedirectUri}
  &scope=openid profile email
  &state=<opaque, à renvoyer tel quel>
  &code_challenge=<SHA-256 du verifier, base64url>
  &code_challenge_method=S256

# 2. /token — échange serveur à serveur, PKCE S256 obligatoire
POST <votre URL de jeton>          Content-Type: application/x-www-form-urlencoded
  grant_type=authorization_code & code & redirect_uri
  client_id & client_secret & code_verifier
  → { "access_token": "..." }

# 3. /userinfo — profil, avec le jeton en Bearer
GET <votre URL de profil>          Authorization: Bearer <access_token>
  → { "sub": "identifiant stable, jamais l'e-mail",
      "email": "alex@exemple.fr",
      "email_verified": true,
      "given_name": "Alex", "family_name": "Martin" }`;

  const errorExample = `{
  "type": "${origin}/api/errors/insufficient-scope",
  "title": "Portée insuffisante",
  "status": 403,
  "detail": "La clé ne porte pas la portée « power.* ».",
  "instance": "/api/v1/client/servers/31201e0c/power"
}`;

  const mono = (chunks: React.ReactNode) => <span className="gd-mono">{chunks}</span>;

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Plug />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <>
              <Button variant="secondary" asChild>
                <Link href="/account/api-keys">
                  <Key /> {t("myKeys")}
                </Link>
              </Button>
              {/* Le schéma est servi par l'API : le bouton y mène vraiment
                  plutôt que de rester décoratif. */}
              <Button variant="secondary" asChild>
                <a href="/api/openapi.json" download>
                  <ArrowDownToLine /> {t("openapi")}
                </a>
              </Button>
            </>
          }
        />
      }
      toolbar={
        <AlertBanner variant="info" title={t("keyFamilies")}>
          {t.rich("keyFamiliesBody", {
            b: (chunks) => <strong>{chunks}</strong>,
            code: (chunks) => <span className="gd-mono">{chunks}</span>,
          })}
        </AlertBanner>
      }
    >
      <Card>
        <CardHeader icon={<Globe />} title={t("routing")} description={t("routingHint")} />
        <CardBody className="flex flex-col gap-4">
          <KeyValueGrid
            items={[
              { label: t("origin"), value: <span className="gd-mono">{origin}</span> },
              { label: t("apiPrefix"), value: <span className="gd-mono">/api/v1</span> },
              { label: t("websocket"), value: <span className="gd-mono">{websocket}</span> },
              { label: t("schema"), value: <span className="gd-mono">/api/openapi.json</span> },
            ]}
          />
          <p className="text-sm text-muted">{t("sameOrigin")}</p>
          <p className="text-sm text-muted">{t("externalClients")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("keyAuth")} description={t("keyAuthHint")} />
        <CardBody className="flex flex-col gap-5">
          <KeyValueGrid
            items={[
              {
                label: t("header"),
                value: <span className="gd-mono">Authorization: Bearer …</span>,
              },
              { label: t("keyPrefix"), value: <span className="gd-mono">gd_live_</span> },
              { label: t("baseClient"), value: <span className="gd-mono">{baseClient}</span> },
              {
                label: t("baseApplication"),
                value: <span className="gd-mono">{baseApplication}</span>,
              },
              { label: t("rateLimit"), value: t("rateLimitValue") },
              { label: t("errorFormat"), value: t("errorFormatValue") },
            ]}
          />
          <CodeBlock title={t("curlTitle")} code={curlExample} />
          <p className="text-sm text-muted">{t("keyStorage")}</p>
        </CardBody>
      </Card>

      <ApplicationKeys
        keys={keys}
        actions={{ create: createApplicationKey, revoke: revokeApplicationKey }}
      />

      <PlatformWebhooks
        webhooks={webhooks}
        deliveries={deliveries}
        keys={keys}
        actions={{
          create: createWebhook,
          rotate: rotateWebhookSecret,
          setActive: setWebhookActive,
          remove: deleteWebhook,
        }}
      />

      <Card>
        <CardHeader
          icon={<ShieldCheck />}
          title={t("webhookSignature")}
          description={t("webhookSignatureHint")}
        />
        <CardBody className="flex flex-col gap-4">
          <KeyValueGrid
            items={[
              {
                label: t("webhookHeaders"),
                value: (
                  <span className="gd-mono text-xs">
                    X-GameDashboard-Signature · X-GameDashboard-Event · X-GameDashboard-Delivery
                  </span>
                ),
              },
              { label: t("webhookTolerance"), value: t("webhookToleranceValue") },
              { label: t("webhookRetries"), value: t("webhookRetriesValue") },
              { label: t("webhookNoRetry"), value: t("webhookNoRetryValue") },
            ]}
          />
          <CodeBlock title={t("webhookVerifyTitle")} code={verifyExample} />
          {/* La livraison, pas l'événement : deux rappels d'un même événement
              vers deux points d'entrée portent deux identifiants distincts. */}
          <p className="text-muted text-sm">{t("webhookDedupe")}</p>
        </CardBody>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-fg">{t("routes")}</h2>
        <Tabs defaultValue="client">
          <TabsList>
            <TabsTrigger value="client" count={CLIENT_ROUTES.length}>
              {t("tabClient")}
            </TabsTrigger>
            <TabsTrigger value="application" count={APPLICATION_ROUTES.length}>
              {t("tabApplication")}
            </TabsTrigger>
            <TabsTrigger value="session" count={SESSION_ROUTES.length}>
              {t("tabSession")}
            </TabsTrigger>
            <TabsTrigger value="realtime" count={REALTIME_EVENTS.length}>
              {t("tabRealtime")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="client" className="pt-4">
            <DataTable
              columns={clientColumns}
              data={CLIENT_ROUTES}
              getRowId={(row) => `${row.method}-${row.path}`}
            />
          </TabsContent>

          <TabsContent value="application" className="pt-4">
            <div className="flex flex-col gap-4">
              <AlertBanner variant="warning">{t("applicationWarning")}</AlertBanner>
              <DataTable
                columns={applicationColumns}
                data={APPLICATION_ROUTES}
                getRowId={(row) => `${row.method}-${row.path}`}
              />
            </div>
          </TabsContent>

          <TabsContent value="session" className="pt-4">
            <div className="flex flex-col gap-4">
              {/* Le dire ici plutôt que de laisser découvrir un 403 : ces routes
                  ne sont pas restreintes par portée, elles sont fermées aux
                  clés, quelle que soit leur portée. */}
              <AlertBanner variant="info">{t("sessionOnly")}</AlertBanner>
              <DataTable
                columns={sessionColumns}
                data={SESSION_ROUTES}
                getRowId={(row) => `${row.method}-${row.path}`}
              />
            </div>
          </TabsContent>

          <TabsContent value="realtime" className="pt-4">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                {/* Le nom du paramètre est rendu tel quel : c'est un gabarit
                    d'URL que le lecteur doit recopier, pas une valeur. */}
                {t.rich("realtimeHint", { c: mono, server: "{server}" })}
              </p>
              <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className="bg-surface-2/60">
                    <tr>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                        {t("columnEvent")}
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                        {t("columnDirection")}
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                        {t("columnScope")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {REALTIME_EVENTS.map((event) => (
                      <tr key={event.name} className="border-t border-border">
                        <td className="px-5 py-3.5">
                          <p className="gd-mono text-fg">{event.name}</p>
                          <p className="text-xs text-muted">{event.summary}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="flex items-center gap-2 text-muted">
                            {event.direction === "out" ? (
                              <>
                                <ArrowDownToLine className="size-4" /> {t("serverToClient")}
                              </>
                            ) : (
                              <>
                                <ArrowUpFromLine className="size-4" /> {t("clientToServer")}
                              </>
                            )}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {event.scope ? (
                            <Badge variant="accent">
                              <span className="gd-mono">{event.scope}</span>
                            </Badge>
                          ) : (
                            <span className="text-faint">{t("noScope")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/*
        Le sens du flux compte, et il a changé : le panel est **client** d'un
        fournisseur externe, il ne délivre pas d'identités. Une documentation
        qui décrirait l'inverse enverrait un intégrateur implémenter pendant
        des jours des endpoints qui n'existent pas.
      */}
      <Card>
        <CardHeader icon={<Terminal />} title={t("sso")} description={t("ssoHint")} />
        <CardBody className="flex flex-col gap-5">
          <KeyValueGrid
            items={[
              { label: t("ssoDirection"), value: t("ssoDirectionValue") },
              { label: t("flow"), value: t("flowValue") },
              { label: t("ssoRedirect"), value: <span className="gd-mono">{ssoRedirectUri}</span> },
              { label: t("ssoConfigured"), value: t("ssoConfiguredValue") },
              { label: t("ssoExclusive"), value: t("ssoExclusiveValue") },
            ]}
          />

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-fg">{t("ssoRequirements")}</p>
            <CodeBlock title={t("ssoRequirementsTitle")} code={ssoContract} />
          </div>

          <AlertBanner variant="warning" title={t("threeChecks")}>
            {t.rich("threeChecksBody", { c: mono })}
          </AlertBanner>

          {/*
            `t.rich` et non `t` : le message porte des balises `<c>` autour des
            noms de champs du fournisseur. `t()` les rend telles quelles et
            next-intl lève « The intl string context variable "c" was not
            provided » — la phrase disparaît alors de l'écran au profit d'une
            erreur, précisément sur le paragraphe qui explique comment deux
            comptes sont rapprochés.
          */}
          <p className="text-muted text-sm">{t.rich("firstLogin", { c: mono })}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("errors")} description={t("errorsHint")} />
        <CardBody className="flex flex-col gap-4">
          <CodeBlock title={t("errorExampleTitle")} code={errorExample} />
          <KeyValueGrid
            items={[
              { label: "400", value: t("error400") },
              { label: "401", value: t("error401") },
              { label: "403", value: t("error403") },
              { label: "404", value: t("error404") },
              { label: "409", value: t("error409") },
              { label: "429", value: t("error429") },
            ]}
          />
        </CardBody>
      </Card>
    </PageTemplate>
  );
}
