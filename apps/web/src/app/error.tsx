"use client";

import {
  AlertBanner,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  SplashScreen,
} from "@gamedashboard/ui";
import { DatabaseZap, PlugZap, RotateCcw, ServerCrash, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useState } from "react";
import { apiFailureFromDigest } from "@/lib/api-status";

/** Cadence de la sonde. Assez court pour que le retour se voie, assez long pour ne pas marteler. */
const PROBE_INTERVAL_MS = 3_000;

type Probe = "checking" | "unreachable" | "degraded" | "ok";

/**
 * Reprises automatiques accordées, par chargement de page.
 *
 * Compteur de module, et non état de composant : la frontière se remonte à
 * chaque tentative, et un état local repartirait de zéro — c'est-à-dire
 * n'arrêterait rien.
 */
const MAX_AUTO_RECOVERIES = 3;
let autoRecoveries = 0;

/**
 * Frontière d'erreur du panel.
 *
 * Elle existe surtout pour un cas précis, fréquent en développement et pas
 * impossible en production : l'API ne répond pas. Next affiche alors « fetch
 * failed », qui ne dit ni ce qui a échoué ni comment y remédier.
 *
 * Trois choix la distinguent d'un écran d'erreur ordinaire :
 *
 * 1. **Elle reconnaît la panne par le `digest`**, pas par le texte du message.
 *    Hors développement, Next remplace le message par une phrase générique et
 *    ne transmet que ce jeton : une frontière qui lit le message fonctionne
 *    sur le poste du développeur et nulle part ailleurs.
 * 2. **Elle distingue trois pannes** — API éteinte, API trop lente, base
 *    tombée — parce qu'elles appellent trois gestes différents.
 * 3. **Elle se répare toute seule.** Une sonde interroge le panel toutes les
 *    trois secondes ; quand l'API revient, la page se recharge sans qu'on ait
 *    à y penser. C'est ce qu'on fait à la main, en boucle, sinon.
 */
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /**
   * Le `digest` fait foi ; le message ne sert que de repli en développement.
   *
   * Ce repli existe parce qu'un `throw` venu d'ailleurs — une action serveur,
   * un chargement partiel — peut porter le bon message sans avoir traversé
   * `apiFetch`. Il ne remplace pas le jeton, il le complète.
   */
  const failure =
    apiFailureFromDigest(error.digest) ??
    (error.message.includes("ne répond pas") ? "offline" : null);

  const router = useRouter();
  const [probe, setProbe] = useState<Probe>(failure ? "checking" : "ok");
  const [exhausted, setExhausted] = useState(false);

  /**
   * Reprendre, pour de bon.
   *
   * `reset()` seul **ne suffit pas** : il rejoue le rendu à partir de la charge
   * déjà reçue, qui contient précisément l'échec. La page échoue donc à
   * l'identique, la frontière se remonte, la sonde retrouve une API en ligne et
   * redemande une reprise — une boucle qui ne s'arrête jamais et qui martèle le
   * serveur. `router.refresh()` invalide d'abord les données du serveur ; c'est
   * lui qui rend `reset()` capable de réussir.
   */
  const retry = useCallback(() => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }, [router, reset]);

  useEffect(() => {
    if (!failure) return;

    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = (await response.json()) as { status: Probe };
        if (cancelled) return;

        setProbe(body.status);
        if (body.status !== "ok") return;

        /**
         * Le retour relance le rendu — au plus quelques fois.
         *
         * Le compteur vit au niveau du module, donc il survit au remontage de
         * la frontière : c'est ce qui borne la reprise automatique. Sans lui,
         * une API en ligne dont les pages échouent pour une **autre** raison
         * relancerait le rendu indéfiniment, et l'écran d'erreur deviendrait
         * la panne.
         */
        if (autoRecoveries >= MAX_AUTO_RECOVERIES) {
          setExhausted(true);
          return;
        }

        autoRecoveries += 1;
        retry();
      } catch {
        if (!cancelled) setProbe("unreachable");
      }
    };

    void check();
    const timer = setInterval(() => void check(), PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [failure, retry]);

  /**
   * L'API est revenue : on montre le démarrage, pas l'erreur qu'on quitte.
   *
   * La reprise est lancée et le rendu est en cours ; afficher encore « hors
   * ligne » pendant ce temps donnerait l'impression que la sonde s'est trompée.
   * Le même écran que le premier chargement referme la boucle.
   */
  if (failure && probe === "ok" && !exhausted) {
    return <SplashScreen cover label="L'API répond de nouveau. Rechargement…" />;
  }

  /**
   * L'API répond, la page échoue quand même.
   *
   * Cas rare mais réel — une base tombée entre-temps, une route cassée. Le dire
   * vaut mieux que de reprendre en boucle : la reprise automatique s'arrête, et
   * la main revient à qui regarde l'écran.
   */
  if (exhausted) {
    return (
      <Shell
        icon={<ServerCrash className="size-8 text-danger-ink" />}
        title="L'API répond, mais la page échoue encore"
        status={<Badge variant="warning">Reprise interrompue</Badge>}
      >
        <p className="text-muted">
          Le panel a retenté {MAX_AUTO_RECOVERIES} fois sans succès. La cause n'est donc pas — ou
          plus — l'API : regardez ses journaux, puis réessayez.
        </p>
        <TechnicalDetail error={error} />
        <Retry onClick={retry} />
      </Shell>
    );
  }

  if (!failure) {
    return (
      <Shell
        icon={<ServerCrash className="size-8 text-danger-ink" />}
        title="Une erreur est survenue"
      >
        <AlertBanner variant="danger" title="Détail">
          {error.message}
        </AlertBanner>
        {error.digest ? (
          <p className="text-faint text-xs">
            Référence : <span className="gd-mono">{error.digest}</span>
          </p>
        ) : null}
        <Retry onClick={retry} />
      </Shell>
    );
  }

  // La base tombée l'emporte sur la panne d'origine : c'est la cause la plus
  // profonde, et relancer l'API n'y changerait rien.
  if (probe === "degraded") {
    return (
      <Shell
        icon={<DatabaseZap className="size-8 text-warning-ink" />}
        title="La base de données ne répond pas"
        status={<Badge variant="warning">API en ligne</Badge>}
      >
        <p className="text-muted">
          L'API tourne mais ne parvient pas à joindre PostgreSQL. La relancer n'y changerait rien :
          c'est la base qu'il faut remettre en route.
        </p>
        <CodeBlock title="bash" code="pnpm services:up" />
        <ProbeNote probe={probe} />
        <Retry onClick={retry} />
      </Shell>
    );
  }

  if (failure === "timeout") {
    return (
      <Shell
        icon={<Timer className="size-8 text-warning-ink" />}
        title="L'API met trop de temps à répondre"
        status={<ProbeBadge probe={probe} />}
      >
        <p className="text-muted">
          La connexion a été acceptée, mais aucune réponse n'est arrivée dans le délai imparti. Ce
          n'est pas un processus arrêté : cherchez plutôt une base saturée, une requête bloquée ou
          un node qui ne rend pas la main.
        </p>
        <ProbeNote probe={probe} />
        <TechnicalDetail error={error} />
        <Retry onClick={retry} />
      </Shell>
    );
  }

  return (
    <Shell
      icon={<PlugZap className="size-8 text-danger-ink" />}
      title="L'API ne répond pas"
      status={<ProbeBadge probe={probe} />}
    >
      <p className="text-muted">
        Le panel lit ses données depuis l'API, qui ne tourne pas. Démarrez-la dans un second
        terminal : la page reprendra d'elle-même dès qu'elle répondra.
      </p>
      <CodeBlock title="bash" code="pnpm --filter @gamedashboard/api dev" />
      <p className="text-muted text-sm">
        Elle a aussi besoin de PostgreSQL :{" "}
        <span className="gd-mono text-xs">pnpm services:up</span>.
      </p>
      <ProbeNote probe={probe} />
      <TechnicalDetail error={error} />
      <Retry onClick={retry} />
    </Shell>
  );
}

