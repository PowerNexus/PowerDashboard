import { z } from "zod";
import { rulesProblem, rulesRequireValue, validateVariableValue } from "./egg-rules";

/**
 * Éditeur d'egg : ce qu'un administrateur peut enregistrer, et ce qu'on lui
 * refuse.
 *
 * Deux étages, parce que deux questions différentes :
 *
 * 1. **Le brouillon est-il bien formé ?** (`EggDraft`, `eggDraftProblems`) —
 *    répondu sans la base, donc aussi dans le navigateur, champ par champ,
 *    avant tout envoi. L'API refait exactement la même vérification : l'écran
 *    ne fait qu'avertir plus tôt.
 * 2. **Le changement est-il sûr pour les serveurs qui tournent ?**
 *    (`eggChangeRefusals`) — il faut connaître les valeurs posées sur chaque
 *    serveur, donc la base. C'est l'API qui tranche.
 *
 * Les messages sont des **codes**, pas des phrases : l'écran les traduit
 * (`adminEggEditor.problems.*`), l'API les rend en français
 * (`eggProblemMessage`). Une phrase figée ici ne serait lisible que dans une
 * langue.
 */

/**
 * Variables que le panel pose lui-même au démarrage.
 *
 * `environmentFor()` (module distant) les écrit **par-dessus** celles de
 * l'egg : une variable d'egg portant l'un de ces noms serait silencieusement
 * écrasée, et l'administrateur chercherait pourquoi sa valeur ne s'applique
 * jamais.
 */
export const EGG_RESERVED_VARIABLES = [
  "STARTUP",
  "SERVER_MEMORY",
  "SERVER_IP",
  "SERVER_PORT",
  "P_SERVER_UUID",
  "P_SERVER_ALLOCATION_LIMIT",
] as const;

/** Nom de variable d'environnement : ce que `sh` et Docker acceptent. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Un bloc de configuration saisi en texte doit être un objet JSON. */
function isJsonObject(text: string): boolean {
  if (text.trim() === "") return true;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

export const EggVariableDraft = z
  .object({
    /** `null` : variable nouvelle. Sinon, l'identifiant de la variable existante. */
    id: z.string().uuid("unknownVariable").nullable(),
    name: z.string().trim().min(1, "required").max(120, "tooLong"),
    envVariable: z
      .string()
      .trim()
      .min(1, "required")
      .max(120, "tooLong")
      .regex(ENV_NAME, "envFormat")
      .refine(
        (name) => !(EGG_RESERVED_VARIABLES as readonly string[]).includes(name.toUpperCase()),
        "envReserved",
      ),
    description: z.string().max(2000, "tooLong"),
    defaultValue: z.string().max(10_000, "tooLong"),
    userViewable: z.boolean(),
    userEditable: z.boolean(),
    rules: z.string().trim().max(20_000, "tooLong"),
  })
  .superRefine((variable, ctx) => {
    const problem = rulesProblem(variable.rules);
    if (problem) {
      ctx.addIssue({ code: "custom", path: ["rules"], message: problem.code, params: problem });
      return;
    }
    /*
     * Une valeur par défaut que ses propres règles refusent.
     *
     * Chaque serveur créé la recevrait, et le client ne pourrait plus
     * enregistrer ses réglages sans d'abord la corriger — pour une erreur qui
     * n'est pas la sienne. Vide, elle relève de `required` et des serveurs en
     * service, que `eggChangeRefusals` examine.
     */
    if (
      variable.defaultValue !== "" &&
      validateVariableValue(variable.rules, variable.defaultValue) !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "defaultBreaksRules",
        params: { reason: validateVariableValue(variable.rules, variable.defaultValue) ?? "" },
      });
    }
    // Modifiable mais invisible : le client ne verrait jamais le champ qu'on
    // lui ouvre. Pterodactyl l'accepte ; c'est toujours une erreur de saisie.
    if (variable.userEditable && !variable.userViewable) {
      ctx.addIssue({ code: "custom", path: ["userEditable"], message: "editableHidden" });
    }
  });
