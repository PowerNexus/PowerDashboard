import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Référence des tokens de design.
 *
 * Elle existe pour une raison précise : tant qu'on ne voit pas les couleurs
 * disponibles, on en écrit une en dur « juste cette fois ». Cette page rend le
 * bon choix plus rapide que le mauvais.
 *
 * Chaque pastille lit la variable CSS réelle : basculer le thème dans la barre
 * d'outils met la page à jour, sans qu'aucune valeur ne soit recopiée ici.
 */
const meta = {
  title: "Fondations/Tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Swatch({ name, variable }: { name: string; variable: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="size-10 shrink-0 rounded-md border border-border"
        style={{ background: `var(${variable})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="truncate font-mono text-xs text-faint">{variable}</span>
      </span>
    </div>
  );
}

function Group({ title, tokens }: { title: string; tokens: [string, string][] }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map(([name, variable]) => (
          <Swatch key={variable} name={name} variable={variable} />
        ))}
      </div>
    </section>
  );
}

export const Couleurs: Story = {
  render: () => (
    <div className="flex flex-col gap-10 p-8">
      <Group
        title="Accent"
        tokens={[
          ["Accent 400", "--gd-accent-400"],
          ["Accent 500", "--gd-accent-500"],
          ["Accent 600", "--gd-accent-600"],
          ["Accent doux", "--gd-accent-soft"],
        ]}
      />
      <Group
        title="Surfaces"
        tokens={[
          ["Fond", "--gd-bg"],
          ["Surface", "--gd-surface"],
          ["Surface 2", "--gd-surface-2"],
          ["Surface 3", "--gd-surface-3"],
          ["Bordure", "--gd-border"],
          ["Bordure marquée", "--gd-border-strong"],
        ]}
      />
      <Group
        title="Texte"
        tokens={[
          ["Texte", "--gd-text"],
          ["Texte secondaire", "--gd-text-muted"],
          ["Texte discret", "--gd-text-faint"],
        ]}
      />
      <Group
        title="États"
        tokens={[
          ["Succès", "--gd-success"],
          ["Avertissement", "--gd-warning"],
          ["Danger", "--gd-danger"],
          ["Information", "--gd-info"],
        ]}
      />
    </div>
  ),
};

/**
 * Les états doux servent de fond à un texte de la même famille. Les afficher
 * appariés est le seul moyen de vérifier le contraste : une pastille isolée ne
 * dit rien de sa lisibilité une fois du texte posé dessus.
 */
export const EtatsAppaires: Story = {
  render: () => (
    <div className="flex flex-col gap-3 p-8">
      {[
        ["Succès", "success"],
        ["Avertissement", "warning"],
        ["Danger", "danger"],
        ["Information", "info"],
        ["Accent", "accent"],
      ].map(([label, key]) => (
        <div
          key={key}
          className="rounded-card px-4 py-3 text-sm font-semibold"
          style={{
            background: `var(--gd-${key}-soft)`,
            color: `var(--gd-${key}${key === "accent" ? "-500" : ""})`,
          }}
        >
          {label} — le texte doit rester lisible sur son fond doux, dans les deux thèmes.
        </div>
      ))}
    </div>
  ),
};
