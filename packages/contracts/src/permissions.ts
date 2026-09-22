import { z } from "zod";

/** Liste exhaustive des permissions par serveur. Source de vérité pour l'API et l'UI. */
export const SERVER_PERMISSIONS = [
  "console.read",
  "console.send",
  "power.start",
  "power.stop",
  "power.restart",
  "power.kill",
  "files.read",
  "files.write",
  "files.delete",
  "files.archive",
  "files.sftp",
  "backups.read",
  "backups.create",
  // Distincte de la lecture : une archive contient tout le serveur, fichiers de
  // configuration compris — donc ses mots de passe RCON et ses clés d'API.
  // Voir la liste des sauvegardes et pouvoir les emporter ne sont pas le même
  // droit.
  "backups.download",
  "backups.restore",
  "backups.delete",
  "databases.read",
  "databases.create",
  "databases.update",
  "databases.delete",
  "schedules.read",
  "schedules.create",
  "schedules.update",
  "schedules.delete",
  "subusers.read",
  "subusers.create",
  "subusers.update",
  "subusers.delete",
  "allocations.read",
  "allocations.create",
  "allocations.update",
  "allocations.delete",
  "startup.read",
  "startup.update",
  "startup.docker-image",
  "settings.rename",
  "settings.reinstall",
  "activity.read",
  // Rappels sortants du client : son propre point d'entrée, sur son serveur.
  "webhooks.read",
  "webhooks.manage",
] as const;

export const ServerPermission = z.enum(SERVER_PERMISSIONS);
export type ServerPermission = z.infer<typeof ServerPermission>;

export const SubuserRolePreset = z.enum(["viewer", "moderator", "developer", "owner"]);
export type SubuserRolePreset = z.infer<typeof SubuserRolePreset>;

export const ROLE_PRESETS: Record<SubuserRolePreset, readonly ServerPermission[]> = {
  viewer: ["console.read", "files.read", "backups.read", "activity.read"],
  moderator: [
    "console.read",
    "console.send",
    "power.start",
    "power.stop",
    "power.restart",
    "files.read",
    "backups.read",
    "activity.read",
  ],
  developer: SERVER_PERMISSIONS.filter(
    (p) => !p.startsWith("subusers.") && p !== "settings.reinstall",
  ),
  owner: SERVER_PERMISSIONS,
};

export function hasPermission(
  granted: readonly ServerPermission[],
  required: ServerPermission,
): boolean {
  return granted.includes(required);
}

/**
 * Catalogue des permissions, groupé pour l'affichage.
 *
 * Il vit ici et non dans l'interface : une permission ajoutée à
 * `SERVER_PERMISSIONS` sans entrée ici serait vérifiable par l'API mais
 * impossible à accorder depuis l'écran — donc inutilisable, sans qu'aucune
 * erreur ne le signale. Le test associé interdit ce cas.
 */