export type EggVariableDraft = z.infer<typeof EggVariableDraft>;

export const EggDraft = z
  .object({
    name: z.string().trim().min(1, "required").max(120, "tooLong"),
    description: z.string().max(5000, "tooLong"),
    author: z.string().trim().max(255, "tooLong"),
    /**
     * Images proposées, **dans l'ordre**. Une liste plutôt qu'un objet : la
     * première est celle d'un nouveau serveur, et l'écran doit pouvoir la
     * déplacer. Convertie en `{ libellé: image }` à l'enregistrement.
     */
    dockerImages: z
      .array(
        z.object({
          label: z.string().trim().min(1, "required").max(100, "tooLong"),
          image: z.string().trim().min(1, "required").max(255, "tooLong"),
        }),
      )
      .min(1, "imagesEmpty")
      .max(20, "tooMany"),
    startup: z.string().trim().min(1, "required").max(10_000, "tooLong"),
    configStop: z.string().trim().max(255, "tooLong"),
    configStartup: z.string().refine(isJsonObject, "jsonObject"),
    configFiles: z.string().refine(isJsonObject, "jsonObject"),
    configLogs: z.string().refine(isJsonObject, "jsonObject"),
    installContainer: z.string().trim().min(1, "required").max(255, "tooLong"),
    installEntrypoint: z.string().trim().min(1, "required").max(64, "tooLong"),
    installScript: z.string().max(512 * 1024, "tooLong"),
    features: z.array(z.string().trim().min(1, "required").max(100, "tooLong")).max(50, "tooMany"),
    fileDenylist: z
      .array(z.string().trim().min(1, "required").max(255, "tooLong"))
      .max(200, "tooMany"),
    variables: z.array(EggVariableDraft).max(100, "tooMany"),
  })
  .superRefine((draft, ctx) => {
    // Deux libellés identiques s'écraseraient une fois l'objet reconstruit.
    const labels = new Set<string>();
    draft.dockerImages.forEach((entry, index) => {
      if (labels.has(entry.label)) {
        ctx.addIssue({
          code: "custom",
          path: ["dockerImages", index, "label"],
          message: "duplicate",
        });
      }
      labels.add(entry.label);
    });
    // La base porte une contrainte d'unicité, et deux variables du même nom
    // se disputeraient la même entrée de l'environnement du conteneur.
    const names = new Set<string>();
    draft.variables.forEach((variable, index) => {
      if (names.has(variable.envVariable)) {
        ctx.addIssue({
          code: "custom",
          path: ["variables", index, "envVariable"],
          message: "duplicate",
        });
      }
      names.add(variable.envVariable);
    });
  });
export type EggDraft = z.infer<typeof EggDraft>;

/** Un défaut du brouillon, rattaché à son champ (`variables.2.rules`). */
export interface EggDraftProblem {
  path: string;
  code: string;
  params: Record<string, string | number>;
}

/** Tous les défauts du brouillon, ou une liste vide. */
export function eggDraftProblems(input: unknown): EggDraftProblem[] {
  const parsed = EggDraft.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const params: Record<string, string | number> = {};
    const extra = (issue as { params?: Record<string, unknown> }).params ?? {};
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === "string" || typeof value === "number") params[key] = value;
    }
    const maximum = (issue as { maximum?: unknown }).maximum;
    if (typeof maximum === "number" || typeof maximum === "bigint") params.max = Number(maximum);
    return {
      path: issue.path.map(String).join("."),
      // Un type faux (un nombre à la place d'une chaîne) n'a pas de code à
      // nous : c'est un appel qui ne vient pas de l'écran.
      code: issue.code === "invalid_type" ? "invalidType" : issue.message,
      params,
    };
  });
}

/**
 * Commande de démarrage telle que Wings la lancera, variables remplacées.
 *
 * Remplace `{{NOM}}` et `${NOM}` par la valeur par défaut de la variable ; ce
 * que le panel calcule lui-même (port, mémoire) est laissé en place, puisqu'il
 * dépend du serveur. Une variable inconnue est laissée telle quelle, et
 * c'est voulu : c'est exactement ce que l'aperçu doit montrer.
 */
