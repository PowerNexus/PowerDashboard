"use client";

import {
  AlertBanner,
  Badge,
  Button,
  Dialog,
  DialogContent,
  FormField,
  Input,
  SelectMenu,
} from "@gamedashboard/ui";
import { FolderTree, MapPin, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import {
  createLocation,
  createNodeCategory,
  createNodeSubcategory,
  removeLocation,
  removeNodeCategory,
  removeNodeSubcategory,
} from "@/server/api/admin-actions";

/**
 * Classement du parc, et localisations.
 *
 * Les deux vivent dans la même fenêtre parce qu'on les remplit au même moment :
 * avant de déclarer la première machine. Les séparer obligerait à faire deux
 * fois le chemin depuis la liste des nodes.
 *
 * Supprimer une catégorie ne touche **pas** les machines qui la portaient :
 * elles passent en « Non classé » et retrouvent leur place si on la recrée. Le
 * nombre affiché en regard dit combien seront déclassées, avant de cliquer.
 */
export function AdminNodeTaxonomyDialog({
  taxonomy,
  locations,
}: {
  taxonomy: AdminNodeTaxonomy;
  locations: AdminLocation[];
}) {
  const t = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categoryName, setCategoryName] = useState("");
  const [subcategoryName, setSubcategoryName] = useState("");
  const [parentId, setParentId] = useState(taxonomy.categories[0]?.id ?? "");
  const [short, setShort] = useState("");
  const [long, setLong] = useState("");
  const [countryCode, setCountryCode] = useState("FR");

  const run = (action: () => Promise<{ error: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (!result.error) {
        after?.();
        router.refresh();
      }
    });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FolderTree /> {t("manageTaxonomy")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("manageTaxonomy")} description={t("manageTaxonomyHint")}>
          <div className="flex flex-col gap-6">
            {error ? (
              <AlertBanner variant="danger" title={tc("actionRefused")}>
                {error}
              </AlertBanner>
            ) : null}

            {/* --- Catégories --- */}
            <section className="flex flex-col gap-3">
              <h3 className="font-semibold text-fg text-sm">{t("categories")}</h3>

              {taxonomy.categories.map((category) => (
                <div key={category.id} className="rounded-field border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-fg text-sm">{category.name}</span>
                    <Badge variant="neutral">{t("groupServers", { count: category.nodes })}</Badge>
                    <span className="gd-mono text-faint text-xs">{category.id}</span>
                    <Button
                      className="ml-auto"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={t("removeCategory", { name: category.name })}
                      onClick={() => run(() => removeNodeCategory(category.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {taxonomy.subcategories
                      .filter((sub) => sub.categoryId === category.id)
                      .map((sub) => (
                        <span
                          key={sub.id}
                          className="inline-flex items-center gap-1.5 rounded-field border border-border px-2 py-1 text-xs"
                        >
                          {sub.name}
                          <span className="text-faint">({sub.nodes})</span>
                          <button
                            type="button"
                            disabled={pending}
                            aria-label={t("removeSubcategory", { name: sub.name })}
                            className="cursor-pointer text-muted hover:text-danger-ink"
                            onClick={() => run(() => removeNodeSubcategory(sub.id))}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-end gap-2">
                <FormField className="min-w-48 flex-1" label={t("newCategory")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={categoryName}
                      onChange={(e) => setCategoryName(e.target.value)}
                      placeholder="Serveurs de jeu"
                    />
                  )}
                </FormField>
                <Button
                  variant="secondary"
                  disabled={pending || categoryName.trim() === ""}
                  onClick={() =>
                    run(
                      () => createNodeCategory(categoryName, ""),
                      () => setCategoryName(""),
                    )
                  }
                >
                  <Plus /> {t("add")}
                </Button>
              </div>

              {taxonomy.categories.length > 0 ? (
                <div className="flex flex-wrap items-end gap-2">
                  <FormField className="min-w-40" label={t("parentCategory")}>
                    {(id) => (
                      <SelectMenu
                        id={id}
                        value={parentId}
                        onValueChange={setParentId}
                        options={taxonomy.categories.map((c) => ({ value: c.id, label: c.name }))}
                      />
                    )}
                  </FormField>
                  <FormField className="min-w-48 flex-1" label={t("newSubcategory")}>
                    {(id) => (
                      <Input
                        id={id}
                        value={subcategoryName}
                        onChange={(e) => setSubcategoryName(e.target.value)}
                        placeholder="Gravelines"
                      />
                    )}
                  </FormField>
                  <Button
                    variant="secondary"
                    disabled={pending || subcategoryName.trim() === "" || parentId === ""}
                    onClick={() =>
                      run(
                        () => createNodeSubcategory(parentId, subcategoryName),
                        () => setSubcategoryName(""),
                      )
                    }
                  >
                    <Plus /> {t("add")}
                  </Button>
                </div>
              ) : null}
            </section>

            {/* --- Localisations --- */}
            <section className="flex flex-col gap-3 border-border border-t pt-5">
              <h3 className="flex items-center gap-2 font-semibold text-fg text-sm">
                <MapPin className="size-4" /> {t("locations")}
              </h3>
              <p className="text-muted text-xs">{t("locationsHint")}</p>

              {locations.map((location) => (
                <div
                  key={location.id}
                  className="flex flex-wrap items-center gap-2 rounded-field border border-border px-3 py-2"
                >
                  <Badge variant="accent">{location.short}</Badge>
                  <span className="text-fg text-sm">{location.long}</span>
                  <span className="text-faint text-xs">{location.countryCode}</span>
                  <Button
                    className="ml-auto"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={t("removeLocation", { name: location.short })}
                    onClick={() => run(() => removeLocation(location.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}

              <div className="flex flex-wrap items-end gap-2">
                <FormField className="w-28" label={t("locationShort")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={short}
                      onChange={(e) => setShort(e.target.value)}
                      placeholder="GRA"
                    />
                  )}
                </FormField>
                <FormField className="min-w-40 flex-1" label={t("locationLong")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={long}
                      onChange={(e) => setLong(e.target.value)}
                      placeholder="Gravelines"
                    />
                  )}
                </FormField>
                <FormField className="w-24" label={t("locationCountry")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      placeholder="FR"
                      maxLength={2}
                    />
                  )}
                </FormField>
                <Button
                  variant="secondary"
                  disabled={pending || short.trim() === "" || long.trim() === ""}
                  onClick={() =>
                    run(
                      () => createLocation({ short, long, countryCode }),
                      () => {
                        setShort("");
                        setLong("");
                      },
                    )
                  }
                >
                  <Plus /> {t("add")}
                </Button>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
