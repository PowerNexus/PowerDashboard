import { PLATFORM_ACCESS_META, quotaOutlook } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Card,
  CardBody,
  CardHeader,
  formatMb,
  MetricBar,
  PageHeader,
  PageTemplate,
  RelativeTime,
  StatTile,
  StatusDot,
} from "@gamedashboard/ui";
import { Activity, HardDrive, Server, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { nodeStatusOf } from "@/lib/node-health";
import type { ResellerOverview as Overview } from "@/server/api/reseller";

/**
 * Vue d'ensemble du parc d'un revendeur.
 *
 * Tout ce qui est affiché vient de ses machines : les serveurs sont ceux qui y
 * tournent, les clients ceux à qui ces serveurs appartiennent. Aucun chiffre
 * n'est extrapolé — un parc vide affiche zéro, ce qui est exact.
 */
export async function ResellerOverview({ overview }: { overview: Overview }) {
  const t = await getTranslations("reseller");
  const ts = await getTranslations("nodeStatus");
  const tc = await getTranslations("common");

  const memoryTotal = overview.nodes.reduce((sum, n) => sum + n.memoryMb, 0);
  const memoryUsed = overview.nodes.reduce((sum, n) => sum + n.usedMemoryMb, 0);
  const freePorts = overview.nodes.reduce((sum, n) => sum + n.freePorts, 0);

  /*
   * Un total n'est un relevé que si chacun de ses termes en est un.
   *
   * Dès qu'une seule machine retombe sur les limites, la somme est majorée et
   * ne peut plus être lue comme une mesure. La dire mesurée ferait prendre une
   * marge de sécurité pour une réalité.
   */
  const estimatedNodes = overview.nodes.filter((n) => n.usageBasis !== "measured").length;

  /**
   * L'enveloppe, dimension par dimension.
   *
   * Les trois paires sont rapprochées ici plutôt que dans le composant de
   * jauge : la carte doit savoir si *quelque chose* est plein pour afficher
   * l'avertissement, et une jauge ne connaît qu'elle-même.
   */
  const quota = overview.quota;
  const unlimited =
    quota.quota.memoryMb === null && quota.quota.diskMb === null && quota.quota.serversMax === null;

  /*
   * Ce qui l'attend, et non la gravité de sa situation.
   *
   * L'écran disait « les serveurs en place continuent de tourner » pour tout
   * dépassement. C'était exact tant que l'enveloppe n'était opposée qu'à la
   * création ; cela a cessé de l'être le jour où le surveillant s'est mis à
   * couper dessus, et une phrase rassurante devenue fausse est pire qu'une
   * absence de phrase — elle est crue.
   *
   * La règle vit dans les contrats, avec `checkQuota` : c'est la même
   * enveloppe, et l'écran n'a pas à en tenir une seconde lecture.
   */
  const outlook = quotaOutlook(quota.quota, quota.usage, quota.usage.basis);

  return (
    <PageTemplate
      header={<PageHeader icon={<Activity />} title={t("title")} subtitle={t("subtitle")} />}
      toolbar={
        // L'état de l'autorisation est rappelé ici plutôt que réservé aux
        // réglages : c'est la seule chose de cet espace qui laisse quelqu'un
        // d'autre agir sur le parc, et on doit pouvoir le constater sans
        // chercher.
        /*
         * Le niveau en vigueur, rappelé ici plutôt que réservé aux réglages :
         * c'est la seule chose de cet espace qui décide de ce que quelqu'un
         * d'autre peut faire sur ce parc, et on doit pouvoir le constater sans
         * aller le chercher.
         *
         * Le texte vient du niveau lui-même, avec sa conséquence sur le
         * support : trois phrases tenues en double — ici et dans les réglages —
         * auraient fini par ne plus dire la même chose.
         */
        <AlertBanner variant={overview.platformAccess === "provision" ? "warning" : "info"}>
          {PLATFORM_ACCESS_META[overview.platformAccess].body}{" "}
          {PLATFORM_ACCESS_META[overview.platformAccess].support}
        </AlertBanner>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<HardDrive />}
          tone="accent"
          label={t("myNodes")}
          value={overview.nodes.length}
          hint={t("nodesUnit")}
        />
        <StatTile
          icon={<Server />}
          tone="default"
          label={t("hostedServers")}
          value={overview.servers.length}
          hint={t("serversUnit")}
        />
        <StatTile
          icon={<Users />}
          tone="default"
          label={t("clients")}
          value={overview.clients.length}
          hint={t("clientsUnit")}
        />
        <StatTile
          icon={<Activity />}
          tone={freePorts === 0 ? "danger" : "success"}
          label={t("freePorts")}
          // Zéro port libre n'est pas un détail : plus aucun serveur ne peut
          // être créé, et rien d'autre à l'écran ne le dirait.
          value={freePorts}
          hint={freePorts === 0 ? t("noPortsHint") : t("portsUnit")}
        />
      </div>

      <Card>
        <CardHeader title={t("capacity")} description={t("capacityHint")} />
        <CardBody className="divide-y divide-border px-0 py-0">
          {estimatedNodes > 0 ? (
            <p className="px-6 pt-4 text-faint text-xs">
              {t("usageEstimatedNotice", { count: estimatedNodes })}
            </p>
          ) : null}
          {overview.nodes.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">{t("noNodes")}</p>
          ) : (
            overview.nodes.map((node) => {
              const status = nodeStatusOf(node);
              return (
                <div
                  key={node.id}
                  className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4"
                >
                  <div className="flex min-w-56 items-center gap-2.5">
                    <StatusDot
                      tone={status === "online" ? "success" : "warning"}
                      label={ts(status)}
                    />
                    <div>
                      <p className="font-semibold text-fg">{node.name}</p>
                      <p className="gd-mono text-xs text-muted">{node.fqdn}</p>
                      {/* Entière ou par tranche : sans cette mention, les deux
                          lignes se ressemblent alors que les chiffres de l'une
                          portent sur le matériel et ceux de l'autre sur une
                          part de celui-ci. */}
                      <Badge
                        className="mt-1"
                        variant={node.tenancy === "shared" ? "accent" : "neutral"}
                      >
                        {node.tenancy === "shared" ? t("tenancyShared") : t("tenancyDedicated")}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <MetricBar
                      // La consommation face à ce qui lui est accordé ici — sa
                      // part sur un dédié partagé, la machine entière sinon.
                      // Jamais la charge globale d'une machine partagée : elle
                      // révélerait l'activité de ses concurrents.
                      label={node.tenancy === "shared" ? t("memoryOfShare") : t("memory")}
                      value={node.usedMemoryMb}
                      max={node.memoryMb}
                      format={(v) => formatMb(v, 0)}
                    />
                    <MetricBar
                      label={node.tenancy === "shared" ? t("diskOfShare") : tc("disk")}
                      value={node.usedDiskMb}
                      max={node.diskMb}
                      format={(v) => formatMb(v, 0)}
                    />
                  </div>
                  <span className="text-xs text-muted">
                    {t("nodeServers", { count: node.servers })}
                  </span>
                  {node.lastHeartbeatAt ? (
                    <RelativeTime className="text-xs text-faint" value={node.lastHeartbeatAt} />
                  ) : (
                    <span className="text-xs text-faint">{t("neverSeen")}</span>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {/* L'enveloppe, distincte de la capacité juste au-dessus : l'une dit ce
          que le matériel porte, l'autre ce qu'on a le droit d'en vendre. Les
          deux peuvent diverger largement, et c'est le sujet. */}
      <Card>
        <CardHeader title={t("quota")} description={t("quotaHint")} />
        <CardBody className="grid gap-4">
          {unlimited ? <p className="text-sm text-muted">{t("quotaUnlimitedHint")}</p> : null}
          {outlook === "over-enforced" ? (
            // Le seul cas qui demande un geste dans l'heure : rouge, et il dit
            // ce qui va être arrêté.
            <AlertBanner variant="danger">{t("quotaOverEnforcedNotice")}</AlertBanner>
          ) : null}
          {outlook === "over-unmeasured" ? (
            <AlertBanner variant="info">{t("quotaOverUnmeasuredNotice")}</AlertBanner>
          ) : null}
          {outlook === "over-passive" ? (
            <AlertBanner variant="warning">{t("quotaOverPassiveNotice")}</AlertBanner>
          ) : null}
          {outlook === "full" ? (
            <AlertBanner variant="warning">{t("quotaFullNotice")}</AlertBanner>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <QuotaGauge
              label={t("memory")}
              used={quota.usage.memoryMb}
              limit={quota.quota.memoryMb}
              format={(v) => formatMb(v, 0)}
              unlimitedLabel={t("quotaUnlimited")}
            />
            <QuotaGauge
              label={tc("disk")}
              used={quota.usage.diskMb}
              limit={quota.quota.diskMb}
              format={(v) => formatMb(v, 0)}
              unlimitedLabel={t("quotaUnlimited")}
            />
            <QuotaGauge
              label={t("quotaServers")}
              used={quota.usage.servers}
              limit={quota.quota.serversMax}
              format={(v) => String(v)}
              unlimitedLabel={t("quotaUnlimited")}
            />
          </div>
        </CardBody>
      </Card>

      {/* Le total alloué face au total possédé : c'est le chiffre qui dit
          s'il est temps d'ajouter une machine. */}
      {overview.nodes.length > 0 ? (
        <Card>
          <CardHeader title={t("allocated")} description={t("allocatedHint")} />
          <CardBody>
            <MetricBar
              label={t("memory")}
              value={memoryUsed}
              max={memoryTotal}
              format={(v) => formatMb(v, 0)}
            />
          </CardBody>
        </Card>
      ) : null}
    </PageTemplate>
  );
}

/**
 * Une dimension de l'enveloppe.
 *
 * Sans plafond, aucune jauge : un remplissage suppose un maximum, et en
 * inventer un ferait croire à une limite qui n'existe pas. On montre alors la
 * consommation brute, qui est la seule chose vraie dans ce cas.
 */
function QuotaGauge({
  label,
  used,
  limit,
  format,
  unlimitedLabel,
}: {
  label: string;
  used: number;
  limit: number | null;
  format: (value: number) => string;
  unlimitedLabel: string;
}) {
  if (limit === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-semibold text-muted text-xs">{label}</span>
        <span className="gd-mono text-fg text-sm">{format(used)}</span>
        <span className="text-faint text-xs">{unlimitedLabel}</span>
      </div>
    );
  }

  return <MetricBar label={label} value={used} max={limit} format={format} />;
}
