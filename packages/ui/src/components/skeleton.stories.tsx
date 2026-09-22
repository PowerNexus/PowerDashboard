import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card, CardBody, CardHeader } from "./card";
import { Skeleton } from "./skeleton";

const meta = {
  title: "Atomes/Skeleton",
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {
  render: () => <Skeleton className="h-11 w-80" />,
};

/**
 * Un squelette n'a de sens qu'à la **forme de ce qu'il remplace**.
 *
 * Trois barres au hasard font voir que quelque chose charge ; des barres à la
 * taille des vraies lignes évitent en plus que la page saute au moment où le
 * contenu arrive. C'est ce saut qui fait cliquer au mauvais endroit.
 */
export const ALaFormeDuContenu: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-4">
      <Card>
        <CardHeader title="Chargement…" />
        <CardBody className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  ),
};
