import { NavigationPending, Skeleton } from "@gamedashboard/ui";

/**
 * Ce qui s'affiche dans la zone de contenu pendant qu'une page du panel se
 * charge.
 *
 * Il remplace l'écran de démarrage, qui tenait ce rôle et le tenait mal : une
 * animation de marque plein écran à chaque clic de menu donne l'impression que
 * l'application redémarre. La coquille — header, menu, nom du compte — reste
 * en place ; seule la zone de contenu attend.
 *
 * Le squelette ne mime aucune page en particulier. Il en dessine la forme
 * commune — un titre, puis des blocs — parce que toutes les pages de ce panel
 * sont bâties ainsi. Prétendre en imiter une précisément produirait un
 * réarrangement visible au moment où la vraie page arrive.
 *
 * `NavigationPending` ne dessine rien : il allume la barre sur le bord du
 * header, qui, elle, est visible depuis n'importe quel endroit de l'écran —
 * y compris quand on a déjà fait défiler la page.
 */
export function PageLoading() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <NavigationPending />

      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56 rounded-md" />
        <Skeleton className="h-4 w-80 rounded-md" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Les clés sont fixes : ces blocs n'ont pas d'identité, ils ne sont ni
            réordonnés ni filtrés. */}
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-28 rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
