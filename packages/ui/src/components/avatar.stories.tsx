import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./avatar";

const meta = {
  title: "Atomes/Avatar",
  component: Avatar,
  args: { name: "Alex Martin" },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initiales: Story = {};

export const Tailles: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="Alex Martin" size="sm" />
      <Avatar name="Alex Martin" size="md" />
      <Avatar name="Alex Martin" size="lg" />
    </div>
  ),
};

/**
 * Ce qu'on voit le plus souvent : aucune image.
 *
 * La plupart des comptes n'en posent jamais. Les initiales ne sont donc pas un
 * repli mais le cas courant — et c'est pourquoi elles doivent rester lisibles
 * et distinctes d'un compte à l'autre.
 */
export const NomsVaries: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {["Alex Martin", "Zoé", "jean-pierre dupont", "李明", "Ω"].map((name) => (
        <Avatar key={name} name={name} />
      ))}
    </div>
  ),
};

export const AvecImage: Story = {
  args: { src: "/brand/gamedashboard-logo.webp" },
};