function Shell({
  icon,
  title,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-12">
      <Card>
        <CardHeader
          icon={icon}
          title={title}
          description="Panel GameDashboard"
          actions={status ?? undefined}
        />
        <CardBody className="flex flex-col gap-4">{children}</CardBody>
      </Card>
    </div>
  );
}

/** L'état de la sonde, dit sans jargon : la page se surveille toute seule. */
function ProbeBadge({ probe }: { probe: Probe }) {
  if (probe === "checking") return <Badge variant="neutral">Vérification…</Badge>;
  if (probe === "ok") return <Badge variant="success">De retour</Badge>;
  if (probe === "degraded") return <Badge variant="warning">Base injoignable</Badge>;
  return <Badge variant="danger">Hors ligne</Badge>;
}

function ProbeNote({ probe }: { probe: Probe }) {
  return (
    <p className="text-faint text-xs">
      {probe === "ok"
        ? "L'API répond de nouveau. Rechargement en cours…"
        : `Nouvelle vérification toutes les ${PROBE_INTERVAL_MS / 1000} secondes.`}
    </p>
  );
}

/**
 * Le détail technique, replié.
 *
 * C'est un panel d'administration : celui qui le lit sait quoi en faire. Mais
 * il vient après le remède, jamais avant — un message d'erreur qui s'ouvre sur
 * une pile d'appels apprend surtout qu'on n'a rien prévu pour ce cas.
 */
function TechnicalDetail({ error }: { error: Error & { digest?: string } }) {
  return (
    <details className="text-faint text-sm">
      <summary className="cursor-pointer">Détail technique</summary>
      <p className="gd-mono mt-2 text-xs">{error.message}</p>
      {error.digest ? <p className="gd-mono mt-1 text-xs">digest : {error.digest}</p> : null}
    </details>
  );
}

function Retry({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <Button onClick={onClick}>
        <RotateCcw /> Réessayer maintenant
      </Button>
    </div>
  );
}
