"use client";

import {
  INCIDENT_IMPACTS,
  INCIDENT_STATES,
  type IncidentImpact,
  type IncidentState,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  DialogContent,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  RelativeTime,
  SelectMenu,
  SettingToggle,
} from "@gamedashboard/ui";
import { MegaphoneOff, Plus, Siren } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type AdminIncident, openIncident, postIncidentUpdate } from "@/server/api/incidents";

export interface IncidentComponent {
  id: string;
  name: string;
}

/**
 * Rédaction des incidents.
 *
 * Un écran volontairement pauvre : un titre, une gravité, des composants, et un
 * fil de messages. Tout ce qui est écrit ici part sur la page publique au
 * moment où l'on clique — il n'y a pas de brouillon, parce qu'un brouillon est
 * une publication qu'on oublie de faire.
 */
export function AdminIncidents({
  initial,
  components,
}: {
  initial: AdminIncident[];
  components: IncidentComponent[];
}) {
  const t = useTranslations("adminIncidents");
  const ts = useTranslations("status");
  const tc = useTranslations("common");
  const router = useRouter();

  const [opening, setOpening] = useState(false);
  const [updating, setUpdating] = useState<AdminIncident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState<IncidentImpact>("minor");
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [state, setState] = useState<IncidentState>("identified");

  const run = (action: () => Promise<{ error: string | null }>, done: string) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      setNotice(result.error ? null : done);
      if (!result.error) {
        setOpening(false);
        setUpdating(null);
        setTitle("");
        setBody("");
        setNodeIds([]);
        router.refresh();
      }
    });

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Siren />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button onClick={() => setOpening(true)}>
              <Plus /> {t("open")}
            </Button>
          }
        />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}
      {notice ? (
        <AlertBanner variant="success" title={tc("done")} dismissible>
          {notice}
        </AlertBanner>
      ) : null}

      {initial.length === 0 ? (
        <EmptyState icon={<MegaphoneOff />} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="flex flex-col gap-4">
          {initial.map((incident) => (
            <Card key={incident.id}>
              <CardHeader
                title={incident.title}
                description={
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={incident.resolvedAt ? "success" : "warning"}>
                      {incident.resolvedAt ? t("resolvedBadge") : t("openBadge")}
                    </Badge>
                    <Badge variant="neutral">{ts(`impact.${incident.impact}`)}</Badge>
                    <Badge variant="neutral">{ts(`incidentState.${incident.state}`)}</Badge>
                    <span className="text-muted">
                      {t("started")} <RelativeTime value={incident.startedAt} />
                    </span>
                    <span className="text-faint">
                      · {t("updates", { count: incident.updates.length })}
                    </span>
                  </span>
                }
                actions={
                  // Un incident clos ne se rouvre pas : on en ouvre un nouveau.
                  // Rouvrir brouillerait la chronologie que les clients relisent.
                  incident.resolvedAt ? null : (
                    <Button variant="secondary" size="sm" onClick={() => setUpdating(incident)}>
                      {t("updateTitle")}
                    </Button>
                  )
                }
              />
              <CardBody className="flex flex-col gap-3">
                {[...incident.updates].reverse().map((update) => (
                  <div
                    key={`${update.at}-${update.state}`}
                    className="border-border border-l-2 pl-4 first:border-accent"
                  >
                    <p className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-fg">
                        {ts(`incidentState.${update.state}`)}
                      </span>
                      <RelativeTime className="text-faint" value={update.at} />
                    </p>
                    <p className="mt-1 text-fg text-sm">{update.body}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent
          title={t("openTitle")}
          description={t("openHint")}
          footer={
            <Button
              disabled={pending || title.trim() === "" || body.trim() === ""}
              onClick={() =>
                run(() => openIncident({ title, impact, nodeIds, body }), t("published"))
              }
            >
              {t("publish")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <FormField label={t("titleLabel")}>
              {(id) => (
                <Input
                  id={id}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("titlePlaceholder")}
                />
              )}
            </FormField>

            <FormField label={t("impactLabel")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={impact}
                  onValueChange={(value) => setImpact(value as IncidentImpact)}
                  options={INCIDENT_IMPACTS.map((value) => ({
                    value,
                    label: ts(`impact.${value}`),
                  }))}
                />
              )}
            </FormField>

            <FormField label={t("componentsLabel")} description={t("componentsHint")}>
              {() => (
                <div className="flex flex-col gap-2">
                  {components.length === 0 ? (
                    <p className="text-muted text-sm">{t("noComponent")}</p>
                  ) : (
                    components.map((component) => (
                      <SettingToggle
                        key={component.id}
                        label={component.name}
                        checked={nodeIds.includes(component.id)}
                        onCheckedChange={(on) =>
                          setNodeIds((current) =>
                            on
                              ? [...new Set([...current, component.id])]
                              : current.filter((id) => id !== component.id),
                          )
                        }
                      />
                    ))
                  )}
                </div>
              )}
            </FormField>

            <FormField label={t("firstUpdateLabel")}>
              {(id) => (
                <Input
                  id={id}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("firstUpdatePlaceholder")}
                />
              )}
            </FormField>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={updating !== null} onOpenChange={(o) => !o && setUpdating(null)}>
        <DialogContent
          title={t("updateTitle")}
          description={t("updateHint")}
          footer={
            <Button
              disabled={pending || body.trim() === ""}
              onClick={() => {
                const target = updating;
                if (!target) return;
                run(() => postIncidentUpdate(target.id, { state, body }), t("updated"));
              }}
            >
              {t("postUpdate")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <FormField label={t("stateLabel")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={state}
                  onValueChange={(value) => setState(value as IncidentState)}
                  options={INCIDENT_STATES.map((value) => ({
                    value,
                    label: ts(`incidentState.${value}`),
                  }))}
                />
              )}
            </FormField>

            <FormField label={t("bodyLabel")}>
              {(id) => (
                <Input
                  id={id}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("bodyPlaceholder")}
                />
              )}
            </FormField>
          </div>
        </DialogContent>
      </Dialog>
    </PageTemplate>
  );
}
