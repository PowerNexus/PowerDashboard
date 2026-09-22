/**
 * Vocabulaire du journal d'audit (§5.4).
 *
 * Les noms d'événements sont stockés tels quels en base, pour toujours : ce
 * sont des identifiants, pas des messages. Les renommer réécrirait l'histoire,
 * ou plus exactement la rendrait illisible — les anciennes lignes garderaient
 * l'ancien nom, et plus rien ne les rattacherait aux nouvelles.
 *
 * La traduction en français vit donc à part, et peut changer librement.
 */

export const ACTIVITY_CATEGORIES = [
  "power",
  "console",
  "files",
  "backups",
  "databases",
  "network",
  "access",
  "schedules",
  "settings",
  "account",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

interface ActivityDescriptor {
  category: ActivityCategory;
  label: string;
}

/**
 * Événements connus.
 *
 * Un événement absent de cette table reste **affiché** : le journal est en
 * ajout seul et doit rester lisible même après une mise à jour qui aurait
 * introduit un nom que cette version ne connaît pas. Il apparaît alors sous
 * son identifiant brut, ce qui est laid mais honnête — masquer la ligne
 * reviendrait à effacer une trace d'audit à l'affichage.
 */
export const ACTIVITY_EVENTS: Record<string, ActivityDescriptor> = {
  "server.power": { category: "power", label: "Alimentation" },
  "server.command": { category: "console", label: "Commande envoyée" },
  "server.rename": { category: "settings", label: "Serveur renommé" },
  "server.variables": { category: "settings", label: "Variables de démarrage modifiées" },
  "server.behaviour": { category: "settings", label: "Comportement modifié" },
  "server.reinstall": { category: "settings", label: "Réinstallation lancée" },
  /*
   * Le moteur, et le contrat qui va avec.
   *
   * Les trois sont distincts à dessein. Qui relit ce journal pour savoir
   * pourquoi un serveur ne démarre plus cherche « acceptation », pas
   * « moteur installé » — et l'acceptation et son retrait ne doivent pas
   * se confondre non plus, puisque l'un autorise et l'autre empêche.
   */
  "engine.install": { category: "settings", label: "Moteur du serveur remplacé" },
  "server.eula_accepted": { category: "settings", label: "Contrat de licence accepté" },
  "server.eula_reset": {
    category: "settings",
    label: "Acceptation du contrat retirée (moteur remplacé)",
  },

  "files.write": { category: "files", label: "Fichier enregistré" },
  "files.rename": { category: "files", label: "Fichier renommé" },
  "files.delete": { category: "files", label: "Fichier supprimé" },
  "files.create-directory": { category: "files", label: "Dossier créé" },
  "files.compress": { category: "files", label: "Archive créée" },
  "files.decompress": { category: "files", label: "Archive extraite" },
  // L'autorisation, et non l'envoi : le fichier part du navigateur vers le
  // daemon sans repasser par le panel, qui ne peut donc attester que du droit
  // qu'il a accordé. Le nommer « fichier envoyé » affirmerait ce qu'on ignore.
  "files.upload-grant": { category: "files", label: "Envoi de fichier autorisé" },
  /*
   * Distinct de `files.upload-grant`, et les deux se justifient.
   *
   * L'autorisation dit « quelqu'un a demandé à déposer » — elle est écrite
   * même si rien n'arrive ensuite, parce que le dépôt se fait alors
   * directement chez le daemon, que le panel ne voit pas.
   *
   * Celui-ci dit « un fichier est arrivé, et voici lequel » : c'est le chemin
   * reprenable, où le panel assemble lui-même et sait donc ce qu'il a écrit.
   */
  "files.upload": { category: "files", label: "Fichier envoyé" },
  "files.download": { category: "files", label: "Fichier téléchargé" },
  // Envoyés par le daemon : ils décrivent ce qui s'est passé hors du panel.
  "server:sftp.write": { category: "files", label: "Fichier écrit par SFTP" },
  "server:sftp.delete": { category: "files", label: "Fichier supprimé par SFTP" },
  "server:sftp.create": { category: "files", label: "Fichier créé par SFTP" },
  "server:sftp.create-directory": { category: "files", label: "Dossier créé par SFTP" },
  "server:sftp.rename": { category: "files", label: "Fichier renommé par SFTP" },

  "backup.create": { category: "backups", label: "Sauvegarde lancée" },
  "backup.restore": { category: "backups", label: "Sauvegarde restaurée" },
  "backup.delete": { category: "backups", label: "Sauvegarde supprimée" },
  "backup.lock": { category: "backups", label: "Verrou de sauvegarde modifié" },
  /**
   * Emporter une archive, c'est emporter tout le serveur — fichiers de
   * configuration, mots de passe RCON et clés d'API compris. La route le
   * consignait déjà, et disait en commentaire que c'était « exactement le genre
   * de geste qu'on veut retrouver dans un journal ». Il s'y retrouvait sous son
   * identifiant brut.
   */
  "backup.download": { category: "backups", label: "Sauvegarde téléchargée" },

  "database.create": { category: "databases", label: "Base de données créée" },
  "database.rotate": { category: "databases", label: "Mot de passe de base régénéré" },
  "database.password": { category: "databases", label: "Mot de passe de base consulté" },
  "database.delete": { category: "databases", label: "Base de données supprimée" },

  "allocation.claim": { category: "network", label: "Port attribué" },
  "allocation.primary": { category: "network", label: "Port principal changé" },
  "allocation.notes": { category: "network", label: "Port annoté" },
  "allocation.release": { category: "network", label: "Port libéré" },

  "subuser.invite": { category: "access", label: "Sous-utilisateur invité" },
  "subuser.invite_sent": { category: "access", label: "Invitation envoyée par courriel" },
  "subuser.invite_accepted": { category: "access", label: "Invitation acceptée" },
  "subuser.invite_revoked": { category: "access", label: "Invitation annulée" },
  "subuser.update": { category: "access", label: "Permissions modifiées" },
  "subuser.delete": { category: "access", label: "Accès retiré" },

  "schedule.create": { category: "schedules", label: "Tâche planifiée créée" },
  "schedule.update": { category: "schedules", label: "Tâche planifiée modifiée" },
  "schedule.active": { category: "schedules", label: "Tâche activée ou mise en pause" },
  "schedule.run": { category: "schedules", label: "Exécution immédiate demandée" },
  "schedule.delete": { category: "schedules", label: "Tâche planifiée supprimée" },
  "schedule.failed": { category: "schedules", label: "Exécution planifiée en échec" },

  "marketplace.install": { category: "files", label: "Extension installée" },
  "marketplace.uninstall": { category: "files", label: "Extension désinstallée" },

  /*
   * Rappels sortants déclarés par le client sur son serveur.
   *
   * Classés en `settings` et non en `access` : ils ne donnent aucun droit sur
   * le serveur. Ils envoient de l'information vers l'extérieur, ce qui est une
   * question de configuration — et, pour la régénération du secret, de sécurité
   * du destinataire, pas de l'accès au panel.
   */
  "webhook.create": { category: "settings", label: "Rappel sortant déclaré" },
  "webhook.update": { category: "settings", label: "Rappel sortant modifié" },
  "webhook.rotate": { category: "settings", label: "Secret de rappel renouvelé" },
  "webhook.delete": { category: "settings", label: "Rappel sortant supprimé" },

  /**
   * Événements de compte, sans serveur rattaché.
   *
   * Aucun écran ne les liste encore — le journal visible est celui d'un
   * serveur. Ils sont consignés quand même : le jour où un compte est
   * compromis, la question posée est « quand le mot de passe a-t-il changé, et
   * depuis quelle adresse », et une trace qui commence le jour où on ouvre
   * l'écran ne répond à rien.
   */
  "account.password": { category: "account", label: "Mot de passe modifié" },
  "account.2fa_enabled": { category: "account", label: "Double authentification activée" },
  "account.2fa_disabled": { category: "account", label: "Double authentification désactivée" },
  "account.recovery_code_used": { category: "account", label: "Code de secours utilisé" },
  "account.passkey_added": { category: "account", label: "Clé d'accès enregistrée" },
  "account.passkey_removed": { category: "account", label: "Clé d'accès supprimée" },
  "account.sso_login": { category: "account", label: "Connexion par authentification unique" },
  "account.sso_created": { category: "account", label: "Compte créé par authentification unique" },
  "account.registered": { category: "account", label: "Compte créé" },
  "account.password_reset_requested": {
    category: "account",
    label: "Réinitialisation de mot de passe demandée",
  },
  "account.ssh_key_added": { category: "account", label: "Clé SSH ajoutée" },
  "account.ssh_key_removed": { category: "account", label: "Clé SSH retirée" },
  "account.password_reset": { category: "account", label: "Mot de passe réinitialisé" },
  "account.email_verified": { category: "account", label: "Adresse confirmée" },
  // Consigné sur le compte **du client**, et non sur celui de l'agent : la
  // question posée après coup est « qui est entré chez moi », pas « qu'ai-je
  // fait de ma journée ».
  "account.impersonation_started": {
    category: "account",
    label: "Prise en main par un membre du personnel",
  },
  "account.impersonation_ended": { category: "account", label: "Fin de la prise en main" },

  /**
   * Gestes d'administration de la plateforme.
   *
   * Classés en `access` quand ils créent ou retirent un moyen d'entrer, en
   * `settings` quand ils changent une configuration. La distinction sert au
   * filtre du journal : on cherche rarement « qui a touché à quelque chose »,
   * presque toujours « qui a obtenu un accès ».
   */
  "admin.incident_opened": { category: "settings", label: "Incident ouvert" },
  "admin.incident_updated": { category: "settings", label: "Incident mis à jour" },

  /**
   * Ce que fait le système de facturation, par l'API applicative.
   *
   * Ces neuf-là n'avaient aucun libellé : le contrôle de couverture cherchait
   * `this.log(a, b, "événement")` et ne voyait pas `this.trace(request,
   * "événement")`, si bien que toute l'API applicative lui échappait. Le
   * journal affichait donc `application.user_created` tel quel à l'écran.
   *
   * Ce sont pourtant les lignes qu'on relit le plus : quand un client affirme
   * n'avoir rien commandé, ou qu'un serveur a disparu, c'est ici qu'on
   * retrouve ce que la boutique a demandé et quand.
   */
  "application.user_created": { category: "account", label: "Compte créé par la facturation" },
  "application.user_updated": { category: "account", label: "Compte modifié par la facturation" },
  "application.user_deleted": { category: "account", label: "Compte supprimé par la facturation" },
  "application.server_created": { category: "settings", label: "Serveur créé par la facturation" },
  "admin.server_resized": {
    category: "settings",
    label: "Limites du serveur changées par l'administration",
  },
  "application.server_resized": {
    category: "settings",
    label: "Limites du serveur changées par la facturation",
  },
  "application.server_deleted": {
    category: "settings",
    label: "Serveur supprimé par la facturation",
  },
  "application.reseller_quota_set": {
    category: "account",
    label: "Enveloppe de revendeur posée par la facturation",
  },
  /**
   * L'entrée d'un client dans le panel, depuis son espace de facturation.
   *
   * C'est **le** chemin d'entrée ordinaire : le client n'a pas de mot de passe
   * ici. La ligne dit qu'un lien a été émis — pas qu'il a servi, la session
   * s'ouvrant, elle, par le chemin commun à toutes les connexions.
   */
  "application.sso_link_issued": {
    category: "access",
    label: "Lien de connexion émis pour un client",
  },

  "admin.application_key_created": { category: "access", label: "Clé applicative créée" },
  "admin.application_key_revoked": { category: "access", label: "Clé applicative révoquée" },
  "admin.node_bootstrap_key_issued": {
    category: "access",
    label: "Clé d'amorçage de node émise",
  },
  "admin.webhook_created": { category: "settings", label: "Rappel sortant créé" },
  "admin.webhook_deleted": { category: "settings", label: "Rappel sortant supprimé" },
  "admin.webhook_secret_rotated": {
    category: "settings",
    label: "Secret de rappel sortant renouvelé",
  },
  "admin.server_owner_changed": {
    category: "account",
    label: "Propriétaire d'un serveur changé",
  },
  "admin.smtp_tested": { category: "settings", label: "Envoi de courrier éprouvé" },
  "node.configuration_read": { category: "settings", label: "Configuration de node consultée" },
  "application.domain_certificate_reported": {
    category: "network",
    label: "Certificat de domaine : tentative rapportée",
  },
  "server.docker_image": { category: "settings", label: "Image Docker changée" },

  /** Événements d'un revendeur sur son propre parc. */
  "reseller.server_suspended": {
    category: "power",
    label: "Serveur suspendu par son revendeur",
  },
  "reseller.server_resumed": {
    category: "power",
    label: "Serveur rétabli par son revendeur",
  },
  "reseller.server_resized": {
    category: "settings",
    label: "Limites du serveur changées par son revendeur",
  },
  "reseller.server_deleted": {
    category: "settings",
    label: "Serveur supprimé par son revendeur",
  },
  "reseller.platform_access_set": {
    category: "account",
    label: "Accès de la plateforme au parc du revendeur modifié",
  },
  "reseller.key_created": { category: "access", label: "Clé applicative émise par le revendeur" },
  "reseller.key_revoked": {
    category: "access",
    label: "Clé applicative révoquée par le revendeur",
  },
  "reseller.webhook_created": {
    category: "settings",
    label: "Rappel sortant déclaré par le revendeur",
  },
  "reseller.webhook_deleted": {
    category: "settings",
    label: "Rappel sortant supprimé par le revendeur",
  },
  "reseller.webhook_secret_rotated": {
    category: "settings",
    label: "Secret de rappel du revendeur renouvelé",
  },
  "reseller.branding_saved": { category: "settings", label: "Marque du revendeur enregistrée" },
  "reseller.domain_declared": { category: "network", label: "Domaine de revendeur déclaré" },
};

export function describeActivity(event: string): ActivityDescriptor {
  return ACTIVITY_EVENTS[event] ?? { category: "settings", label: event };
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  power: "Alimentation",
  console: "Console",
  files: "Fichiers",
  backups: "Sauvegardes",
  databases: "Bases de données",
  network: "Réseau",
  access: "Accès",
  schedules: "Planification",
  settings: "Paramètres",
  account: "Compte",
};