export function previewStartup(
  startup: string,
  variables: readonly { envVariable: string; defaultValue: string }[],
): string {
  const values = new Map(variables.map((v) => [v.envVariable, v.defaultValue]));
  return startup.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (whole, a, b) => {
      const name = (a ?? b) as string;
      return values.has(name) ? (values.get(name) ?? "") : whole;
    },
  );
}

/* --- Sûreté pour les serveurs en service --------------------------------- */

/** Une variable telle qu'elle est en base, avec les valeurs des serveurs. */
export interface StoredEggVariable {
  id: string;
  envVariable: string;
  rules: string;
  defaultValue: string;
  /** Valeur posée sur chaque serveur qui l'emploie. Vide : variable inutilisée. */
  serverValues: readonly string[];
}

export type EggChangeRefusal =
  | { code: "variableInUseRemoved"; envVariable: string; servers: number }
  | { code: "variableInUseRenamed"; envVariable: string; servers: number }
  | { code: "requiredWithoutDefault"; envVariable: string; servers: number }
  | { code: "valuesBreakRules"; envVariable: string; servers: number }
  | { code: "unknownVariable"; envVariable: string; servers: number };

/**
 * Ce qu'on refuse de changer sur un egg employé par des serveurs.
 *
 * L'egg reste modifiable : on corrige une image, un script, une description
 * sans rien demander à personne. Ce qui est refusé, c'est ce qui casserait un
 * serveur **déjà en service** sans que son propriétaire n'y soit pour rien :
 *
 * - **retirer une variable employée**. La commande de démarrage de chaque
 *   serveur est recopiée à sa création et peut citer `{{VAR}}` ; retirée,
 *   la variable disparaît de l'environnement et le conteneur démarre avec
 *   `{{VAR}}` littéral. La valeur choisie par le client serait perdue avec.
 *   Pour la cacher, on la rend invisible ; pour la retirer, on migre d'abord
 *   les serveurs vers un autre egg.
 * - **renommer une variable employée**, pour la même raison : c'est un
 *   retrait suivi d'un ajout.
 * - **rendre une variable obligatoire sans valeur par défaut** (ou ajouter
 *   une variable obligatoire vide) sur un egg employé : les serveurs existants
 *   recevraient une valeur vide que la règle refuse, et le client ne pourrait
 *   plus rien enregistrer dans ses réglages de démarrage.
 * - **durcir les règles** au point que des valeurs déjà posées ne passent
 *   plus : même effet, pour les serveurs concernés, dont on donne le nombre.
 *
 * Seules les variables **touchées** (nouvelles, ou dont les règles ou la
 * valeur par défaut changent) sont examinées sur ces deux derniers points :
 * un egg importé porte parfois une variable obligatoire vide, et corriger sa
 * description ne doit pas obliger à réparer ce qu'on n'a pas touché.
 */
export function eggChangeRefusals(
  stored: readonly StoredEggVariable[],
  draft: readonly Pick<EggVariableDraft, "id" | "envVariable" | "rules" | "defaultValue">[],
  eggServers: number,
): EggChangeRefusal[] {
  const refusals: EggChangeRefusal[] = [];
  const byId = new Map(stored.map((variable) => [variable.id, variable]));
  const kept = new Set(draft.flatMap((variable) => (variable.id ? [variable.id] : [])));

  for (const variable of stored) {
    if (!kept.has(variable.id) && variable.serverValues.length > 0) {
      refusals.push({
        code: "variableInUseRemoved",
        envVariable: variable.envVariable,
        servers: variable.serverValues.length,
      });
    }
  }

  for (const variable of draft) {
    const before = variable.id ? byId.get(variable.id) : undefined;
    if (variable.id && !before) {
      refusals.push({ code: "unknownVariable", envVariable: variable.envVariable, servers: 0 });
      continue;
    }

    if (before && before.envVariable !== variable.envVariable && before.serverValues.length > 0) {
      refusals.push({
        code: "variableInUseRenamed",
        envVariable: before.envVariable,
        servers: before.serverValues.length,
      });
      continue;
    }

    const touched =
      !before || before.rules !== variable.rules || before.defaultValue !== variable.defaultValue;
    if (!touched) continue;

    if (eggServers > 0 && variable.defaultValue === "" && rulesRequireValue(variable.rules)) {
      refusals.push({
        code: "requiredWithoutDefault",
        envVariable: variable.envVariable,
        servers: eggServers,
      });
      continue;
    }

    if (before && before.rules !== variable.rules) {
      const broken = before.serverValues.filter(
        (value) => validateVariableValue(variable.rules, value) !== null,
      ).length;
      if (broken > 0) {
        refusals.push({
          code: "valuesBreakRules",
          envVariable: variable.envVariable,
          servers: broken,
        });
      }
    }
  }

  return refusals;
}

