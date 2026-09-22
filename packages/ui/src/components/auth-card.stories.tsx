import type { Meta, StoryObj } from "@storybook/react-vite";
import { Mail } from "lucide-react";
import { AuthCard, OAuthButton, OrDivider } from "./auth-card";
import { Button } from "./button";
import { FormField, Input, PasswordInput } from "./input";

const meta = {
  title: "Templates/AuthCard",
  component: AuthCard,
  args: { eyebrow: "Espace client", title: "Connexion", children: null },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AuthCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connexion: Story = {
  render: () => (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <AuthCard
        eyebrow="Espace client"
        title="Connexion"
        description="Ces identifiants diffèrent de ceux du panneau de contrôle du site."
        footer={
          <span className="text-muted text-sm">
            Pas encore de compte ? <span className="text-accent">S'inscrire</span>
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <OAuthButton icon={<Mail />}>Continuer avec Google</OAuthButton>
          <OrDivider>ou avec votre e-mail</OrDivider>
          <FormField label="Adresse e-mail">
            {(id) => <Input id={id} leadingIcon={<Mail />} placeholder="alex@exemple.fr" />}
          </FormField>
          <FormField label="Mot de passe" action={<span className="text-accent">Oublié ?</span>}>
            {(id) => <PasswordInput id={id} placeholder="••••••••••" />}
          </FormField>
          <Button size="lg" fullWidth>
            Connexion
          </Button>
        </div>
      </AuthCard>
    </div>
  ),
};

/**
 * La deuxième preuve.
 *
 * L'écran doit dire **quel compte** attend un code, sans rien donner de plus :
 * à ce stade, aucune session n'est ouverte. Nommer le compte évite de taper le
 * code de la mauvaise application ; en dire davantage renseignerait quelqu'un
 * qui aurait volé le mot de passe.
 */
export const SecondFacteur: Story = {
  render: () => (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <AuthCard
        eyebrow="Vérification"
        title="Seconde preuve exigée"
        description="Saisissez le code à six chiffres de votre application d'authentification."
      >
        <div className="flex flex-col gap-4">
          <FormField label="Code">
            {(id) => <Input id={id} inputMode="numeric" placeholder="123456" className="gd-mono" />}
          </FormField>
          <Button size="lg" fullWidth>
            Vérifier
          </Button>
          <button type="button" className="text-muted text-sm underline-offset-2 hover:underline">
            Employer un code de secours
          </button>
        </div>
      </AuthCard>
    </div>
  ),
};