export interface PermissionDescriptor {
  value: ServerPermission;
  label: string;
  /** Présent quand l'intitulé seul induirait en erreur sur la portée réelle. */
  warning?: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  description?: string;
  permissions: PermissionDescriptor[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: "console",
    label: "Console",
    description: "Lecture de la sortie et envoi de commandes.",
    permissions: [
      { value: "console.read", label: "Voir la console" },
      {
        value: "console.send",
        label: "Envoyer des commandes",
        warning: "Une commande de jeu peut donner les pleins pouvoirs dans le jeu.",
      },
    ],
  },
  {
    key: "power",
    label: "Alimentation",
    permissions: [
      { value: "power.start", label: "Démarrer" },
      { value: "power.stop", label: "Arrêter" },
      { value: "power.restart", label: "Redémarrer" },
      {
        value: "power.kill",
        label: "Tuer le processus",
        warning: "Interrompt le serveur sans sauvegarde : la progression en cours est perdue.",
      },
    ],
  },
  {
    key: "files",
    label: "Fichiers",
    permissions: [
      { value: "files.read", label: "Lire et télécharger" },
      { value: "files.write", label: "Créer et modifier" },
      {
        value: "files.delete",
        label: "Supprimer",
        warning: "Aucune corbeille : un dossier supprimé emporte les mondes qu'il contient.",
      },
      { value: "files.archive", label: "Archiver et extraire" },
      {
        value: "files.sftp",
        label: "Accès SFTP",
        warning: "Contourne l'interface : les fichiers deviennent accessibles hors du panel.",
      },
    ],
  },
  {
    key: "backups",
    label: "Sauvegardes",
    permissions: [
      { value: "backups.read", label: "Lister" },
      { value: "backups.create", label: "Créer" },
      {
        value: "backups.download",
        label: "Télécharger",
        warning:
          "L'archive contient tout le serveur, mots de passe des fichiers de configuration compris.",
      },
      {
        value: "backups.restore",
        label: "Restaurer",
        warning: "Réécrit les fichiers du serveur par ceux de l'archive.",
      },
      { value: "backups.delete", label: "Supprimer et verrouiller" },
    ],
  },
  {
    key: "databases",
    label: "Bases de données",
    permissions: [
      { value: "databases.read", label: "Voir les coordonnées" },
      { value: "databases.create", label: "Créer" },
      { value: "databases.update", label: "Voir et changer le mot de passe" },
      { value: "databases.delete", label: "Supprimer" },
    ],
  },
  {
    key: "schedules",
    label: "Planification",
    permissions: [
      { value: "schedules.read", label: "Lister" },
      { value: "schedules.create", label: "Créer" },
      { value: "schedules.update", label: "Modifier" },
      { value: "schedules.delete", label: "Supprimer" },
    ],
  },
  {
    key: "allocations",
    label: "Réseau",
    permissions: [
      { value: "allocations.read", label: "Voir les ports" },
      { value: "allocations.create", label: "Attribuer un port" },
      { value: "allocations.update", label: "Annoter et définir le port principal" },
      { value: "allocations.delete", label: "Libérer un port" },
    ],
  },
  {
    key: "startup",
    label: "Démarrage",
    permissions: [
      { value: "startup.read", label: "Voir les variables" },
      {
        value: "startup.update",
        label: "Modifier les variables",
        warning: "Les variables contiennent souvent des mots de passe RCON et des clés d'API.",
      },
      { value: "startup.docker-image", label: "Changer l'image Docker" },
    ],
  },
  {
    key: "subusers",
    label: "Accès",
    description: "Gestion des personnes ayant accès au serveur.",
    permissions: [
      { value: "subusers.read", label: "Lister les sous-utilisateurs" },
      {
        value: "subusers.create",
        label: "Inviter",
        warning: "Permet de partager l'accès au serveur avec de nouvelles personnes.",
      },
      { value: "subusers.update", label: "Modifier les permissions" },
      { value: "subusers.delete", label: "Retirer un accès" },
    ],
  },
  {
    key: "settings",
    label: "Paramètres",
    permissions: [
      { value: "settings.rename", label: "Renommer le serveur" },
      {
        value: "settings.reinstall",
        label: "Réinstaller",
        warning: "Réexécute le script d'installation : les fichiers du serveur sont écrasés.",
      },
      { value: "activity.read", label: "Consulter le journal d'activité" },
    ],
  },
  {
    key: "webhooks",
    label: "Rappels sortants",
    description:
      "Prévenir une adresse — un salon Discord, par exemple — quand quelque chose arrive au serveur.",
    permissions: [
      { value: "webhooks.read", label: "Voir les rappels et leur historique" },
      {
        value: "webhooks.manage",
        label: "Déclarer, modifier et supprimer",
        warning: "Le contenu des rappels part vers une adresse choisie par celui qui la déclare.",
      },
    ],
  },
];

/**
 * Ce qu'un compte d'assistance peut faire sur un serveur qu'il ne possède pas.
 *
 * **En lecture seule, et c'est le point.** Diagnostiquer demande de voir la
 * console, les fichiers et les sauvegardes ; cela ne demande ni d'écrire, ni de
 * supprimer, ni d'inviter quelqu'un. Un incident résolu en modifiant le serveur
 * d'un client à son insu est un incident qu'on ne peut plus lui expliquer.
 *
 * `console.send` en est volontairement absent : envoyer une commande dans une
 * console de jeu, c'est agir sur le serveur, pas l'observer. Un administrateur
 * peut le faire ; l'assistance passe par lui.
 *
 * Les actions d'alimentation le sont aussi. Redémarrer coupe les joueurs
 * connectés — c'est une décision qui appartient au client ou à l'hébergeur.
 */
export const SUPPORT_SERVER_PERMISSIONS: readonly ServerPermission[] = [
  "console.read",
  "files.read",
  "backups.read",
  "databases.read",
  "schedules.read",
  "subusers.read",
  "allocations.read",
  "startup.read",
  "activity.read",
  // L'assistance peut constater qu'un rappel n'arrive pas ; elle ne déclare
  // pas d'adresse à la place du client.
  "webhooks.read",
];

/** Une permission est-elle dans ce que l'assistance peut exercer ? */
export function isSupportPermission(permission: ServerPermission): boolean {
  return SUPPORT_SERVER_PERMISSIONS.includes(permission);
}
