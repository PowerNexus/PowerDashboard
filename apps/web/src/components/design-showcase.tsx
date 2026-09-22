"use client";

import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  type ColumnDef,
  DataTable,
  EmptyState,
  FormField,
  Input,
  KeyValueGrid,
  MetricBar,
  PageHeader,
  PasswordInput,
  RelativeTime,
  SelectMenu,
  SparkChart,
  StatTile,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@gamedashboard/ui";
import { Archive, Inbox, Mail, Palette, Server, Trash2, Users } from "lucide-react";
import { series } from "@/lib/mock";

interface Ticket {
  id: string;
  subject: string;
  excerpt: string;
  department: string;
  status: "open" | "answered" | "closed";
  updatedAt: string;
}

const TICKETS: Ticket[] = [
  {
    id: "#77",
    subject: "Double transaction",
    excerpt: "Bonjour, dans les deux cas le remboursement peut être annulé par le client…",
    department: "VPS & Cloud",
    status: "open",
    updatedAt: new Date(Date.now() - 51 * 60_000).toISOString(),
  },
  {
    id: "#222",
    subject: "Ticket Discord n°33133 · VPS / revendeurs",
    excerpt: "Support : ça devrait être bon depuis",
    department: "VPS & Cloud",
    status: "answered",
    updatedAt: new Date(Date.now() - 54 * 60_000).toISOString(),
  },
];

const STATUS: Record<
  Ticket["status"],
  { label: string; variant: "warning" | "accent" | "success" }
> = {
  open: { label: "En cours", variant: "warning" },
  answered: { label: "Répondu", variant: "accent" },
  closed: { label: "Résolu", variant: "success" },
};

