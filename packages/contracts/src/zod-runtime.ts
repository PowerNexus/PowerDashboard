import { z } from "zod";

/**
 * Empêche Zod de tenter de compiler ses validateurs **dans le navigateur**.
 *
 * Zod 4 accélère la validation en fabriquant des fonctions avec `Function(…)`.
 * Pour savoir s'il en a le droit, il exécute `Function("")` dans un
 * `try/catch` au chargement du module. Sous notre politique de sécurité de
 * contenu, `'unsafe-eval'` est absent en production : l'appel échoue, Zod
 * bascule proprement sur son chemin interprété, et **rien ne casse**.
 *
 * Ce qui casse, c'est la console du navigateur : chaque chargement de page y
 * écrit une violation CSP. Une console qui crie à tort finit par ne plus être
 * lue, et c'est là que passera la vraie violation — celle d'un script
 * injecté.
 *
 * On le dit donc à Zod plutôt que de le laisser essayer. `'unsafe-eval'`
 * n'est pas ajouté à la politique : ce serait rouvrir, pour une optimisation
 * de validation, la porte que la politique existe pour fermer.
 *
 * **Côté serveur, la compilation reste active.** L'API valide chaque requête
 * entrante et chaque compte rendu de daemon ; elle n'a aucune politique de
 * sécurité de contenu à respecter, et y renoncer coûterait du temps machine
 * pour rien.
 */
/*
 * `globalThis.window` et non `window` : ce module est compilé aussi pour
 * l'API, dont la configuration TypeScript ne déclare pas les types du
 * navigateur. Écrire `window` nu y fait échouer la vérification sur un nom
 * introuvable — alors que la ligne existe précisément pour n'agir *que* dans
 * un navigateur.
 */
if (typeof globalThis !== "undefined" && "window" in globalThis) {
  z.config({ jitless: true });
}
