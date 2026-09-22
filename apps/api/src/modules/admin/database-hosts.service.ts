import { encryptSecret } from "@gamedashboard/auth";
import { type Database, databaseHosts, databases, nodes } from "@gamedashboard/db";
import { MysqlHostUnreachableError, probeHost } from "@gamedashboard/mysql";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Hôtes MySQL sur lesquels le panel crée les bases des clients.
 *
 * Sans un seul hôte déclaré, la fonction « bases de données » de l'espace
 * client est complète mais inutilisable : chaque création échoue sur « aucun
 * hôte n'est configuré ». Cet écran est ce qui la met en service.
 *
 * **Le mot de passe est éprouvé avant d'être enregistré.** Un identifiant faux
 * ne casse rien à la saisie ; il casse la première création de base, chez un
 * client qui n'y est pour rien et qui appellera le support. Vérifier au moment
 * où l'on tape déplace la découverte là où la correction est possible.
 */

export interface DatabaseHostView {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** Node auquel l'hôte est réservé, ou `null` pour « toute la plateforme ». */
  nodeId: string | null;
  nodeName: string | null;
  maxDatabases: number | null;
  /** Bases actuellement hébergées. Décide de ce qu'une suppression détruirait. */
  databases: number;
}

export interface DatabaseHostInput {
  name: string;
  host: string;
  port: number;
  username: string;
  /** Vide à la mise à jour veut dire « ne change pas le mot de passe ». */
  password: string;
  nodeId: string | null;
  maxDatabases: number | null;
}

@Injectable()
export class DatabaseHostsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Les hôtes, avec le nombre de bases qu'ils portent.
   *
   * Le compte accompagne la ligne parce que c'est lui qui rend la suppression
   * décidable : supprimer un hôte vide ne coûte rien, supprimer un hôte qui
   * porte quarante bases est une autre affaire.
   */
  async list(): Promise<DatabaseHostView[]> {
    const rows = await this.db
      .select({
        id: databaseHosts.id,
        name: databaseHosts.name,
        host: databaseHosts.host,
        port: databaseHosts.port,
        username: databaseHosts.username,
        nodeId: databaseHosts.nodeId,
        nodeName: nodes.name,
        maxDatabases: databaseHosts.maxDatabases,
        databases: count(databases.id),
      })
      .from(databaseHosts)
      .leftJoin(nodes, eq(databaseHosts.nodeId, nodes.id))
      .leftJoin(databases, eq(databases.databaseHostId, databaseHosts.id))
      .groupBy(databaseHosts.id, nodes.name);

    return rows;
  }

  /**
   * Éprouve des identifiants sans rien enregistrer.
   *
   * Sert au bouton « tester » du formulaire, et au contrôle fait avant toute
   * écriture. Le mot de passe arrive en clair de l'écran d'administration, ne
   * traverse que cette requête, et n'est écrit nulle part quand le test échoue.
   */
  async probe(input: {
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<{ version: string; canCreate: boolean }> {
    try {
      return await probeHost({
        name: input.name || input.host,
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
      });
    } catch (error) {
      if (error instanceof MysqlHostUnreachableError) {
        throw new ServiceUnavailableException(error.message);
      }
      // Connexion établie mais requête refusée : ce sont les droits, pas le
      // réseau, et les deux appellent des corrections différentes.
      throw new BadRequestException(
        `Ces identifiants sont refusés par l'hôte : ${
          error instanceof Error ? error.message : "cause inconnue"
        }`,
      );
    }
  }

  /**
   * Déclare un hôte.
   *
   * Le test précède l'écriture, et il n'est pas contournable : un hôte
   * enregistré est un hôte que le panel proposera à la prochaine création de
   * base. En déclarer un dont on n'a pas vérifié les identifiants revient à
   * programmer une panne pour plus tard.
   */
  async create(input: DatabaseHostInput): Promise<DatabaseHostView> {
    this.validate(input);
    if (input.password === "") throw new BadRequestException("Mot de passe manquant.");

    await this.probe(input);

    const [row] = await this.db
      .insert(databaseHosts)
      .values({
        name: input.name.trim(),
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        passwordEnc: encryptSecret(input.password),
        nodeId: input.nodeId,
        maxDatabases: input.maxDatabases,
      })
      .returning({ id: databaseHosts.id });

    if (!row) throw new ServiceUnavailableException("Hôte non enregistré.");
    return this.mustFind(row.id);
  }

  /**
   * Met à jour un hôte.
   *
   * Un mot de passe vide signifie « ne change rien », comme pour les secrets
   * des réglages : le formulaire ne peut pas le pré-remplir, puisqu'on ne le
   * relit jamais. Sans cette règle, corriger un numéro de port effacerait le
   * mot de passe.
   *
   * Le test n'a lieu que si un mot de passe **nouveau** est fourni : éprouver
   * avec l'ancien obligerait à le déchiffrer pour rien, et un changement de
   * libellé n'a aucune raison d'ouvrir une connexion.
   */
  async update(id: string, input: DatabaseHostInput): Promise<DatabaseHostView> {
    this.validate(input);
    await this.mustFind(id);

    if (input.password !== "") await this.probe(input);

    await this.db
      .update(databaseHosts)
      .set({
        name: input.name.trim(),
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        ...(input.password === "" ? {} : { passwordEnc: encryptSecret(input.password) }),
        nodeId: input.nodeId,
        maxDatabases: input.maxDatabases,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(databaseHosts.id, id));

    return this.mustFind(id);
  }

  /**
   * Retire un hôte.
   *
   * **Refusé tant qu'il porte des bases.** La contrainte existe déjà en base —
   * `on delete restrict` — mais elle produirait une erreur SQL brute ; la
   * refuser ici permet de dire combien de bases empêchent la suppression, et
   * que le panel ne les effacera pas à la place de quelqu'un.
   *
   * Les bases ne sont pas supprimées en cascade, et ce serait le pire des
   * raccourcis : elles contiennent les données des clients, et un clic sur
   * « supprimer cet hôte » n'est pas un consentement à les détruire.
   */
  async remove(id: string): Promise<void> {
    const host = await this.mustFind(id);
    if (host.databases > 0) {
      throw new ConflictException(
        `Cet hôte porte encore ${host.databases} base(s). Supprimez-les depuis les serveurs concernés avant de le retirer.`,
      );
    }

    await this.db.delete(databaseHosts).where(eq(databaseHosts.id, id));
  }

  private validate(input: DatabaseHostInput): void {
    if (input.name.trim() === "") throw new BadRequestException("Nom manquant.");
    if (input.host.trim() === "") throw new BadRequestException("Adresse manquante.");
    if (input.username.trim() === "") throw new BadRequestException("Utilisateur manquant.");
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new BadRequestException("Port invalide.");
    }
    if (
      input.maxDatabases !== null &&
      (!Number.isInteger(input.maxDatabases) || input.maxDatabases < 0)
    ) {
      throw new BadRequestException("Le plafond doit être un entier positif, ou vide.");
    }
  }

  private async mustFind(id: string): Promise<DatabaseHostView> {
    const found = (await this.list()).find((host) => host.id === id);
    if (!found) throw new NotFoundException("Hôte de bases de données introuvable.");
    return found;
  }
}
