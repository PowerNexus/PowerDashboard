/**
 * État de garde des images de marque d'un formulaire : la « base » de chaque
 * champ d'image (la dernière valeur vue côté serveur) et les champs que le
 * dernier enregistrement a gardés.
 *
 * Tenu hors des composants pour que ses transitions se testent sans rendu :
 * le revendeur (`reseller-branding.tsx`) et la plateforme
 * (`admin-settings.tsx`) suivent exactement les mêmes.
 */
export interface BrandImageGuard<K extends string> {
  bases: Record<K, string>;
  kept: K[];
}

/** À l'ouverture : la base est la valeur chargée, rien n'est gardé. */
export function openGuard<K extends string>(initial: Record<K, string>): BrandImageGuard<K> {
  return { bases: { ...initial }, kept: [] };
}

/**
 * Un envoi réussi : l'API a déjà écrit le champ, c'est la nouvelle base. Le
 * bandeau « image gardée » ne dit plus rien de vrai : il s'efface.
 */
export function afterUpload<K extends string>(
  guard: BrandImageGuard<K>,
  key: K,
  url: string,
): BrandImageGuard<K> {
  return { bases: { ...guard.bases, [key]: url }, kept: [] };
}

/** Un enregistrement réussi : bases recalées sur ce que le serveur a gardé. */
export function afterSave<K extends string>(
  guard: BrandImageGuard<K>,
  stored: Partial<Record<K, string>>,
  kept: readonly K[],
): BrandImageGuard<K> {
  return { bases: { ...guard.bases, ...stored }, kept: [...kept] };
}
