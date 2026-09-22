import type { WingsErrorResponse } from "@gamedashboard/contracts";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";

interface FastifyReply {
  status(code: number): FastifyReply;
  send(payload: unknown): void;
}

/**
 * Traduit toute erreur des routes `remote` au format attendu par Wings.
 *
 * Le daemon désérialise `{ errors: [{ code, status, detail }] }`
 * (`remote/errors.go`). Une réponse au format habituel du panel serait
 * illisible pour lui, et le message d'erreur dans ses journaux ne dirait rien
 * de ce qui s'est réellement passé.
 *
 * Le choix du code compte autant que le corps : Wings ne réessaie pas sur un
 * 4xx et réessaie avec temporisation exponentielle sur tout le reste. Un 500
 * renvoyé pour une condition définitive — un serveur supprimé — installerait
 * donc une boucle de tentatives jusqu'à intervention humaine.
 */
@Catch()
export class WingsErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    const body: WingsErrorResponse = {
      errors: [
        {
          code: exception instanceof HttpException ? exception.name : "InternalServerError",
          status: String(status),
          // Le détail part vers les journaux du daemon, que seul un
          // administrateur consulte : il peut être explicite. Aucune donnée
          // d'un autre node n'y figure pour autant.
          detail: describe(exception, status),
        },
      ],
    };

    reply.status(status).send(body);
  }
}

function describe(exception: unknown, status: number): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "message" in response) {
      const { message } = response as { message: unknown };
      return Array.isArray(message) ? message.join(", ") : String(message);
    }
    return exception.message;
  }
  // Une erreur inattendue ne doit pas exposer sa trace : elle est journalisée
  // côté panel, pas transmise.
  return status >= 500 ? "Erreur interne du panel." : "Requête refusée.";
}
