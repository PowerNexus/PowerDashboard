import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatMb,
  KeyValueGrid,
  MetricBar,
  PageHeader,
  PageTemplate,
  RelativeTime,
  StatusDot,
} from "@gamedashboard/ui";
import { HardDrive } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { nodeStatusOf } from "@/lib/node-health";
import type { ResellerNode } from "@/server/api/reseller";

/**
 * Machines du revendeur.
 *
 * Deux façons d'être ici, et la carte les distingue : une machine confiée en
 * entier, ou une part sur un dédié partagé avec d'autres revendeurs. La
 * différence n'est pas cosmétique — sur une part, les chiffres affichés sont
 * ceux de la tranche et non ceux du matériel, et la charge des voisins n'est
 * jamais montrée, puisque ce sont des concurrents.
 *
 * Aucune action ici : déclarer un node, faire tourner son jeton ou le mettre en
 * maintenance engage la liaison avec le daemon, et reste du ressort de
 * l'administration de la plateforme. Un bouton inerte ferait chercher un droit
 * qui n'existe pas.
 */
export async function ResellerNodes({ nodes }: { nodes: ResellerNode[] }) {
  const t = await getTranslations("reseller");
  const ts = await getTranslations("nodeStatus");
  const tc = await getTranslations("common");

  if (nodes.length === 0) {
    return (
      <PageTemplate
        header={
          <PageHeader icon={<HardDrive />} title={t("nodesTitle")} subtitle={t("nodesHint")} />
        }
      >
        <EmptyState icon={<HardDrive />} title={t("noNodes")} description={t("noNodesHint")} />
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      header={<PageHeader icon={<HardDrive />} title={t("nodesTitle")} subtitle={t("nodesHint")} />}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {nodes.map((node) => {
          const status = nodeStatusOf(node);
          const shared = node.tenancy === "shared";
          return (
            <Card key={node.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusDot
                      tone={status === "online" ? "success" : "warning"}
                      label={ts(status)}
                    />
                    {node.name}
                    {status !== "online" ? <Badge variant="warning">{ts(status)}</Badge> : null}
                    {/* Le mode de mise à disposition, dit sur chaque machine :
                        un parc mélange les deux, et rien d'autre à l'écran ne
                        distingue une tranche d'un matériel entier. */}
                    <Badge variant={shared ? "accent" : "neutral"}>
                      {shared ? t("tenancyShared") : t("tenancyDedicated")}
                    </Badge>
                  </span>
                }
                description={<span className="gd-mono text-xs">{node.fqdn}</span>}
              />
              <CardBody className="flex flex-col gap-4">
                <p className="text-muted text-xs">
                  {shared ? t("tenancySharedHint") : t("tenancyDedicatedHint")}
                </p>

                {/*
                 * L'origine du chiffre est dite quand ce n'est pas un relevé.
                 * Une consommation majorée par les limites ne se lit pas comme
                 * une mesure : elle est volontairement pessimiste.
                 */}
                {node.usageBasis !== "measured" ? (
                  <Badge className="self-start" variant="neutral">
                    {t(`usageBasis.${node.usageBasis}`)}
                  </Badge>
                ) : null}

                <MetricBar
                  label={shared ? t("memoryOfShare") : t("memory")}
                  value={node.usedMemoryMb}
                  max={node.memoryMb}
                  format={(v) => formatMb(v, 0)}
                />
                <MetricBar
                  label={shared ? t("diskOfShare") : tc("disk")}
                  value={node.usedDiskMb}
                  max={node.diskMb}
                  format={(v) => formatMb(v, 0)}
                />
                <KeyValueGrid
                  items={[
                    { label: tc("location"), value: node.location },
                    {
                      // Les cœurs ne se découpent pas : afficher un nombre sur
                      // une part promettrait une exclusivité que le partage ne
                      // donne pas.
                      label: t("cpuCores"),
                      value: node.cpuCores === null ? t("cpuShared") : String(node.cpuCores),
                    },
                    { label: t("hostedServers"), value: String(node.servers) },
                    {
                      // Libres sur total : « 5 ports » seul ne dit pas si c'est
                      // confortable ou sur le point de manquer. Sur un dédié
                      // partagé, ces ports sont ceux de la machine et donc
                      // communs — le texte le précise plus bas.
                      label: t("ports"),
                      value: t("portsOf", { free: node.freePorts, total: node.totalPorts }),
                    },
                    {
                      label: t("lastHeartbeat"),
                      value: node.lastHeartbeatAt ? (
                        <RelativeTime value={node.lastHeartbeatAt} />
                      ) : (
                        t("neverSeen")
                      ),
                    },
                  ]}
                />

                {/* Les ports d'un dédié partagé ne sont pas réservés : les
                    revendeurs y puisent tous. Le nombre libre peut donc baisser
                    sans que ce revendeur ait rien créé. */}
                {shared ? <p className="text-faint text-xs">{t("portsSharedHint")}</p> : null}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </PageTemplate>
  );
}