const columns: ColumnDef<Ticket, unknown>[] = [
  {
    accessorKey: "subject",
    header: "Ticket",
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-semibold text-fg">
          <span className="mr-2 text-muted">{row.original.id}</span>
          {row.original.subject}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
          <Users className="size-3.5 shrink-0" />
          {row.original.excerpt}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "department",
    header: "Département",
    cell: ({ getValue }) => (
      <span className="flex items-center gap-2 text-muted">
        <StatusDot tone="info" />
        {getValue() as string}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Statut",
    cell: ({ row }) => {
      const s = STATUS[row.original.status];
      return <Badge variant={s.variant}>{s.label}</Badge>;
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Dernière activité",
    cell: ({ getValue }) => <RelativeTime className="text-muted" value={getValue() as string} />,
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="gd-section-label">{title}</h2>
      {children}
    </section>
  );
}

/** Vitrine des composants du design system. Sera remplacée par Storybook. */
export function DesignShowcase() {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-10">
      <PageHeader
        icon={<Palette />}
        title="Design system"
        subtitle="Tous les composants réutilisables de @gamedashboard/ui, dans les deux thèmes."
        breadcrumbs={[{ label: "Aide" }, { label: "Design system" }]}
        actions={<Button variant="secondary">Exporter les tokens</Button>}
      />

      <Section title="Couleurs">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["Accent", "bg-accent", "text-accent-fg"],
            ["Accent doux", "bg-accent-soft", "text-accent"],
            ["Surface", "bg-surface border border-border", "text-fg"],
            ["Surface 2", "bg-surface-2", "text-fg"],
            ["Succès", "bg-success", "text-white"],
            ["Avertissement", "bg-warning", "text-white"],
            ["Danger", "bg-danger", "text-white"],
            ["Info", "bg-info", "text-white"],
          ].map(([label, bg, fg]) => (
            <div key={label} className={`flex h-20 items-end rounded-card p-3 ${bg} ${fg}`}>
              <span className="text-xs font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Boutons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primaire</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="soft">Doux</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="ghost">Fantôme</Button>
          <Button variant="danger">
            <Trash2 /> Supprimer
          </Button>
          <Button loading>Chargement</Button>
          <Button disabled>Désactivé</Button>
          <Button size="sm">Petit</Button>
          <Button size="lg">Grand</Button>
        </div>
      </Section>

      <Section title="Badges, pastilles, avatars">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Neutre</Badge>
          <Badge variant="accent">Répondu</Badge>
          <Badge variant="success">Résolu</Badge>
          <Badge variant="warning">En cours</Badge>
          <Badge variant="danger">Hors ligne</Badge>
          <Badge variant="solid">Nouveau</Badge>
          <span className="flex items-center gap-2 text-sm text-muted">
            <StatusDot tone="success" /> En ligne
          </span>
          <span className="flex items-center gap-2 text-sm text-muted">
            <StatusDot tone="warning" pulse /> Démarrage
          </span>
          <Avatar name="Matheo" size="sm" />
          <Avatar name="Matheo" />
          <Avatar name="Matheo" size="lg" />
        </div>
      </Section>

      <Section title="Menus déroulants">
        <div className="flex flex-wrap items-start gap-4">
          <SelectMenu
            className="w-56"
            defaultValue="all"
            aria-label="Exemple simple"
            options={[
              { value: "all", label: "Tous les états" },
              { value: "running", label: "En ligne" },
              { value: "offline", label: "Hors ligne" },
            ]}
          />
          <SelectMenu
            className="w-64"
            defaultValue="n1"
            aria-label="Exemple avec groupes et descriptions"
            options={[
              { value: "auto", label: "Choix automatique" },
              {
                value: "n1",
                label: "RYZEN-GAME-09",
                description: "Gravelines, FR",
                group: "Nodes",
              },
              { value: "n2", label: "RYZEN-GAME-11", description: "Roubaix, FR", group: "Nodes" },
              {
                value: "n3",
                label: "EPYC-GAME-02",
                description: "Maintenance",
                group: "Nodes",
                disabled: true,
              },
            ]}
          />
          <SelectMenu
            className="w-48"
            placeholder="Non renseigné"
            aria-label="Exemple vide"
            options={[
              { value: "fr", label: "Français" },
              { value: "en", label: "English" },
            ]}
          />
        </div>
      </Section>

      <Section title="Formulaire">
        <Card className="max-w-md">
          <CardHeader
            step={1}
            title="Informations"
            description="Champs avec icône, focus accent et validation."
          />
          <CardBody className="flex flex-col gap-4">
            <FormField label="Adresse e-mail" description="Utilisée pour les notifications.">
              {(id) => <Input id={id} leadingIcon={<Mail />} placeholder="vous@exemple.fr" />}
            </FormField>
            <FormField label="Mot de passe" error="12 caractères minimum.">
              {(id) => <PasswordInput id={id} invalid placeholder="••••••••" />}
            </FormField>
          </CardBody>
        </Card>
      </Section>

      <Section title="Tuiles et barres de ressources">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={<Server />} tone="accent" label="Serveurs" value="4" hint="1 en ligne" />
          <StatTile
            icon={<Users />}
            tone="success"
            label="Joueurs"
            value="12"
            hint="sur 428 places"
          />
          <StatTile
            icon={<Archive />}
            tone="warning"
            label="Sauvegardes"
            value="17"
            hint="3 cette semaine"
          />
          <StatTile icon={<Inbox />} label="Notifications" value="1" hint="non lue" />
        </div>
        <Card>
          <CardBody className="grid gap-5 sm:grid-cols-3">
            <MetricBar label="CPU" value={42} max={100} format={(v) => `${v.toFixed(0)} %`} />
            <MetricBar
              label="Mémoire"
              value={3100}
              max={3993}
              format={(v) => `${(v / 1024).toFixed(1)} GB`}
            />
            <MetricBar
              label="Disque"
              value={28800}
              max={29900}
              format={(v) => `${(v / 1024).toFixed(1)} GB`}
            />
          </CardBody>
        </Card>
      </Section>

      <Section title="Bandeaux">
        <div className="flex flex-col gap-3">
          <AlertBanner>
            Bandeau accent, avec un <a href="#top">lien</a> et du <strong>gras</strong>.
          </AlertBanner>
          <AlertBanner variant="success" title="Installation terminée">
            Votre serveur est prêt à démarrer.
          </AlertBanner>
          <AlertBanner variant="warning" dismissible>
            Maintenance planifiée du node RYZEN-GAME-09 ce soir.
          </AlertBanner>
          <AlertBanner variant="danger">
            Le daemon de ce node ne répond plus depuis 3 minutes.
          </AlertBanner>
        </div>
      </Section>

      <Section title="Onglets et tableau">
        <Tabs defaultValue="open">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <TabsList>
              <TabsTrigger value="open" count={2}>
                En cours
              </TabsTrigger>
              <TabsTrigger value="closed" count={1}>
                Résolus
              </TabsTrigger>
              <TabsTrigger value="all" count={3}>
                Tous
              </TabsTrigger>
            </TabsList>
            <Input className="w-full sm:w-72" placeholder="Rechercher…" leadingIcon={<Inbox />} />
          </div>
          <TabsContent value="open" className="pt-4">
            <DataTable columns={columns} data={TICKETS} />
          </TabsContent>
          <TabsContent value="closed" className="pt-4">
            <DataTable
              columns={columns}
              data={[]}
              emptyState={
                <EmptyState
                  icon={Inbox && <Inbox />}
                  title="Aucun élément résolu"
                  description="Les tickets fermés apparaîtront ici."
                />
              }
            />
          </TabsContent>
          <TabsContent value="all" className="pt-4">
            <DataTable columns={columns} data={undefined} isLoading />
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Grille label / valeur et graphes">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader step={2} title="Informations serveur" />
            <CardBody>
              <KeyValueGrid
                items={[
                  { label: "Identifiant", value: <span className="gd-mono">31201e0c</span> },
                  { label: "Node", value: "RYZEN-GAME-09" },
                  { label: "Adresse", value: <span className="gd-mono">37.59.239.84:26002</span> },
                  { label: "Jeu", value: "Minecraft 1.21.4" },
                  { label: "Mémoire", value: "4 GB" },
                  { label: "Disque", value: "29.3 GB" },
                ]}
              />
            </CardBody>
          </Card>
          <SparkChart title="Utilisation CPU" data={series(3, 60, 45, 35)} max={100} unit=" %" />
        </div>
      </Section>
    </div>
  );
}
