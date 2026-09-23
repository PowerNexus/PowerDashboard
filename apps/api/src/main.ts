import "reflect-metadata";
import cookie from "@fastify/cookie";
import { assertEncryptionKey } from "@gamedashboard/auth";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { trustedProxiesSetting } from "./modules/auth/sign-in-origin";
import { CHUNK_SIZE } from "./modules/client/file-upload.service";

/**
 * Fastify plutôt qu'Express : les routes `remote` sont appelées à chaque
 * heartbeat de chaque node, le coût par requête se paie en continu.
 */
async function bootstrap(): Promise<void> {
  // Avant tout : sans clé, rien ne se chiffre ni ne se relit, et une API qui
  // démarre quand même ne le dirait qu'au premier appel d'un node.
  assertEncryptionKey();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    /*
     * `trustProxy` : l'API n'est jamais jointe directement.
     *
     * Devant elle, un proxy et le serveur de rendu ; sans cette option, toutes
     * les requêtes paraîtraient venir d'eux, et la limitation par adresse
     * additionnerait les tentatives de tout le monde sur un seul compteur — un
     * visiteur maladroit verrouillerait la connexion de l'ensemble des clients.
     *
     * Une **liste** et non `true` : `true` accorde la même confiance à
     * n'importe quel appelant, y compris à celui qui se serait glissé jusqu'au
     * port. Ne sont crus que les intermédiaires nommés ici, la boucle locale
     * par défaut — c'est de là que parlent nginx et le rendu.
     *
     * La même liste décide si l'en-tête de pays (`CF-IPCountry`) est cru :
     * elle est lue au même endroit pour les deux usages.
     */
    new FastifyAdapter({ trustProxy: trustedProxiesSetting() }),
  );

  await app.register(cookie);

  /*
   * Les morceaux d'un envoi reprenable arrivent en binaire brut.
   *
   * Fastify ne sait rien lire qui ne soit ni JSON ni formulaire, et plafonne
   * de toute façon un corps à un mégaoctet. Ce parseur dit les deux : garde le
   * corps tel quel, et accepte jusqu'à un morceau entier. La borne est **ici
   * et non dans le service** — refuser après avoir lu cent mégaoctets en
   * mémoire ne protégerait de rien.
   */
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: CHUNK_SIZE + 64 * 1024 },
      (_request, body, done) => done(null, body),
    );

  // Le navigateur appelle l'API depuis l'origine du panel. `credentials` est
  // indispensable : sans lui le cookie de session ne serait jamais transmis.
  app.enableCors({
    origin: process.env.PANEL_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  const port = Number.parseInt(process.env.PORT ?? "3001", 10);

  /**
   * Interface d'écoute.
   *
   * `0.0.0.0` par défaut : en conteneur, l'API doit être joignable depuis le
   * réseau Docker, et l'exposition réelle est décidée par le réseau.
   *
   * Mais ce défaut est faux dès que l'API tourne **à même un hôte partagé** :
   * elle y serait alors accessible sur l'adresse publique de la machine, et
   * toutes les routes d'administration avec elle, sans passer par le proxy qui
   * termine TLS et filtre les préfixes. C'est pourquoi l'adresse se déclare :
   * en production, `HOST=127.0.0.1`, et seul nginx décide de ce qui sort.
   */
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen(port, host);
}

void bootstrap();