/* --- Messages de l'API ---------------------------------------------------- */

const DRAFT_MESSAGES: Record<string, (params: Record<string, string | number>) => string> = {
  required: () => "ce champ est obligatoire",
  tooLong: (p) => `trop long (${p.max ?? "?"} au plus)`,
  tooMany: (p) => `trop d'éléments (${p.max ?? "?"} au plus)`,
  invalidType: () => "type de valeur inattendu",
  envFormat: () => "lettres, chiffres et « _ » seulement, sans chiffre en tête",
  envReserved: () => "nom réservé : le panel pose lui-même cette variable",
  duplicate: () => "déjà employé plus haut",
  imagesEmpty: () => "au moins une image Docker est nécessaire",
  jsonObject: () => "un objet JSON est attendu, par exemple {}",
  unknownVariable: () => "variable inconnue sur cet egg",
  defaultBreaksRules: (p) => `la valeur par défaut ne respecte pas les règles (${p.reason ?? ""})`,
  editableHidden: () => "une variable modifiable par le client doit lui être visible",
  rulesEmpty: () => "indiquez au moins une règle, par exemple required|string",
  ruleUnknown: (p) => `règle « ${p.rule ?? ""} » inconnue du panel`,
  ruleNeedsNumber: (p) => `la règle « ${p.rule ?? ""} » attend un nombre, par exemple max:20`,
  ruleNeedsTwoNumbers: () => "la règle « between » attend deux nombres, par exemple between:1,10",
  ruleInEmpty: () => "la règle « in » attend une liste, par exemple in:oui,non",
  ruleRegexInvalid: () => "expression régulière illisible, par exemple regex:/^[a-z]+$/",
};

/** Un défaut du brouillon, en français, pour une réponse de l'API. */
export function eggProblemMessage(problem: EggDraftProblem): string {
  const render = DRAFT_MESSAGES[problem.code];
  return `${problem.path || "egg"} : ${render ? render(problem.params) : problem.code}`;
}

/** Un refus de changement, en français, pour une réponse de l'API. */
export function eggRefusalMessage(refusal: EggChangeRefusal): string {
  const { envVariable: name, servers } = refusal;
  switch (refusal.code) {
    case "variableInUseRemoved":
      return `« ${name} » est employée par ${servers} serveur(s) : la retirer effacerait leur valeur et laisserait {{${name}}} tel quel dans leur commande de démarrage. Rendez-la invisible pour le client plutôt que de la supprimer.`;
    case "variableInUseRenamed":
      return `« ${name} » est employée par ${servers} serveur(s) : la renommer revient à la retirer. Ajoutez une nouvelle variable plutôt que de renommer celle-ci.`;
    case "requiredWithoutDefault":
      return `« ${name} » serait obligatoire sans valeur par défaut alors que ${servers} serveur(s) emploient cet egg : donnez-lui une valeur par défaut que ses règles acceptent.`;
    case "valuesBreakRules":
      return `Les nouvelles règles de « ${name} » refuseraient la valeur actuelle de ${servers} serveur(s). Assouplissez-les, ou corrigez d'abord ces serveurs.`;
    case "unknownVariable":
      return `« ${name} » ne correspond à aucune variable de cet egg. Rechargez la page.`;
  }
}
