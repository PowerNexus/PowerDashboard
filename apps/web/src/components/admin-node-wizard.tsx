"use client";

import { AlertBanner, Button, Card, CardBody, CardHeader, cn } from "@gamedashboard/ui";
import { ArrowRight, Check, Loader2, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import { probeNodeContact } from "@/server/api/admin-node-actions";
import { AdminNodeConfigure } from "./admin-node-configure";
import { AdminNodeDeclareForm } from "./admin-node-create";
import type { ResellerOption } from "./admin-nodes";

const STEPS = ["declare", "install", "contact", "done"] as const;
type Step = (typeof STEPS)[number];

/** Cadence de la sonde du premier contact : celle des heartbeats de Wings. */
const PROBE_EVERY_MS = 5_000;

/**
 * Parcours guidé « Ajouter une machine ».
 *
 * Déclarer une machine et installer Wings étaient deux parcours séparés, sans
 * fil entre eux : on déclarait, puis on cherchait dans un menu de ligne
 * comment configurer le daemon, puis on se demandait si c'était fini. Ici, les
 * quatre étapes se suivent, et la troisième **regarde** : elle interroge le
 * panel jusqu'au premier contact du daemon, et dit quoi vérifier si rien
 * n'arrive.
 */
export function AdminNodeWizard(props: {
  taxonomy: AdminNodeTaxonomy;
  locations: AdminLocation[];
  resellers: ResellerOption[];
  panelOrigin: string;
}) {
  const t = useTranslations("nodeAdmin");
  const [step, setStep] = useState<Step>("declare");
  const [node, setNode] = useState<{ id: string; name: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const index = STEPS.indexOf(step);
  // Stables : la sonde du premier contact se relancerait à chaque rendu sinon.
  const toDone = useCallback(() => setStep("done"), []);
  const toInstall = useCallback(() => setStep("install"), []);

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label={t("wizardProgress")}>
        {STEPS.map((key, i) => (
          <li
            key={key}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 font-semibold text-sm",
              i === index ? "text-accent" : i < index ? "text-fg" : "text-faint",
            )}
          >
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-xs",
                i === index && "bg-accent text-accent-fg",
                i < index && "bg-success-soft text-success-ink",
                i > index && "border border-border",
              )}
            >
              {i < index ? <Check className="size-3.5" /> : i + 1}
            </span>
            {t(`wizardStep.${key}`)}
          </li>
        ))}
      </ol>

      {warning ? (
        <AlertBanner variant="warning" dismissible>
          {warning}
        </AlertBanner>
      ) : null}

      <Card>
        <CardHeader
          step={index + 1}
          title={t(`wizardStep.${step}`)}
          description={t(`wizardStepHint.${step}`)}
        />
        <CardBody>
          {step === "declare" ? (
            <AdminNodeDeclareForm
              taxonomy={props.taxonomy}
              locations={props.locations}
              resellers={props.resellers}
              onDeclared={(declared) => {
                setNode({ id: declared.id, name: declared.name });
                setWarning(declared.warning);
                setStep("install");
              }}
            />
          ) : null}
          {step === "install" && node ? (
            <div className="flex flex-col gap-5">
              <AdminNodeConfigure node={node} panelOrigin={props.panelOrigin} />
              <Button className="self-end" onClick={() => setStep("contact")}>
                {t("wizardInstalled")} <ArrowRight />
              </Button>
            </div>
          ) : null}
          {step === "contact" && node ? (
            <FirstContact node={node} onContact={toDone} onBack={toInstall} />
          ) : null}
          {step === "done" && node ? <WizardDone node={node} /> : null}
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Attend le premier contact du daemon, et le dit.
 *
 * La sonde interroge le panel, pas la machine : c'est Wings qui appelle, et
 * le premier battement enregistré est la seule preuve que la liaison marche
 * dans le sens qui compte. Passé deux minutes, l'écran propose les causes
 * habituelles plutôt que de tourner en silence.
 */
function FirstContact({
  node,
  onContact,
  onBack,
}: {
  node: { id: string; name: string };
  onContact: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("nodeAdmin");
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      const probe = await probeNodeContact(node.id);
      if (stopped) return;
      if (probe.lastHeartbeatAt) {
        onContact();
        return;
      }
      setWaited(Math.floor((Date.now() - started) / 1000));
      timer = setTimeout(tick, PROBE_EVERY_MS);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [node.id, onContact]);

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="flex items-center gap-3 text-fg">
        <Loader2 className="size-5 animate-spin text-accent" />
        {t("contactWaiting", { name: node.name, seconds: waited })}
      </p>
      {waited >= 120 ? (
        <AlertBanner variant="warning" title={t("contactSlowTitle")}>
          <ul className="list-disc pl-5">
            <li>{t("contactSlowService")}</li>
            <li>{t("contactSlowFirewall")}</li>
            <li>{t("contactSlowPanel")}</li>
            <li>{t("contactSlowLogs")}</li>
          </ul>
        </AlertBanner>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t("contactBack")}
        </Button>
        <Button variant="secondary" asChild>
          <Link href={`/admin/nodes/${node.id}`}>{t("contactSkip")}</Link>
        </Button>
      </div>
    </div>
  );
}

/** La machine répond : il reste à lui donner des ports. */
function WizardDone({ node }: { node: { id: string; name: string } }) {
  const t = useTranslations("nodeAdmin");
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-3 text-fg">
        <PartyPopper className="size-5 text-success" />
        {t("doneBody", { name: node.name })}
      </p>
      <AlertBanner variant="info">{t("doneNextPorts")}</AlertBanner>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/admin/nodes/${node.id}?section=ports`}>
            {t("doneAddPorts")} <ArrowRight />
          </Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href={`/admin/nodes/${node.id}`}>{t("openSheet")}</Link>
        </Button>
      </div>
    </div>
  );
}
