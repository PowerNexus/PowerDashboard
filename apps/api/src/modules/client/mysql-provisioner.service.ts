import {
  createDatabase,
  dropDatabase,
  MysqlHostUnreachableError,
  MysqlIdentifierError,
  rotatePassword,
} from "@gamedashboard/mysql";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { decryptRowSecret } from "../../common/row-secrets";

/**
 * Hôte MySQL tel que stocké en base : le mot de passe est chiffré.
 */
export interface DatabaseHostRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
}

/**
 * Enveloppe NestJS autour de `@gamedashboard/mysql`.
 *
 * Elle n'ajoute que deux choses, mais les deux comptent : le déchiffrement du
 * mot de passe d'administration, qui n'a rien à faire dans un module dont le
 * métier est de composer des requêtes SQL, et la traduction des erreurs en
 * codes HTTP — un nom refusé est une faute du demandeur (400), un hôte muet
 * n'en est pas une (503).
 *
 * Le paquet vit à part pour une raison de résolution de dépendances, expliquée
 * dans son README : `drizzle-orm` déclare `mysql2` en pair, et les deux côte à
 * côte donnent deux instances de l'ORM dans le même processus.
 */
@Injectable()
export class MysqlProvisionerService {
  createDatabase(
    host: DatabaseHostRow,
    database: string,
    username: string,
    password: string,
    remote: string,
  ): Promise<void> {
    return this.translate(() =>
      createDatabase(this.credentials(host), database, username, password, remote),
    );
  }

  rotatePassword(
    host: DatabaseHostRow,
    username: string,
    remote: string,
    password: string,
  ): Promise<void> {
    return this.translate(() => rotatePassword(this.credentials(host), username, remote, password));
  }

  dropDatabase(
    host: DatabaseHostRow,
    database: string,
    username: string,
    remote: string,
  ): Promise<void> {
    return this.translate(() => dropDatabase(this.credentials(host), database, username, remote));
  }

  /** Le mot de passe n'existe en clair que le temps d'ouvrir la connexion. */
  private credentials(host: DatabaseHostRow) {
    return {
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      password: decryptRowSecret("database_hosts.password_enc", host.id, host.passwordEnc),
    };
  }

  private async translate<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof MysqlIdentifierError) throw new BadRequestException(error.message);
      if (error instanceof MysqlHostUnreachableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}
