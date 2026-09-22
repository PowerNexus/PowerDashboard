import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const meta = {
  title: "Molécules/Tabs",
  component: Tabs,
  /*
   * `Tabs` exige `defaultValue` et `children`. Toutes les histoires ci-dessous
   * composent leur propre arbre par `render` et n'emploient pas ces arguments,
   * mais Storybook les réclame quand même au niveau du type. On les pose ici
   * une fois, plutôt que de les répéter — vides — dans chaque histoire.
   */
  args: { defaultValue: "tout", children: null },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {
  render: () => (
    <Tabs defaultValue="tout" className="max-w-xl">
      <TabsList>
        <TabsTrigger value="tout">Tout</TabsTrigger>
        <TabsTrigger value="systeme">Système</TabsTrigger>
        <TabsTrigger value="serveur">Serveur</TabsTrigger>
      </TabsList>
      <TabsContent value="tout">Toutes les lignes de console.</TabsContent>
      <TabsContent value="systeme">Ce que le daemon dit.</TabsContent>
      <TabsContent value="serveur">Ce que le jeu dit.</TabsContent>
    </Tabs>
  ),
};

/**
 * Les compteurs, tels que l'écran des tickets et des incidents les emploie.
 *
 * Un compteur à zéro est **affiché** plutôt que masqué : « Résolus 0 » dit que
 * la catégorie existe et qu'elle est vide, là où une pilule absente laisse
 * croire qu'on n'a pas fini de charger.
 */
export const AvecCompteurs: Story = {
  render: () => (
    <Tabs defaultValue="cours" className="max-w-xl">
      <TabsList>
        <TabsTrigger value="cours" count={2}>
          En cours
        </TabsTrigger>
        <TabsTrigger value="resolus" count={0}>
          Résolus
        </TabsTrigger>
        <TabsTrigger value="tous" count={2}>
          Tous
        </TabsTrigger>
      </TabsList>
      <TabsContent value="cours">Deux incidents ouverts.</TabsContent>
      <TabsContent value="resolus">Aucun incident résolu.</TabsContent>
      <TabsContent value="tous">Deux incidents au total.</TabsContent>
    </Tabs>
  ),
};

/**
 * Beaucoup d'onglets, sur un écran étroit.
 *
 * C'est le cas qui casse : la liste doit défiler horizontalement plutôt que de
 * se replier sur deux lignes ou de pousser le contenu hors de l'écran.
 */
export const Nombreux: Story = {
  render: () => (
    <div className="max-w-sm">
      <Tabs defaultValue="o1">
        <TabsList>
          {["Console", "Fichiers", "Bases", "Sauvegardes", "Réseau", "Tâches", "Journal"].map(
            (nom, i) => (
              <TabsTrigger key={nom} value={`o${i + 1}`}>
                {nom}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        <TabsContent value="o1">Premier onglet.</TabsContent>
      </Tabs>
    </div>
  ),
};
