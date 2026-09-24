import type { Meta, StoryObj } from "@storybook/react-vite";
import { PasswordStrengthMeter } from "./password-strength";

const meta = {
  title: "Molécules/PasswordStrengthMeter",
  component: PasswordStrengthMeter,
  args: {
    level: 3,
    tone: "success",
    label: "Bon",
    hint: "vérifié aussi contre les fuites connues",
  },
} satisfies Meta<typeof PasswordStrengthMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

/** Les crans tels que la politique les donne : refus, puis trois acceptations. */
export const Crans: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <PasswordStrengthMeter
        level={1}
        tone="danger"
        label="Trop court"
        hint="encore 5 caractères"
      />
      <PasswordStrengthMeter
        level={1}
        tone="danger"
        label="Refusé"
        hint="il contient votre nom ou votre adresse"
      />
      <PasswordStrengthMeter level={2} tone="warning" label="Acceptable" />
      <PasswordStrengthMeter level={3} tone="success" label="Bon" />
      <PasswordStrengthMeter level={4} tone="success" label="Solide" />
    </div>
  ),
};
