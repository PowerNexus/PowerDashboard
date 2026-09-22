import { buildOpenApiDocument, type OpenApiDocument } from "@gamedashboard/contracts";
import { Controller, Get, Header } from "@nestjs/common";

/**
 * La spécification OpenAPI, servie par le panel lui-même.
 *
 * **Sans garde, comme la page de statut, et pour une raison voisine** : elle
 * ne décrit que des chemins, des verbes et le nom de l'authentification
 * exigée. Rien qui ne soit déjà lisible sur l'écran « API » du panel, et rien
 * qu'un curieux ne retrouverait en essayant des adresses. L'y enfermer
 * obligerait en revanche chaque intégrateur à se créer un compte avant de
 * savoir si le panel sait faire ce qu'il cherche.
 *
 * Elle est **calculée** et non lue depuis un fichier : le document livré à la
 * racine du dépôt sert aux générateurs hors ligne, celui-ci dit ce que **ce**
 * panel expose réellement, version comprise. Les deux sont produits par la
 * même fonction, et l'intégration continue refuse qu'ils divergent.
 *
 * L'adresse du serveur est tirée de `PANEL_ORIGIN`, la même référence que le
 * contrôle d'origine des websockets et que CORS : un document qui annoncerait
 * un autre domaine ferait générer des clients qui frappent au mauvais endroit.
 */
@Controller("api/v1/openapi.json")
export class OpenApiController {
  @Get()
  // Une heure : le document ne change qu'avec une livraison, et le mettre en
  // cache évite de le recomposer à chaque ouverture d'un explorateur d'API.
  @Header("cache-control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400")
  @Header("content-type", "application/json; charset=utf-8")
  document(): OpenApiDocument {
    return buildOpenApiDocument(process.env.PANEL_ORIGIN ?? "http://localhost:3000");
  }
}
